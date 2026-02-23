/**
 * Remote ID Capacitor Plugin
 *
 * Scans for Open Drone ID (ODID) BLE advertisements via CoreBluetooth
 * and exposes parsed drone snapshots to JS. No relay app needed.
 * Ported from relay/odid.js — ASTM F3411-22a Section 4 parsing.
 */

import Foundation
import Capacitor
import CoreBluetooth

@objc(RemoteIdPlugin)
public class RemoteIdPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RemoteIdPlugin"
    public let jsName = "RemoteId"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSnapshot", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - ODID Constants

    private static let MSG_BASIC_ID: UInt8     = 0x0
    private static let MSG_LOCATION: UInt8     = 0x1
    private static let MSG_AUTH: UInt8         = 0x2
    private static let MSG_SELF_ID: UInt8      = 0x3
    private static let MSG_SYSTEM: UInt8       = 0x4
    private static let MSG_OPERATOR_ID: UInt8  = 0x5
    private static let MSG_MESSAGE_PACK: UInt8 = 0xF

    private static let ID_TYPE = ["none", "serialNumber", "registrationId", "utmAssigned", "specificSessionId"]
    private static let UAS_TYPE = [
        "none", "aeroplane", "helicopter", "gyroplane", "hybridLift", "ornithopter",
        "glider", "kite", "freeballoon", "captive", "airship", "freeFall",
        "rocket", "tethered", "groundObstacle", "other",
    ]
    private static let OP_STATUS = ["undeclared", "ground", "airborne", "emergency", "systemFailure"]
    private static let HEIGHT_TYPE = ["aboveTakeoff", "agl"]
    private static let SPEED_MULT: [Double] = [0.25, 0.75]

    private static let ODID_BLE_UUID = CBUUID(string: "FFFA")

    // MARK: - State

    private var centralManager: CBCentralManager?
    private var centralDelegate: BLEDelegate?
    private var scanning = false

    private struct DroneEntry {
        var messages: [[String: Any]] = []
        var lastSeen: Date = Date()
        var rssi: Int = 0
        var broadcastType: String = "unknown"
        var peripheralId: String
    }

    private var droneMap: [String: DroneEntry] = [:]
    private let queue = DispatchQueue(label: "com.dronedaa.rid", qos: .userInitiated)
    private var pushTimer: DispatchSourceTimer?

    private let staleTimeoutSec: TimeInterval = 30.0

    // MARK: - Plugin Methods

    @objc func startScanning(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }

            if self.centralDelegate == nil {
                self.centralDelegate = BLEDelegate(plugin: self)
            }
            if self.centralManager == nil {
                self.centralManager = CBCentralManager(delegate: self.centralDelegate, queue: self.queue)
            }

            self.scanning = true
            self.startPushTimer()

            // If already powered on, begin immediately
            if self.centralManager?.state == .poweredOn {
                self.beginScan()
            }
            // Otherwise centralManagerDidUpdateState in the delegate will call beginScan

            call.resolve(["started": true])
        }
    }

    @objc func stopScanning(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.scanning = false
            self.centralManager?.stopScan()
            self.pushTimer?.cancel()
            self.pushTimer = nil
            call.resolve()
        }
    }

    @objc func getSnapshot(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else {
                call.resolve(["type": "rid-snapshot", "timestamp": Date().timeIntervalSince1970 * 1000,
                              "drones": [] as [Any], "count": 0, "scanning": false])
                return
            }
            self.pruneStale()
            call.resolve(self.buildSnapshot())
        }
    }

    // MARK: - BLE Delegate (inner class)

    fileprivate func beginScan() {
        guard scanning else { return }
        // Scan for ALL peripherals (ODID uses service data, not advertised services list).
        // allowDuplicates: true because RID broadcasts continuously with updated data.
        centralManager?.scanForPeripherals(withServices: nil, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: true,
        ])
        print("[RID] BLE scanning started")
    }

    fileprivate func handleDiscovery(peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        // Check for ODID service data (UUID 0xFFFA)
        guard let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
              let data = serviceData[RemoteIdPlugin.ODID_BLE_UUID] else {
            return
        }

        // Per ASTM F3411-22a, BLE service data has 2-byte header: app code (0x0D) + counter
        let hasHeader = data.count >= 27 && data[0] == 0x0D
        let payload = hasHeader ? data.subdata(in: 2..<data.count) : data

        guard payload.count >= 25 else { return }

        let broadcastType = payload.count > 50 ? "bluetooth5LongRange" : "bluetooth5Legacy"
        let peripheralId = peripheral.identifier.uuidString

        processOdidPayload(payload, broadcastType: broadcastType, rssi: rssi.intValue, peripheralId: peripheralId)
    }

    // CBCentralManagerDelegate as a separate class (required because CAPPlugin can't conform)
    private class BLEDelegate: NSObject, CBCentralManagerDelegate {
        weak var plugin: RemoteIdPlugin?

        init(plugin: RemoteIdPlugin) {
            self.plugin = plugin
        }

        func centralManagerDidUpdateState(_ central: CBCentralManager) {
            switch central.state {
            case .poweredOn:
                print("[RID] Bluetooth powered on")
                plugin?.beginScan()
            case .poweredOff:
                print("[RID] Bluetooth powered off")
            case .unauthorized:
                print("[RID] Bluetooth unauthorized")
            default:
                break
            }
        }

        func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                            advertisementData: [String: Any], rssi RSSI: NSNumber) {
            plugin?.handleDiscovery(peripheral: peripheral, advertisementData: advertisementData, rssi: RSSI)
        }
    }

    // MARK: - ODID Payload Processing

    private func processOdidPayload(_ payload: Data, broadcastType: String, rssi: Int, peripheralId: String) {
        var parsedMessages: [[String: Any]] = []

        // Try parsing as individual 25-byte messages (may contain a message pack)
        var offset = 0
        while offset + 25 <= payload.count {
            if let msg = parseOdidMessage(payload, offset: offset) {
                let msgType = msg["msgType"] as? UInt8 ?? 0xFF

                if msgType == RemoteIdPlugin.MSG_MESSAGE_PACK {
                    // Message pack contains sub-messages already parsed
                    if let subMsgs = msg["messages"] as? [[String: Any]] {
                        parsedMessages.append(contentsOf: subMsgs)
                    }
                } else {
                    parsedMessages.append(msg)
                }
            }
            offset += 25
        }

        guard !parsedMessages.isEmpty else { return }

        // Determine drone ID: prefer serial number from Basic ID, fall back to peripheral UUID
        var droneId = peripheralId
        for msg in parsedMessages {
            if (msg["msgType"] as? UInt8) == RemoteIdPlugin.MSG_BASIC_ID,
               let uaId = msg["uaId"] as? String, !uaId.isEmpty {
                droneId = uaId
                break
            }
        }

        // Accumulate messages for this drone
        var entry = droneMap[droneId] ?? DroneEntry(peripheralId: peripheralId)
        for msg in parsedMessages {
            let msgType = msg["msgType"] as? UInt8 ?? 0xFF
            // Replace existing message of same type, or append
            if let idx = entry.messages.firstIndex(where: { ($0["msgType"] as? UInt8) == msgType }) {
                entry.messages[idx] = msg
            } else {
                entry.messages.append(msg)
            }
        }
        entry.lastSeen = Date()
        entry.rssi = rssi
        entry.broadcastType = broadcastType
        droneMap[droneId] = entry
    }

    // MARK: - Push Timer

    private func startPushTimer() {
        pushTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1.0, repeating: 1.0)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.pruneStale()
            let snapshot = self.buildSnapshot()
            self.notifyListeners("ridUpdate", data: snapshot)
        }
        timer.resume()
        pushTimer = timer
    }

    // MARK: - State Management

    private func pruneStale() {
        let cutoff = Date().addingTimeInterval(-staleTimeoutSec)
        droneMap = droneMap.filter { $0.value.lastSeen > cutoff }
    }

    private func buildSnapshot() -> [String: Any] {
        let drones: [[String: Any]] = droneMap.map { (droneId, entry) in
            var track = assembleTrack(droneId: droneId, messages: entry.messages, broadcastType: entry.broadcastType)
            track["rssi"] = entry.rssi
            track["timestamp"] = entry.lastSeen.timeIntervalSince1970 * 1000
            return track
        }

        return [
            "type": "rid-snapshot",
            "timestamp": Date().timeIntervalSince1970 * 1000,
            "drones": drones,
            "count": drones.count,
            "scanning": scanning,
        ]
    }

    // MARK: - ODID Message Parsing (ported from relay/odid.js)

    private func parseOdidMessage(_ buf: Data, offset: Int) -> [String: Any]? {
        guard buf.count - offset >= 25 else { return nil }

        let header = buf[offset]
        let msgType = (header >> 4) & 0x0F

        switch msgType {
        case RemoteIdPlugin.MSG_BASIC_ID:
            return parseBasicId(buf, off: offset)
        case RemoteIdPlugin.MSG_LOCATION:
            return parseLocation(buf, off: offset)
        case RemoteIdPlugin.MSG_SYSTEM:
            return parseSystem(buf, off: offset)
        case RemoteIdPlugin.MSG_SELF_ID:
            return parseSelfId(buf, off: offset)
        case RemoteIdPlugin.MSG_OPERATOR_ID:
            return parseOperatorId(buf, off: offset)
        case RemoteIdPlugin.MSG_AUTH:
            return ["msgType": RemoteIdPlugin.MSG_AUTH]
        case RemoteIdPlugin.MSG_MESSAGE_PACK:
            return parseMessagePack(buf, off: offset)
        default:
            return nil
        }
    }

    // MARK: Basic ID (type 0x0)

    private func parseBasicId(_ buf: Data, off: Int) -> [String: Any] {
        let idType = Int((buf[off + 1] >> 4) & 0x0F)
        let uasType = Int(buf[off + 1] & 0x0F)
        let uaId = readAscii(buf, offset: off + 2, length: 20)

        return [
            "msgType": RemoteIdPlugin.MSG_BASIC_ID,
            "idType": idType < RemoteIdPlugin.ID_TYPE.count ? RemoteIdPlugin.ID_TYPE[idType] : "unknown",
            "uasType": uasType < RemoteIdPlugin.UAS_TYPE.count ? RemoteIdPlugin.UAS_TYPE[uasType] : "other",
            "uaId": uaId,
        ]
    }

    // MARK: Location (type 0x1)

    private func parseLocation(_ buf: Data, off: Int) -> [String: Any] {
        let statusByte = buf[off + 1]
        let statusIdx = Int((statusByte >> 4) & 0x0F)
        let status = statusIdx < RemoteIdPlugin.OP_STATUS.count ? RemoteIdPlugin.OP_STATUS[statusIdx] : "undeclared"
        let heightTypeIdx = Int((statusByte >> 2) & 0x01)
        let heightType = heightTypeIdx < RemoteIdPlugin.HEIGHT_TYPE.count ? RemoteIdPlugin.HEIGHT_TYPE[heightTypeIdx] : "aboveTakeoff"
        let speedMultIdx = Int(statusByte & 0x01)
        let speedMult = RemoteIdPlugin.SPEED_MULT[speedMultIdx]

        let direction = Int(buf[off + 2])
        let headingDeg = direction <= 360 ? direction : 0

        let speedRaw = Int(buf[off + 3])
        let speedMps: Double? = speedRaw == 255 ? nil : Double(speedRaw) * speedMult

        let vertSpeedRaw = Int(buf[off + 4])
        var vertSpeedMps: Double? = nil
        if vertSpeedRaw != 0x80 {
            let signed = vertSpeedRaw > 127 ? vertSpeedRaw - 256 : vertSpeedRaw
            vertSpeedMps = Double(signed) * 0.5
        }

        // Latitude: signed 32-bit LE
        let latRaw = readInt32LE(buf, offset: off + 5)
        let lat = Double(latRaw) * 1e-7

        // Longitude: signed 32-bit LE
        let lonRaw = readInt32LE(buf, offset: off + 9)
        let lon = Double(lonRaw) * 1e-7

        // Pressure altitude: u16 LE, ×0.5m, offset -1000m
        let pressAltRaw = readUInt16LE(buf, offset: off + 13)
        let pressAltM: Double? = pressAltRaw == 0xFFFF ? nil : Double(pressAltRaw) * 0.5 - 1000

        // Geodetic altitude
        let geoAltRaw = readUInt16LE(buf, offset: off + 15)
        let geoAltM: Double? = geoAltRaw == 0xFFFF ? nil : Double(geoAltRaw) * 0.5 - 1000

        let altFt: Double
        if let geo = geoAltM {
            altFt = geo * 3.28084
        } else if let press = pressAltM {
            altFt = press * 3.28084
        } else {
            altFt = 0
        }

        return [
            "msgType": RemoteIdPlugin.MSG_LOCATION,
            "operationalStatus": status,
            "heightType": heightType,
            "headingDeg": headingDeg,
            "speedKts": speedMps != nil ? speedMps! * 1.94384 : 0,
            "vertRateFpm": vertSpeedMps != nil ? vertSpeedMps! * 196.85 : 0,
            "lat": lat,
            "lon": lon,
            "altFt": altFt,
            "altPressureFt": pressAltM != nil ? pressAltM! * 3.28084 : NSNull(),
        ]
    }

    // MARK: System (type 0x4)

    private func parseSystem(_ buf: Data, off: Int) -> [String: Any] {
        let flags = buf[off + 1]
        let classType = Int((flags >> 4) & 0x0F)
        let operatorLocType = Int(flags & 0x03)

        let opLatRaw = readInt32LE(buf, offset: off + 2)
        let opLat = Double(opLatRaw) * 1e-7

        let opLonRaw = readInt32LE(buf, offset: off + 6)
        let opLon = Double(opLonRaw) * 1e-7

        let opAltRaw = readUInt16LE(buf, offset: off + 17)
        let opAltM: Double? = opAltRaw == 0xFFFF ? nil : Double(opAltRaw) * 0.5 - 1000

        let ridType = classType == 2 ? "broadcastModule" : "standard"
        let isOperator = ridType == "standard" || operatorLocType == 1

        var result: [String: Any] = [
            "msgType": RemoteIdPlugin.MSG_SYSTEM,
            "ridType": ridType,
        ]

        if isOperator {
            result["operatorLat"] = opLat
            result["operatorLon"] = opLon
        } else {
            result["takeoffLat"] = opLat
            result["takeoffLon"] = opLon
        }

        if let alt = opAltM {
            result["operatorAltFt"] = alt * 3.28084
        }

        return result
    }

    // MARK: Self-ID (type 0x3)

    private func parseSelfId(_ buf: Data, off: Int) -> [String: Any] {
        return [
            "msgType": RemoteIdPlugin.MSG_SELF_ID,
            "description": readAscii(buf, offset: off + 2, length: 23),
        ]
    }

    // MARK: Operator ID (type 0x5)

    private func parseOperatorId(_ buf: Data, off: Int) -> [String: Any] {
        return [
            "msgType": RemoteIdPlugin.MSG_OPERATOR_ID,
            "operatorId": readAscii(buf, offset: off + 2, length: 20),
        ]
    }

    // MARK: Message Pack (type 0xF)

    private func parseMessagePack(_ buf: Data, off: Int) -> [String: Any] {
        let msgCount = Int(buf[off + 1])
        var messages: [[String: Any]] = []
        let headerSize = 2

        for i in 0..<min(msgCount, 9) {
            let subOff = off + headerSize + (i * 25)
            guard subOff + 25 <= buf.count else { break }
            if let msg = parseOdidMessage(buf, offset: subOff) {
                messages.append(msg)
            }
        }

        return [
            "msgType": RemoteIdPlugin.MSG_MESSAGE_PACK,
            "messages": messages,
        ]
    }

    // MARK: Assemble Track (ported from odid.js assembleTrack)

    private func assembleTrack(droneId: String, messages: [[String: Any]], broadcastType: String) -> [String: Any] {
        var track: [String: Any] = [
            "id": droneId,
            "idType": "unknown",
            "lat": 0.0,
            "lon": 0.0,
            "altFt": 0.0,
            "headingDeg": 0,
            "speedKts": 0.0,
            "vertRateFpm": 0.0,
            "uasType": "none",
            "ridType": "standard",
            "operationalStatus": "undeclared",
            "broadcastType": broadcastType,
            "timestamp": Date().timeIntervalSince1970 * 1000,
        ]

        for msg in messages {
            guard let msgType = msg["msgType"] as? UInt8 else { continue }

            switch msgType {
            case RemoteIdPlugin.MSG_BASIC_ID:
                track["idType"] = msg["idType"]
                track["uasType"] = msg["uasType"]
                let idType = msg["idType"] as? String ?? ""
                let uaId = msg["uaId"] as? String ?? ""
                if idType == "serialNumber" { track["serialNumber"] = uaId }
                else if idType == "sessionId" || idType == "specificSessionId" { track["sessionId"] = uaId }
                else if idType == "registrationId" { track["registrationId"] = uaId }
                if !uaId.isEmpty { track["id"] = uaId }

            case RemoteIdPlugin.MSG_LOCATION:
                track["lat"] = msg["lat"]
                track["lon"] = msg["lon"]
                track["altFt"] = msg["altFt"]
                track["altPressureFt"] = msg["altPressureFt"]
                track["headingDeg"] = msg["headingDeg"]
                track["speedKts"] = msg["speedKts"]
                track["vertRateFpm"] = msg["vertRateFpm"]
                track["operationalStatus"] = msg["operationalStatus"]

            case RemoteIdPlugin.MSG_SYSTEM:
                track["ridType"] = msg["ridType"]
                if let lat = msg["operatorLat"] { track["operatorLat"] = lat }
                if let lon = msg["operatorLon"] { track["operatorLon"] = lon }
                if let lat = msg["takeoffLat"] { track["takeoffLat"] = lat }
                if let lon = msg["takeoffLon"] { track["takeoffLon"] = lon }
                if let alt = msg["operatorAltFt"] { track["operatorAltFt"] = alt }

            case RemoteIdPlugin.MSG_OPERATOR_ID:
                track["operatorId"] = msg["operatorId"]

            case RemoteIdPlugin.MSG_MESSAGE_PACK:
                if let subMsgs = msg["messages"] as? [[String: Any]] {
                    let sub = assembleTrack(droneId: droneId, messages: subMsgs, broadcastType: broadcastType)
                    for (key, value) in sub {
                        track[key] = value
                    }
                }

            default:
                break
            }
        }

        return track
    }

    // MARK: - Helpers

    private func readAscii(_ buf: Data, offset: Int, length: Int) -> String {
        var s = ""
        for i in 0..<length {
            let idx = offset + i
            guard idx < buf.count else { break }
            let c = buf[idx]
            if c >= 0x20 && c <= 0x7E { s += String(UnicodeScalar(c)) }
        }
        return s.trimmingCharacters(in: .whitespaces)
    }

    private func readInt32LE(_ buf: Data, offset: Int) -> Int32 {
        guard offset + 4 <= buf.count else { return 0 }
        let raw = UInt32(buf[offset])
            | (UInt32(buf[offset + 1]) << 8)
            | (UInt32(buf[offset + 2]) << 16)
            | (UInt32(buf[offset + 3]) << 24)
        return Int32(bitPattern: raw)
    }

    private func readUInt16LE(_ buf: Data, offset: Int) -> UInt16 {
        guard offset + 2 <= buf.count else { return 0 }
        return UInt16(buf[offset]) | (UInt16(buf[offset + 1]) << 8)
    }
}
