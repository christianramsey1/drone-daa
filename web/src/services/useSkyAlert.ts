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
  return isNative() ? DIRECT_BASE : PROXY_BASE;
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const probeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

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
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!adsbConnected) {
      setDetected(false);
      setSettings(null);
      return;
    }
    fetchSettings();
    probeTimer.current = setInterval(fetchSettings, PROBE_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (probeTimer.current) clearInterval(probeTimer.current);
    };
  }, [adsbConnected, fetchSettings]);

  const save = useCallback(async (data: SkyAlertSettings): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${base()}/settings/?action=set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
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

  const action = useCallback(async (name: string): Promise<boolean> => {
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      // skyAlert actions use GET requests
      const res = await fetch(`${base()}/settings/?action=${name}`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch (err: any) {
      if (mountedRef.current) setError(err?.message ?? `Action ${name} failed`);
      return false;
    }
  }, []);

  if (!adsbConnected) return EMPTY;
  return { detected, settings, loading, saving, error, reload: fetchSettings, save, action };
}
