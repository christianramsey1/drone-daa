// web/src/services/useFaaLayers.ts
// React hook for fetching and managing FAA airspace layers from ArcGIS

import { useState, useEffect, useCallback, useRef } from "react";
import type { AirspaceZone, AirspaceBbox, FaaLayerId, ObstructionPoint } from "./airspace";
import { FAA_LAYERS, fetchAirspace, fetchObstructions } from "./airspace";

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
  obstructions: ObstructionPoint[];
  enabledLayers: Set<FaaLayerId>;
  loading: boolean;
  error: string | null;
  toggleLayer: (id: FaaLayerId) => void;
};

export function useFaaLayers(bbox: AirspaceBbox | null): FaaLayersState {
  const [enabledLayers, setEnabledLayers] = useState<Set<FaaLayerId>>(loadEnabledLayers);
  const [zones, setZones] = useState<AirspaceZone[]>([]);
  const [obstructions, setObstructions] = useState<ObstructionPoint[]>([]);
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
      setObstructions([]);
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    let cancelled = false;
    const abort = new AbortController();

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);

      // Separate polygon layers from point layers (obstructions)
      const polygonLayers = FAA_LAYERS.filter((l) => enabledLayers.has(l.id) && l.id !== "obstructions");
      const obstructionsEnabled = enabledLayers.has("obstructions");

      const polygonPromise = polygonLayers.length > 0
        ? Promise.all(
            polygonLayers.map((layer) =>
              fetchAirspace(bbox, layer, abort.signal).catch(() => [] as AirspaceZone[]),
            ),
          ).then((results) => results.flat())
        : Promise.resolve([] as AirspaceZone[]);

      const obsPromise = obstructionsEnabled
        ? fetchObstructions(bbox, abort.signal).catch(() => [] as ObstructionPoint[])
        : Promise.resolve([] as ObstructionPoint[]);

      Promise.all([polygonPromise, obsPromise])
        .then(([zoneResults, obsResults]) => {
          if (cancelled) return;
          setZones(zoneResults);
          setObstructions(obsResults);
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

  return { zones, obstructions, enabledLayers, toggleLayer, loading, error };
}
