/**
 * GDL-90 Capacitor Plugin
 *
 * Receives GDL-90 ADS-B data over UDP from WiFi-connected receivers
 * (Stratux, ForeFlight Sentry, etc.) and exposes parsed snapshots to JS.
 * Ported from relay/gdl90.js — pure binary parsing per GDL-90 ICD.
 */

import Foundation
import Capacitor
import Network

@objc(GDL90Plugin)
public class GDL90Plugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GDL90Plugin"
    public let jsName = "GDL90"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSnapshot", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - State

    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private let queue = DispatchQueue(label: "com.dronedaa.gdl90", qos: .userInitiated)

    private var aircraftMap: [String: [String: Any]] = [:]     // ICAO hex -> track
    private var ownship: [String: Any]? = nil
    private var gpsValid = false
    private var lastUdpReceived: Date? = nil
    private var pushTimer: DispatchSourceTimer?

    private let staleTimeoutSec: TimeInterval = 15.0
    private let pushIntervalSec: TimeInterval = 1.0

    // MARK: - CRC-16 Table (CRC-CCITT, poly 0x1021)

    private static let crcTable: [UInt16] = {
        var table = [UInt16](repeating: 0, count: 256)
        for i in 0..<256 {
            var crc = UInt16(i) << 8
            for _ in 0..<8 {
                crc = (crc & 0x8000) != 0 ? (crc << 1) ^ 0x1021 : crc << 1
            }
            table[i] = crc & 0xFFFF
        }
        return table
    }()

    // MARK: - Plugin Methods

    @objc func startListening(_ call: CAPPluginCall) {
        let port = call.getInt("port") ?? 4000

        // Stop existing listener if any
        stopListenerInternal()

        do {
            let params = NWParameters.udp
            params.allowLocalEndpointReuse = true

            // Constrain to WiFi interface — GDL-90 receivers (SkyEcho, Stratux, etc.)
            // create a local WiFi AP with no internet. Without this, iOS may route
            // traffic through cellular and miss the UDP broadcasts.
            params.requiredInterfaceType = .wifi

            let nwPort = NWEndpoint.Port(integerLiteral: UInt16(port))
            listener = try NWListener(using: params, on: nwPort)

            listener?.newConnectionHandler = { [weak self] connection in
                guard let self = self else { return }
                self.connections.append(connection)
                self.receiveLoop(connection)
                connection.start(queue: self.queue)
            }

            listener?.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    print("[GDL90] UDP listener ready on port \(port) (WiFi only)")
                case .failed(let error):
                    print("[GDL90] Listener failed: \(error)")
                    self?.stopListenerInternal()
                default:
                    break
                }
            }

            listener?.start(queue: queue)
            startPushTimer()
            call.resolve(["started": true])
        } catch {
            call.reject("Failed to start UDP listener: \(error.localizedDescription)")
        }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        stopListenerInternal()
        call.resolve()
    }

    @objc func getSnapshot(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else {
                call.resolve(self?.emptySnapshot() ?? [:])
                return
            }
            self.pruneStale()
            let snapshot = self.buildSnapshot()
            call.resolve(snapshot)
        }
    }

    // MARK: - UDP Receive Loop

    private func receiveLoop(_ connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            guard let self = self else { return }

            if let data = data, !data.isEmpty {
                self.lastUdpReceived = Date()
                self.handleUdpData(data)
            }

            if let error = error {
                print("[GDL90] Receive error: \(error)")
                // Remove dead connection
                self.queue.async {
                    self.connections.removeAll { $0 === connection }
                }
                return
            }

            // If connection was cancelled, stop the loop
            if connection.state == .cancelled {
                return
            }

            // Continue receiving
            self.receiveLoop(connection)
        }
    }

    private func handleUdpData(_ data: Data) {
        let messages = unframe(data)

        for msg in messages {
            let msgId = msg.msgId
            let payload = msg.payload

            switch msgId {
            case 0x14: // Traffic report
                if let track = parseTrafficReport(payload) {
                    let id = track["id"] as? String ?? ""
                    var t = track
                    t["timestamp"] = Date().timeIntervalSince1970 * 1000
                    aircraftMap[id] = t
                }

            case 0x0A: // Ownship report
                if let track = parseTrafficReport(payload) {
                    let lat = track["lat"] as? Double ?? 0
                    let lon = track["lon"] as? Double ?? 0
                    if isValidCoord(lat, lon) {
                        var t = track
                        t["timestamp"] = Date().timeIntervalSince1970 * 1000
                        ownship = t
                    }
                }

            case 0x0B: // Ownship geo alt
                if let geoAlt = parseOwnshipGeoAlt(payload) {
                    ownship?["geoAltFt"] = geoAlt["geoAltFt"]
                }

            case 0x00: // Heartbeat
                if let hb = parseHeartbeat(payload) {
                    gpsValid = hb["gpsValid"] as? Bool ?? false
                }

            default:
                break
            }
        }
    }

    // MARK: - Push Timer

    private func startPushTimer() {
        pushTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + pushIntervalSec, repeating: pushIntervalSec)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.pruneStale()
            let snapshot = self.buildSnapshot()
            self.notifyListeners("gdl90Update", data: snapshot)
        }
        timer.resume()
        pushTimer = timer
    }

    // MARK: - State Management

    private func pruneStale() {
        let cutoff = Date().timeIntervalSince1970 * 1000 - (staleTimeoutSec * 1000)
        aircraftMap = aircraftMap.filter { (_, track) in
            (track["timestamp"] as? Double ?? 0) > cutoff
        }
    }

    private func buildSnapshot() -> [String: Any] {
        let receiverConnected: Bool
        if let lastUdp = lastUdpReceived {
            receiverConnected = Date().timeIntervalSince(lastUdp) < 5.0
        } else {
            receiverConnected = false
        }

        return [
            "receiverConnected": receiverConnected,
            "gpsValid": gpsValid,
            "ownship": ownship as Any,
            "aircraft": Array(aircraftMap.values),
            "count": aircraftMap.count,
            "timestamp": Date().timeIntervalSince1970 * 1000,
        ]
    }

    private func emptySnapshot() -> [String: Any] {
        return [
            "receiverConnected": false,
            "gpsValid": false,
            "ownship": NSNull(),
            "aircraft": [] as [[String: Any]],
            "count": 0,
            "timestamp": Date().timeIntervalSince1970 * 1000,
        ]
    }

    private func stopListenerInternal() {
        pushTimer?.cancel()
        pushTimer = nil
        for conn in connections {
            conn.cancel()
        }
        connections.removeAll()
        listener?.cancel()
        listener = nil
    }

    private func isValidCoord(_ lat: Double, _ lon: Double) -> Bool {
        return lat != 0 && lon != 0 && abs(lat) <= 90 && abs(lon) <= 180
    }

    // MARK: - GDL-90 Binary Parsing (ported from relay/gdl90.js)

    private struct GDL90Message {
        let msgId: UInt8
        let payload: Data
    }

    private func crc16(_ bytes: Data) -> UInt16 {
        var crc: UInt16 = 0
        for byte in bytes {
            crc = (GDL90Plugin.crcTable[Int((crc >> 8) & 0xFF)] ^ (crc << 8) ^ UInt16(byte)) & 0xFFFF
        }
        return crc
    }

    private func unstuff(_ raw: Data) -> Data {
        var out = Data()
        var i = 0
        while i < raw.count {
            if raw[i] == 0x7D && i + 1 < raw.count {
                out.append(raw[i + 1] ^ 0x20)
                i += 2
            } else {
                out.append(raw[i])
                i += 1
            }
        }
        return out
    }

    private func unframe(_ rawBytes: Data) -> [GDL90Message] {
        var messages: [GDL90Message] = []
        let len = rawBytes.count
        var i = 0

        while i < len {
            // Find start flag 0x7E
            guard rawBytes[i] == 0x7E else { i += 1; continue }

            // Find end flag
            var j = i + 1
            while j < len && rawBytes[j] != 0x7E { j += 1 }
            if j >= len { break }

            let frameLen = j - i - 1
            if frameLen >= 3 { // min: msgId(1) + CRC(2)
                let frame = rawBytes.subdata(in: (i + 1)..<j)
                let payload = unstuff(frame)

                if payload.count >= 3 {
                    let msgBody = payload.prefix(payload.count - 2)
                    let crcReceived = UInt16(payload[payload.count - 2]) | (UInt16(payload[payload.count - 1]) << 8)
                    let crcCalc = crc16(Data(msgBody))

                    if crcCalc == crcReceived {
                        messages.append(GDL90Message(
                            msgId: msgBody[0],
                            payload: Data(msgBody)
                        ))
                    }
                }
            }

            i = j // next frame starts at this 0x7E
        }

        return messages
    }

    // MARK: - Traffic Report Parser (msg 0x14 / 0x0A)

    private func parseTrafficReport(_ payload: Data) -> [String: Any]? {
        guard payload.count >= 28 else { return nil }

        // Bytes 2-4: ICAO address (big-endian)
        let address = (Int(payload[2]) << 16) | (Int(payload[3]) << 8) | Int(payload[4])

        // Bytes 5-7: latitude (signed 24-bit)
        var latRaw = (Int(payload[5]) << 16) | (Int(payload[6]) << 8) | Int(payload[7])
        if latRaw & 0x800000 != 0 { latRaw -= 0x1000000 }
        let lat = Double(latRaw) * (180.0 / Double(1 << 23))

        // Bytes 8-10: longitude (signed 24-bit)
        var lonRaw = (Int(payload[8]) << 16) | (Int(payload[9]) << 8) | Int(payload[10])
        if lonRaw & 0x800000 != 0 { lonRaw -= 0x1000000 }
        let lon = Double(lonRaw) * (180.0 / Double(1 << 23))

        // Bytes 11-12: altitude (12 bits)
        let altRaw = (Int(payload[11]) << 4) | ((Int(payload[12]) >> 4) & 0x0F)
        let altFt: Any = altRaw == 0xFFF ? NSNull() : (altRaw * 25) - 1000

        let misc = Int(payload[12]) & 0x0F
        let airborne = (misc & 0x08) != 0

        // Bytes 14-15: horizontal velocity (12 bits, knots)
        let hvelRaw = (Int(payload[14]) << 4) | ((Int(payload[15]) >> 4) & 0x0F)
        let speedKts: Any = hvelRaw == 0xFFF ? NSNull() : hvelRaw

        // Bytes 15-16: vertical velocity (12 bits, signed, * 64 fpm)
        var vvelRaw = ((Int(payload[15]) & 0x0F) << 8) | Int(payload[16])
        var vertRateFpm: Any = NSNull()
        if vvelRaw != 0x800 {
            if vvelRaw & 0x800 != 0 { vvelRaw -= 0x1000 }
            vertRateFpm = vvelRaw * 64
        }

        // Byte 17: track/heading
        let headingDeg = Double(payload[17]) * (360.0 / 256.0)

        // Byte 18: emitter category
        let emitterCode = Int(payload[18])

        // Bytes 19-26: callsign (8 ASCII bytes)
        var callsign = ""
        for k in 19..<min(27, payload.count) {
            let ch = payload[k]
            if ch >= 0x20 && ch <= 0x7E { callsign += String(UnicodeScalar(ch)) }
        }
        callsign = callsign.trimmingCharacters(in: .whitespaces)

        return [
            "id": String(format: "%06X", address),
            "lat": (Double(round(lat * 1e6)) / 1e6),
            "lon": (Double(round(lon * 1e6)) / 1e6),
            "altFt": altFt,
            "headingDeg": (Double(round(headingDeg * 10)) / 10),
            "speedKts": speedKts,
            "vertRateFpm": vertRateFpm,
            "callsign": callsign.isEmpty ? NSNull() : callsign,
            "category": emitterCategory(emitterCode),
            "onGround": !airborne,
            "timestamp": Date().timeIntervalSince1970 * 1000,
        ]
    }

    // MARK: - Heartbeat Parser (msg 0x00)

    private func parseHeartbeat(_ payload: Data) -> [String: Any]? {
        guard payload.count >= 3 else { return nil }
        let status1 = payload[1]
        return [
            "gpsValid": (status1 & 0x80) != 0,
            "maintenanceRequired": (status1 & 0x40) != 0,
            "uatInitialized": (status1 & 0x01) != 0,
        ]
    }

    // MARK: - Ownship Geo Alt Parser (msg 0x0B)

    private func parseOwnshipGeoAlt(_ payload: Data) -> [String: Any]? {
        guard payload.count >= 5 else { return nil }
        var raw = (Int(payload[1]) << 8) | Int(payload[2])
        if raw & 0x8000 != 0 { raw -= 0x10000 }
        return ["geoAltFt": raw * 5]
    }

    // MARK: - Emitter Category

    private func emitterCategory(_ code: Int) -> String {
        switch code {
        case 0:  return "Unknown"
        case 1:  return "Light"
        case 2:  return "Small"
        case 3:  return "Large"
        case 4:  return "High Vortex"
        case 5:  return "Heavy"
        case 6:  return "High Perf"
        case 7:  return "Rotorcraft"
        case 9:  return "Glider"
        case 10: return "Lighter-than-Air"
        case 11: return "Parachutist"
        case 12: return "Ultralight"
        case 14: return "UAV"
        case 15: return "Space Vehicle"
        case 17: return "Surface Emergency"
        case 18: return "Surface Service"
        case 19: return "Point Obstacle"
        case 20: return "Cluster Obstacle"
        case 21: return "Line Obstacle"
        default: return "Unknown"
        }
    }
}
