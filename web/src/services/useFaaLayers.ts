// web/src/services/useFaaLayers.ts
// React hook for fetching and managing FAA airspace layers from ArcGIS
// Caches results in IndexedDB for offline field use.

import { useState, useEffect, useCallback, useRef } from "react";
import type { AirspaceZone, AirspaceBbox, FaaLayerId, ObstructionPoint } from "./airspace";
import { FAA_LAYERS, fetchAirspace, fetchObstructions } from "./airspace";
import { cacheFaaLayer, getCachedFaaLayer } from "./offlineTiles";

const FAA_ENABLED_KEY = "dronedaa.faaLayers";
const DEBOUNCE_MS = 800;

function loadEnabledLayers(): Set<FaaLayerId> {
  try {
    const stored = localStorage.getItem(FAA_ENABLED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set(FAA_LAYERS.filter((l) => l.defaultEnabled).map((l) => l.id));
}

export type FaaLayersState = {
  zones: AirspaceZone[];
  obstructions: ObstructionPoint[];
  enabledLayers: Set<FaaLayerId>;
  loading: boolean;
  error: string | null;
  toggleLayer: (id: FaaLayerId) => void;
};

/** Try to fetch a layer from ArcGIS; on failure, fall back to IndexedDB cache. */
async function fetchWithCache(
  bbox: AirspaceBbox,
  layer: typeof FAA_LAYERS[number],
  signal: AbortSignal,
): Promise<AirspaceZone[]> {
  try {
    const zones = await fetchAirspace(bbox, layer, signal);
    // Cache in background (don't await — fire-and-forget)
    cacheFaaLayer(layer.id, bbox, JSON.stringify(zones)).catch(() => {});
    return zones;
  } catch (err: any) {
    // If aborted, don't fall back to cache — let the caller handle it
    if (signal.aborted) throw err;
    // Network failure → try IndexedDB cache
    const cached = await getCachedFaaLayer(layer.id, bbox);
    if (cached) return JSON.parse(cached) as AirspaceZone[];
    return [];
  }
}

async function fetchObsWithCache(
  bbox: AirspaceBbox,
  signal: AbortSignal,
): Promise<ObstructionPoint[]> {
  try {
    const obs = await fetchObstructions(bbox, signal);
    cacheFaaLayer("obstructions", bbox, JSON.stringify(obs)).catch(() => {});
    return obs;
  } catch (err: any) {
    if (signal.aborted) throw err;
    const cached = await getCachedFaaLayer("obstructions", bbox);
    if (cached) return JSON.parse(cached) as ObstructionPoint[];
    return [];
  }
}

export function useFaaLayers(bbox: AirspaceBbox | null): FaaLayersState {
  const [enabledLayers, setEnabledLayers] = useState<Set<FaaLayerId>>(loadEnabledLayers);
  const [zones, setZones] = useState<AirspaceZone[]>([]);
  const [obstructions, setObstructions] = useState<ObstructionPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist enabled layers
  useEffect(() => {
    localStorage.setItem(FAA_ENABLED_KEY, JSON.stringify([...enabledLayers]));
  }, [enabledLayers]);

  const toggleLayer = useCallback((id: FaaLayerId) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Fetch enabled layers when bbox or enabledLayers change (debounced)
  useEffect(() => {
    if (!bbox || enabledLayers.size === 0) {
      setZones([]);
      setObstructions([]);
      setLoading(false);
      return;
    }

    // Debounce: clear any pending fetch, but DON'T abort in-flight requests
    // so previous results stay visible until new ones arrive.
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Capture bbox/layers for this effect run
    const currentBbox = bbox;
    const currentEnabled = enabledLayers;

    debounceRef.current = setTimeout(() => {
      // Abort any previous in-flight fetch now that we're starting a new one
      if (abortRef.current) abortRef.current.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setLoading(true);
      setError(null);

      const polygonLayers = FAA_LAYERS.filter(
        (l) => currentEnabled.has(l.id) && l.id !== "obstructions",
      );
      const obstructionsEnabled = currentEnabled.has("obstructions");

      const polygonPromise = polygonLayers.length > 0
        ? Promise.all(
            polygonLayers.map((layer) => fetchWithCache(currentBbox, layer, abort.signal)),
          ).then((results) => results.flat())
        : Promise.resolve([] as AirspaceZone[]);

      const obsPromise = obstructionsEnabled
        ? fetchObsWithCache(currentBbox, abort.signal)
        : Promise.resolve([] as ObstructionPoint[]);

      Promise.all([polygonPromise, obsPromise])
        .then(([zoneResults, obsResults]) => {
          // Only update if this is still the active request
          if (abort.signal.aborted) return;
          setZones(zoneResults);
          setObstructions(obsResults);
          setLoading(false);
        })
        .catch((err) => {
          if (abort.signal.aborted) return;
          // Keep existing zones on error — don't wipe them
          setError(err.message);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Note: we do NOT abort here — let in-flight requests complete
      // so their results remain visible. The next fetch will abort them.
    };
  }, [bbox?.south, bbox?.west, bbox?.north, bbox?.east, enabledLayers]);

  return { zones, obstructions, enabledLayers, toggleLayer, loading, error };
}
