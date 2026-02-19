// web/src/services/useRemoteId.ts
// React hook for Remote ID drone detection via BLE / WebSocket relay

import { useState, useEffect, useRef, useCallback } from "react";
import { isNative } from "../platform";
import type { DroneTrack, RidSnapshot } from "./remoteId";
import { ODID_BLE_SERVICE_UUID } from "./remoteId";

export type RidConnectionStatus =
  | "unavailable"  // Web Bluetooth not supported
  | "idle"         // Not scanning
  | "scanning"     // Actively scanning
  | "receiving";   // Scanning and receiving RID data

export type RidState = {
  drones: DroneTrack[];
  status: RidConnectionStatus;
  count: number;
  lastUpdate: number | null;
  error: string | null;
};

const INITIAL_STATE: RidState = {
  drones: [],
  status: "idle",
  count: 0,
  lastUpdate: null,
  error: null,
};

const STALE_TIMEOUT_MS = 30_000; // Remove drones not seen in 30s
const WS_RECONNECT_BASE_MS = 3_000;
const WS_RECONNECT_MAX_MS = 30_000;

export function useRemoteId(): RidState & {
  startScan: () => void;
  stopScan: () => void;
} {
  const [state, setState] = useState<RidState>(INITIAL_STATE);
  const dronesRef = useRef<Map<string, DroneTrack>>(new Map());
  const scanningRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(WS_RECONNECT_BASE_MS);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Sync dronesRef → state
  const syncState = useCallback(() => {
    if (!mountedRef.current) return;
    const list = Array.from(dronesRef.current.values());
    setState((prev) => ({
      ...prev,
      drones: list,
      count: list.length,
      lastUpdate: Date.now(),
      status: scanningRef.current ? (list.length > 0 ? "receiving" : "scanning") : "idle",
    }));
  }, []);

  // WebSocket relay connection (fallback when BLE scan unavailable)
  const connectRelay = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/rid`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = WS_RECONNECT_BASE_MS;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const snapshot: RidSnapshot = JSON.parse(event.data);
        if (snapshot.type === "rid-snapshot") {
          dronesRef.current.clear();
          for (const d of snapshot.drones) {
            dronesRef.current.set(d.id, d);
          }
          syncState();
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current || !scanningRef.current) return;
      wsRef.current = null;
      reconnectRef.current = setTimeout(connectRelay, backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, WS_RECONNECT_MAX_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [syncState]);

  // Start scanning
  const startScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;

    if (isNative()) {
      // Future: Capacitor plugin for CoreBluetooth RID scanning
      setState((prev) => ({
        ...prev,
        status: "scanning",
        error: "Native RID scanning coming soon. Use WebSocket relay.",
      }));
      connectRelay();
      return;
    }

    // Try Web Bluetooth LE scan (experimental, Chrome with flag)
    const bt = (navigator as any).bluetooth;
    if (bt && "requestLEScan" in bt) {
      try {
        setState((prev) => ({ ...prev, status: "scanning", error: null }));
        const scan = await bt.requestLEScan({
          filters: [{ services: [ODID_BLE_SERVICE_UUID] }],
          keepRepeatedDevices: true,
        });

        bt.addEventListener(
          "advertisementreceived",
          (event: any) => {
            if (!mountedRef.current) return;
            // TODO: Parse Open Drone ID advertisement data from event.manufacturerData
            // For now, create a basic track from the device info
            const deviceId = event.device?.id ?? `ble-${Date.now()}`;
            const existing = dronesRef.current.get(deviceId);
            if (existing) {
              existing.timestamp = Date.now();
              existing.rssi = event.rssi ?? existing.rssi;
            }
            // Full parsing will use parseRidAdvertisement() from remoteId.ts
            syncState();
          },
        );

        // Clean up on scan stop
        scan.addEventListener("stop", () => {
          if (scanningRef.current) {
            // Scan stopped externally, fall back to relay
            connectRelay();
          }
        });

        return;
      } catch (err: any) {
        // BLE scan failed, fall back to WebSocket relay
        setState((prev) => ({
          ...prev,
          error: `BLE: ${err.message}. Using relay.`,
        }));
      }
    }

    // Fall back to WebSocket relay
    setState((prev) => ({ ...prev, status: "scanning", error: null }));
    connectRelay();
  }, [connectRelay, syncState]);

  // Stop scanning
  const stopScan = useCallback(() => {
    scanningRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    setState((prev) => ({ ...prev, status: "idle" }));
  }, []);

  // Prune stale drones every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, drone] of dronesRef.current) {
        if (now - drone.timestamp > STALE_TIMEOUT_MS) {
          dronesRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) syncState();
    }, 5_000);

    return () => clearInterval(interval);
  }, [syncState]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, []);

  return { ...state, startScan, stopScan };
}
