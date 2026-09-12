// web/src/services/useMetar.ts — nearest METAR observations for a position

import { useState, useEffect, useRef, useCallback } from "react";
import { getApiBaseUrl } from "../platform";
import type { MetarResponse, MetarStation, Taf, TafResponse } from "./metar";

export type MetarState = {
  stations: MetarStation[];
  loading: boolean;
  error: string | null;
  /** ms epoch of the last successful fetch */
  lastFetch: number | null;
};

const INITIAL_STATE: MetarState = {
  stations: [],
  loading: false,
  error: null,
  lastFetch: null,
};

// METARs publish hourly (plus specials); refresh on the same cadence the
// tab is likely to be open for.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Fetches the nearest reporting METAR stations. Pass enabled=false to stay
 * idle (the Weather tab only needs this when the METAR source is selected),
 * which avoids hitting the proxy for users who never open it.
 */
export function useMetar(
  center: { lat: number; lon: number } | null,
  enabled: boolean,
  count = 3,
): MetarState & { refresh: () => void } {
  const [state, setState] = useState<MetarState>(INITIAL_STATE);
  const mountedRef = useRef(true);

  // Round the position so small GPS/map jitter doesn't refetch
  const latKey = center ? center.lat.toFixed(2) : null;
  const lonKey = center ? center.lon.toFixed(2) : null;

  const fetchMetar = useCallback(async () => {
    if (!enabled || latKey == null || lonKey == null) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const url = `${getApiBaseUrl()}/api/aviation/metar?lat=${latKey}&lon=${lonKey}&n=${count}`;
      const res = await fetch(url);
      const body: MetarResponse = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setState({
        stations: body.stations ?? [],
        loading: false,
        error: null,
        lastFetch: Date.now(),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: String((err as Error)?.message ?? err),
      }));
    }
  }, [enabled, latKey, lonKey, count]);

  useEffect(() => {
    mountedRef.current = true;
    fetchMetar();
    if (!enabled) return () => { mountedRef.current = false; };
    const id = setInterval(fetchMetar, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchMetar, enabled]);

  return { ...state, refresh: fetchMetar };
}

export type TafState = {
  taf: Taf | null;
  loading: boolean;
  error: string | null;
  /** True once a fetch completed and the station simply has no TAF issued. */
  unavailable: boolean;
};

const TAF_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // TAFs are issued every ~6h

/**
 * Fetches the TAF for one station. Only ~700 US airports issue TAFs, so
 * "no forecast for this field" is a normal outcome, not an error.
 */
export function useTaf(icaoId: string | null, enabled: boolean): TafState {
  const [state, setState] = useState<TafState>({
    taf: null,
    loading: false,
    error: null,
    unavailable: false,
  });
  const mountedRef = useRef(true);

  const fetchTaf = useCallback(async () => {
    if (!enabled || !icaoId) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/aviation/taf?ids=${encodeURIComponent(icaoId)}`,
      );
      const body: TafResponse = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setState({
        taf: body.taf ?? null,
        loading: false,
        error: null,
        unavailable: !body.taf,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setState({
        taf: null,
        loading: false,
        error: String((err as Error)?.message ?? err),
        unavailable: false,
      });
    }
  }, [icaoId, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    fetchTaf();
    if (!enabled || !icaoId) return () => { mountedRef.current = false; };
    const id = setInterval(fetchTaf, TAF_REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchTaf, enabled, icaoId]);

  return state;
}
