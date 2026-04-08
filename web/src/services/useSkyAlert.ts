// web/src/services/useSkyAlert.ts
// Reads/writes uAvionix skyAlert settings via its JSON API.
//   GET  /settings/?action=get  → current settings JSON
//   POST /settings/?action=set  → save settings JSON

import { useState, useEffect, useRef, useCallback } from "react";
import { isNative } from "../platform";

const DIRECT_BASE = "http://192.168.4.1";
const PROXY_BASE = "/skyalert";
const PROBE_INTERVAL_MS = 15_000;
const FETCH_TIMEOUT_MS = 3_000;

function base(): string {
  if (isNative()) return DIRECT_BASE;
  const host = window.location.hostname;
  const port = window.location.port;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  // When served by the relay (port 4001), use the relay's skyAlert proxy
  if (isLocalhost && port === "4001") return `http://${window.location.host}/skyalert`;
  // Dev mode — Vite proxies /skyalert → relay
  if (isLocalhost) return PROXY_BASE;
  // Production (detectandavoid.com) — route through local relay proxy
  return "http://127.0.0.1:4001/skyalert";
}

// ── Types matching the skyAlert JSON API ──

export interface SkyAlertWifi {
  ssid: string;
  hidden: boolean;
  security: boolean;
  password: string;
  channel: number;       // 0 = auto
  power: number;         // 1-9
  operationalChannel?: number;
  dirty?: boolean;
}

export interface SkyAlertLed {
  brightness: number;    // 0-100
  auto: boolean;
}

export interface SkyAlertTpa {
  altitude_ft: number;
  range_m: number;       // stored in meters
  volume: number;        // 0-100
}

export interface SkyAlertOwnshipFilter {
  icaoAddress: string | null;
  flarmId: string | null;
}

export interface SkyAlertGps {
  lat: number;
  lon: number;
}

export interface SkyAlertSettings {
  wifi: SkyAlertWifi;
  led: SkyAlertLed;
  Power: { powerSavings: boolean };
  trafficProximityAlert: SkyAlertTpa;
  ownshipFilter: SkyAlertOwnshipFilter;
  coAlarmLevel?: number;
}

export interface SkyAlertState {
  detected: boolean;
  settings: SkyAlertSettings | null;
  gps: SkyAlertGps | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  reload: () => void;
  save: (settings: SkyAlertSettings) => Promise<boolean>;
  action: (name: string) => Promise<boolean>;
}

const EMPTY: SkyAlertState = {
  detected: false,
  settings: null,
  gps: null,
  loading: false,
  saving: false,
  error: null,
  reload: () => {},
  save: async () => false,
  action: async () => false,
};

export function useSkyAlert(adsbConnected: boolean): SkyAlertState {
  const [detected, setDetected] = useState(false);
  const [settings, setSettings] = useState<SkyAlertSettings | null>(null);
  const [gps, setGps] = useState<SkyAlertGps | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const probeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchGps = useCallback(async () => {
    // Try JSON status endpoint first, then parse HTML status page
    const endpoints = [
      `${base()}/status/?action=get`,
      `${base()}/?action=get`,
      `${base()}/status/`,
      `${base()}/`,
    ];
    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const text = await res.text();

        // Try JSON parse first
        try {
          const json = JSON.parse(text);
          if (json.gps?.lat && json.gps?.lon) {
            setGps({ lat: json.gps.lat, lon: json.gps.lon });
            return;
          }
          // Some devices put position at top level
          if (json.lat && json.lon) {
            setGps({ lat: json.lat, lon: json.lon });
            return;
          }
        } catch { /* not JSON, try HTML */ }

        // Parse HTML for GPS coordinates — look for patterns like "39.121616, -77.7162752"
        const coordMatch = text.match(/(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/);
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lon = parseFloat(coordMatch[2]);
          if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && lat !== 0 && lon !== 0) {
            setGps({ lat, lon });
            return;
          }
        }
      } catch { /* skip */ }
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(`${base()}/settings/?action=get`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SkyAlertSettings = await res.json();
      if (!mountedRef.current) return;
      setSettings(json);
      setDetected(true);
    } catch {
      if (!mountedRef.current) return;
      setDetected(false);
      setSettings(null);
      setGps(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!adsbConnected) {
      setDetected(false);
      setSettings(null);
      setGps(null);
      return;
    }
    fetchSettings();
    fetchGps();
    probeTimer.current = setInterval(() => { fetchSettings(); fetchGps(); }, PROBE_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (probeTimer.current) clearInterval(probeTimer.current);
    };
  }, [adsbConnected, fetchSettings, fetchGps]);

  const save = useCallback(async (data: SkyAlertSettings): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${base()}/settings/?action=set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchSettings();
      return true;
    } catch (err: any) {
      if (mountedRef.current) setError(err?.message ?? "Save failed");
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [fetchSettings]);

  // skyAlert actions all use POST /settings/?action=set with special JSON payloads
  const ACTION_PAYLOADS: Record<string, object> = {
    resetDefaults: { loadDefaults: true },
    testAlarm: { tests: { coAlarm: true } },
    silenceAlarm: { tests: { coAlarm: false } },
    testLeds: { tests: { LED: true } },
  };

  const action = useCallback(async (name: string): Promise<boolean> => {
    setError(null);
    const payload = ACTION_PAYLOADS[name];
    if (!payload) {
      setError(`Unknown action: ${name}`);
      return false;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${base()}/settings/?action=set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch (err: any) {
      if (mountedRef.current) setError(err?.message ?? `Action ${name} failed`);
      return false;
    }
  }, []);

  if (!adsbConnected) return EMPTY;
  return { detected, settings, gps, loading, saving, error, reload: fetchSettings, save, action };
}
