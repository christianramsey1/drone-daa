/**
 * GDL-90 Capacitor Plugin
 *
 * Receives GDL-90 ADS-B data over UDP broadcast from WiFi-connected receivers
 * (skyAlert, Stratux, ForeFlight Sentry, etc.) and exposes parsed snapshots to JS.
 *
 * Uses BSD sockets (SO_BROADCAST + SO_REUSEPORT) instead of NWListener because
 * NWListener cannot receive UDP broadcast packets on iOS.
 */

import Foundation
import Capacitor
import Darwin

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

    private var sockFd: Int32 = -1
    private var shouldReceive = false
    private let queue = DispatchQueue(label: "com.dronedaa.gdl90", qos: .userInitiated)
    private let sockLock = NSLock()
    private var recvThread: Thread?

    private var aircraftMap: [String: [String: Any]] = [:]
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
        stopListenerInternal()

        queue.async { [weak self] in
            guard let self = self else { return }

            // Create UDP socket
            let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
            guard fd >= 0 else {
                call.reject("socket() failed: errno \(errno)")
                return
            }

            // Allow multiple sockets on same port (in case of restart)
            var one: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
            setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, socklen_t(MemoryLayout<Int32>.size))
            // Enable receiving broadcast packets
            setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &one, socklen_t(MemoryLayout<Int32>.size))

            // Bind to INADDR_ANY:port — receives directed UDP, subnet broadcast, and 255.255.255.255
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = in_port_t(UInt16(port).bigEndian)
            addr.sin_addr.s_addr = INADDR_ANY
            addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)

            // Retry bind up to 5 times (another app may hold the port briefly)
            var bindResult: Int32 = -1
            for attempt in 1...5 {
                bindResult = withUnsafeMutablePointer(to: &addr) { addrPtr -> Int32 in
                    addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr -> Int32 in
                        bind(fd, saPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }
                if bindResult == 0 {
                    #if DEBUG
                    print("[GDL90] bind() succeeded on attempt \(attempt)")
                    #endif
                    break
                }
                #if DEBUG
                print("[GDL90] bind() attempt \(attempt) failed: errno \(errno) — retrying in 1s")
                #endif
                Thread.sleep(forTimeInterval: 1.0)
            }

            guard bindResult == 0 else {
                close(fd)
                call.reject("bind() failed after 5 attempts: errno \(errno). Another app may own port \(port).")
                return
            }

            self.sockFd = fd
            self.shouldReceive = true

            #if DEBUG
            print("[GDL90] BSD socket ready, listening on 0.0.0.0:\(port) (broadcast enabled)")
            #endif

            // Set socket to non-blocking so close() unblocks recvfrom()
            let flags = fcntl(fd, F_GETFL)
            fcntl(fd, F_SETFL, flags | O_NONBLOCK)

            // Receive loop on a dedicated background thread
            let capturedFd = fd
            let thread = Thread { [weak self] in
                guard let self = self else { return }
                var buf = [UInt8](repeating: 0, count: 4096)
                var senderAddr = sockaddr_in()
                var senderLen = socklen_t(MemoryLayout<sockaddr_in>.size)

                // Use poll() so non-blocking socket doesn't spin CPU
                var pfd = pollfd(fd: capturedFd, events: Int16(POLLIN), revents: 0)

                while self.shouldReceive {
                    let pollResult = poll(&pfd, 1, 500) // 500ms timeout
                    if pollResult <= 0 { continue }

                    let n = withUnsafeMutablePointer(to: &senderAddr) {
                        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            recvfrom(capturedFd, &buf, buf.count, 0, $0, &senderLen)
                        }
                    }

                    if n > 0 {
                        let data = Data(buf[0..<n])
                        #if DEBUG
                        let sender = String(cString: inet_ntoa(senderAddr.sin_addr))
                        print("[GDL90] Received \(n) bytes from \(sender)")
                        #endif
                        self.queue.async {
                            self.lastUdpReceived = Date()
                            self.handleUdpData(data)
                        }
                    } else if n < 0 && errno != EINTR && errno != EAGAIN {
                        #if DEBUG
                        if self.shouldReceive {
                            print("[GDL90] recvfrom error: errno \(errno)")
                        }
                        #endif
                        break
                    }
                }
                #if DEBUG
                print("[GDL90] Receive thread exiting")
                #endif
            }
            thread.name = "com.dronedaa.gdl90.recv"
            thread.qualityOfService = .userInitiated
            self.recvThread = thread
            thread.start()

            self.startPushTimer()
            call.resolve(["started": true])
        }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        stopListenerInternal()
        call.resolve()
    }

    @objc func getSnapshot(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else {
                call.resolve([:])
                return
            }
            self.pruneStale()
            call.resolve(self.buildSnapshot())
        }
    }

    // MARK: - UDP Data Handler

    private func handleUdpData(_ data: Data) {
        let messages = unframe(data)

        for msg in messages {
            switch msg.msgId {
            case 0x14: // Traffic report
                if let track = parseTrafficReport(msg.payload) {
                    let id = track["id"] as? String ?? ""
                    var t = track
                    t["timestamp"] = Date().timeIntervalSince1970 * 1000
                    aircraftMap[id] = t
                }

            case 0x0A: // Ownship report
                if let track = parseTrafficReport(msg.payload) {
                    let lat = track["lat"] as? Double ?? 0
                    let lon = track["lon"] as? Double ?? 0
                    if isValidCoord(lat, lon) {
                        var t = track
                        t["timestamp"] = Date().timeIntervalSince1970 * 1000
                        ownship = t
                    }
                }

            case 0x0B: // Ownship geo alt
                if let geoAlt = parseOwnshipGeoAlt(msg.payload) {
                    ownship?["geoAltFt"] = geoAlt["geoAltFt"]
                }

            case 0x00: // Heartbeat
                if let hb = parseHeartbeat(msg.payload) {
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
            self.notifyListeners("gdl90Update", data: self.buildSnapshot())
        }
        timer.resume()
        pushTimer = timer
    }

    // MARK: - State Management

    private func pruneStale() {
        let cutoff = Date().timeIntervalSince1970 * 1000 - (staleTimeoutSec * 1000)
        aircraftMap = aircraftMap.filter { ($0.value["timestamp"] as? Double ?? 0) > cutoff }
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

    private func stopListenerInternal() {
        shouldReceive = false
        sockLock.lock()
        if sockFd >= 0 {
            close(sockFd)
            sockFd = -1
        }
        sockLock.unlock()
        recvThread = nil
        pushTimer?.cancel()
        pushTimer = nil
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
            guard rawBytes[i] == 0x7E else { i += 1; continue }
            var j = i + 1
            while j < len && rawBytes[j] != 0x7E { j += 1 }
            if j >= len { break }

            let frameLen = j - i - 1
            if frameLen >= 3 {
                let frame = rawBytes.subdata(in: (i + 1)..<j)
                let payload = unstuff(frame)

                if payload.count >= 3 {
                    let msgBody = payload.prefix(payload.count - 2)
                    let crcReceived = UInt16(payload[payload.count - 2]) | (UInt16(payload[payload.count - 1]) << 8)
                    let crcCalc = crc16(Data(msgBody))

                    if crcCalc == crcReceived {
                        messages.append(GDL90Message(msgId: msgBody[0], payload: Data(msgBody)))
                    }
                }
            }
            i = j
        }
        return messages
    }

    // MARK: - Traffic Report Parser (msg 0x14 / 0x0A)

    private func parseTrafficReport(_ payload: Data) -> [String: Any]? {
        guard payload.count >= 28 else { return nil }

        let address = (Int(payload[2]) << 16) | (Int(payload[3]) << 8) | Int(payload[4])

        var latRaw = (Int(payload[5]) << 16) | (Int(payload[6]) << 8) | Int(payload[7])
        if latRaw & 0x800000 != 0 { latRaw -= 0x1000000 }
        let lat = Double(latRaw) * (180.0 / Double(1 << 23))

        var lonRaw = (Int(payload[8]) << 16) | (Int(payload[9]) << 8) | Int(payload[10])
        if lonRaw & 0x800000 != 0 { lonRaw -= 0x1000000 }
        let lon = Double(lonRaw) * (180.0 / Double(1 << 23))

        let altRaw = (Int(payload[11]) << 4) | ((Int(payload[12]) >> 4) & 0x0F)
        let altFt: Any = altRaw == 0xFFF ? NSNull() : (altRaw * 25) - 1000

        let misc = Int(payload[12]) & 0x0F
        let airborne = (misc & 0x08) != 0

        let hvelRaw = (Int(payload[14]) << 4) | ((Int(payload[15]) >> 4) & 0x0F)
        let speedKts: Any = hvelRaw == 0xFFF ? NSNull() : hvelRaw

        var vvelRaw = ((Int(payload[15]) & 0x0F) << 8) | Int(payload[16])
        var vertRateFpm: Any = NSNull()
        if vvelRaw != 0x800 {
            if vvelRaw & 0x800 != 0 { vvelRaw -= 0x1000 }
            vertRateFpm = vvelRaw * 64
        }

        let headingDeg = Double(payload[17]) * (360.0 / 256.0)
        let emitterCode = Int(payload[18])

        var callsign = ""
        for k in 19..<min(27, payload.count) {
            let ch = payload[k]
            if ch >= 0x20 && ch <= 0x7E { callsign += String(UnicodeScalar(ch)) }
        }
        callsign = callsign.trimmingCharacters(in: .whitespaces)

        return [
            "id": String(format: "%06X", address),
            "lat": Double(round(lat * 1e6)) / 1e6,
            "lon": Double(round(lon * 1e6)) / 1e6,
            "altFt": altFt,
            "headingDeg": Double(round(headingDeg * 10)) / 10,
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
