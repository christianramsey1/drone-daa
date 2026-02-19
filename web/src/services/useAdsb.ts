// web/src/services/useAdsb.ts
// React hook for live ADS-B data from GDL90 relay (web) or Capacitor plugin (iOS)

import { useState, useEffect, useRef, useCallback } from "react";
import { isNative } from "../platform";
import type { AircraftTrack, AdsbSnapshot } from "./adsb";

export type AdsbConnectionStatus =
  | "disconnected"   // WebSocket not connected
  | "connecting"     // WebSocket connecting
  | "connected"      // WebSocket connected, no UDP data from receiver
  | "receiving";     // WebSocket connected AND receiver is streaming

export type AdsbState = {
  aircraft: AircraftTrack[];
  ownship: AircraftTrack | null;
  status: AdsbConnectionStatus;
  receiverConnected: boolean;
  gpsValid: boolean;
  count: number;
  lastUpdate: number | null;
};

const INITIAL_STATE: AdsbState = {
  aircraft: [],
  ownship: null,
  status: "disconnected",
  receiverConnected: false,
  gpsValid: false,
  count: 0,
  lastUpdate: null,
};

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

export function useAdsb(): AdsbState {
  const [state, setState] = useState<AdsbState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const backoffRef = useRef(RECONNECT_BASE_MS);

  const connect = useCallback(() => {
    // On native iOS, skip WebSocket — future Capacitor plugin
    if (isNative()) return;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState((prev) => ({ ...prev, status: "connecting" }));

    // In dev: Vite proxies /ws/adsb → relay on 4001
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/adsb`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = RECONNECT_BASE_MS; // reset on success
      setState((prev) => ({ ...prev, status: "connected" }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const snapshot: AdsbSnapshot = JSON.parse(event.data);
        if (snapshot.type === "snapshot") {
          setState({
            aircraft: snapshot.aircraft,
            ownship: snapshot.ownship,
            status: snapshot.receiverConnected ? "receiving" : "connected",
            receiverConnected: snapshot.receiverConnected,
            gpsValid: snapshot.gpsValid,
            count: snapshot.count,
            lastUpdate: snapshot.timestamp,
          });
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        receiverConnected: false,
      }));
      // Auto-reconnect with exponential backoff
      reconnectRef.current = setTimeout(connect, backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

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
  }, [connect]);

  return state;
}
