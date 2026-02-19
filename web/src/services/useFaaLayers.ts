// web/src/services/useFaaLayers.ts
// React hook for fetching and managing FAA airspace layers from ArcGIS

import { useState, useEffect, useCallback, useRef } from "react";
import type { AirspaceZone, AirspaceBbox, FaaLayerId } from "./airspace";
import { FAA_LAYERS, fetchAirspace } from "./airspace";

const FAA_ENABLED_KEY = "dronedaa.faaLayers";
const DEBOUNCE_MS = 500;

function loadEnabledLayers(): Set<FaaLayerId> {
  try {
    const stored = localStorage.getItem(FAA_ENABLED_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set(FAA_LAYERS.filter((l) => l.defaultEnabled).map((l) => l.id));
}

export type FaaLayersState = {
  zones: AirspaceZone[];
  enabledLayers: Set<FaaLayerId>;
  loading: boolean;
  error: string | null;
  toggleLayer: (id: FaaLayerId) => void;
};

export function useFaaLayers(bbox: AirspaceBbox | null): FaaLayersState {
  const [enabledLayers, setEnabledLayers] = useState<Set<FaaLayerId>>(loadEnabledLayers);
  const [zones, setZones] = useState<AirspaceZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    let cancelled = false;
    const abort = new AbortController();

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);

      const activeLayers = FAA_LAYERS.filter((l) => enabledLayers.has(l.id));

      Promise.all(
        activeLayers.map((layer) =>
          fetchAirspace(bbox, layer, abort.signal).catch(() => [] as AirspaceZone[]),
        ),
      )
        .then((results) => {
          if (cancelled) return;
          setZones(results.flat());
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      abort.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bbox?.south, bbox?.west, bbox?.north, bbox?.east, enabledLayers]);

  return { zones, enabledLayers, toggleLayer, loading, error };
}
