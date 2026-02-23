// web/src/services/useAdsb.ts
// React hook for live ADS-B data from GDL90 relay (web) or Capacitor plugin (iOS)

import { useState, useEffect, useRef, useCallback } from "react";
import { isNative } from "../platform";
import type { AircraftTrack, AdsbSnapshot } from "./adsb";
import { GDL90 } from "./GDL90Plugin";

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
  /** Diagnostic: the WebSocket URL being used */
  wsUrl: string;
  /** Diagnostic: last error or close reason */
  lastError: string | null;
};

const INITIAL_STATE: AdsbState = {
  aircraft: [],
  ownship: null,
  status: "disconnected",
  receiverConnected: false,
  gpsValid: false,
  count: 0,
  lastUpdate: null,
  wsUrl: "",
  lastError: null,
};

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 10000;

function getWsUrl(): string {
  const host = window.location.hostname;
  const port = window.location.port;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  if (isLocalhost && port === "4001") {
    // Running from relay's built-in HTTP server — same-origin WebSocket
    return `ws://${window.location.host}`;
  }
  if (isLocalhost) {
    // Dev mode — Vite proxies /ws/adsb → relay on 4001
    return `ws://${window.location.host}/ws/adsb`;
  }
  // Production (detectandavoid.com) — direct to local relay
  // May be blocked by mixed content; relay tray opens localhost:4001 instead
  return "ws://127.0.0.1:4001";
}

export function useAdsb(): AdsbState {
  const [state, setState] = useState<AdsbState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const backoffRef = useRef(RECONNECT_BASE_MS);

  const nativePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    // On native iOS, use Capacitor GDL90 plugin for direct UDP
    if (isNative()) {
      GDL90.startListening({ port: 4000 }).then(({ started }) => {
        if (!mountedRef.current) return;
        if (started) {
          setState((prev) => ({ ...prev, status: "connected", wsUrl: "native://gdl90", lastError: null }));
        }
      }).catch((err: any) => {
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, lastError: `Native GDL90: ${err?.message ?? err}` }));
      });

      // Poll getSnapshot at 1Hz
      nativePollRef.current = setInterval(async () => {
        if (!mountedRef.current) return;
        try {
          const snapshot = await GDL90.getSnapshot();
          setState({
            aircraft: snapshot.aircraft ?? [],
            ownship: snapshot.ownship ?? null,
            status: snapshot.receiverConnected ? "receiving" : "connected",
            receiverConnected: snapshot.receiverConnected,
            gpsValid: snapshot.gpsValid,
            count: snapshot.count,
            lastUpdate: snapshot.timestamp,
            wsUrl: "native://gdl90",
            lastError: null,
          });
        } catch {
          // ignore transient errors
        }
      }, 1000);
      return;
    }

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = getWsUrl();
    setState((prev) => ({ ...prev, status: "connecting", wsUrl, lastError: null }));

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = RECONNECT_BASE_MS; // reset on success
      setState((prev) => ({ ...prev, status: "connected", lastError: null }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const snapshot: AdsbSnapshot = JSON.parse(event.data);
        if (snapshot.type === "snapshot") {
          setState((prev) => ({
            ...prev,
            aircraft: snapshot.aircraft,
            ownship: snapshot.ownship,
            status: snapshot.receiverConnected ? "receiving" : "connected",
            receiverConnected: snapshot.receiverConnected,
            gpsValid: snapshot.gpsValid,
            count: snapshot.count,
            lastUpdate: snapshot.timestamp,
          }));
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      const reason = event.reason
        ? `${event.code}: ${event.reason}`
        : `code ${event.code}`;
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        receiverConnected: false,
        lastError: `Closed (${reason})`,
      }));
      // Auto-reconnect with exponential backoff
      reconnectRef.current = setTimeout(connect, backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
    };

    ws.onerror = () => {
      // Record that an error occurred (onclose will fire after this)
      setState((prev) => ({ ...prev, lastError: "Connection error" }));
      ws.close();
    };
  }, []);

  // Reconnect immediately when page becomes visible (user switched back to browser)
  const reconnectNow = useCallback(() => {
    if (!mountedRef.current) return;
    // Only act if currently disconnected (waiting on backoff timer)
    if (wsRef.current) return;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    backoffRef.current = RECONNECT_BASE_MS;
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const onVisibility = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };
    const onFocus = () => reconnectNow();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      if (nativePollRef.current) {
        clearInterval(nativePollRef.current);
        nativePollRef.current = null;
        GDL90.stopListening().catch(() => {});
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, [connect, reconnectNow]);

  return state;
}
