// web/src/services/useRadarFrames.ts — radar animation frame list + playback

import { useState, useEffect, useRef, useCallback } from "react";
import { getApiBaseUrl } from "../platform";
import {
  RADAR_ANIMATION_FRAMES,
  RADAR_FRAME_HOLD_MS,
  RADAR_LOOP_PAUSE_MS,
  RADAR_REFRESH_MS,
} from "./radar";

export type RadarFramesState = {
  /** Oldest → newest ISO8601 timestamps. Empty until loaded. */
  frames: string[];
  /** Index into frames currently displayed. */
  index: number;
  /** The frame to render, or null to let the service pick the latest. */
  currentFrame: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Loads the recent frame list and, while playing, steps through it.
 *
 * Playback deliberately holds the newest frame a beat longer than the rest —
 * without that the loop reads as a flicker and it's hard to tell which frame
 * is current.
 */
export function useRadarFrames(
  enabled: boolean,
  playing: boolean,
): RadarFramesState {
  const [frames, setFrames] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchFrames = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/aviation/radar-frames?n=${RADAR_ANIMATION_FRAMES}`,
      );
      const body = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const list: string[] = body.frames ?? [];
      setFrames(list);
      setIndex(list.length ? list.length - 1 : 0); // start on the newest
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(String((err as Error)?.message ?? err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled]);

  // Load once when enabled, then keep the list current with the publish cadence
  useEffect(() => {
    mountedRef.current = true;
    fetchFrames();
    if (!enabled) return () => { mountedRef.current = false; };
    const id = setInterval(fetchFrames, RADAR_REFRESH_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchFrames, enabled]);

  // Warm the browser cache so the first loop doesn't stutter. Tiles are
  // fetched by the map itself; this just gets the frames requested early.
  useEffect(() => {
    if (!enabled || !playing || frames.length === 0) return;
    setIndex(0); // start a fresh pass from the oldest frame
  }, [enabled, playing, frames.length]);

  // Playback
  useEffect(() => {
    if (!enabled || !playing || frames.length < 2) return;
    const atNewest = index >= frames.length - 1;
    const delay = atNewest ? RADAR_LOOP_PAUSE_MS : RADAR_FRAME_HOLD_MS;
    const id = setTimeout(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, delay);
    return () => clearTimeout(id);
  }, [enabled, playing, index, frames.length]);

  // When not playing, always show the newest frame
  useEffect(() => {
    if (!playing && frames.length) setIndex(frames.length - 1);
  }, [playing, frames.length]);

  const safeIndex = frames.length ? Math.min(index, frames.length - 1) : 0;

  return {
    frames,
    index: safeIndex,
    currentFrame: frames.length ? frames[safeIndex] : null,
    loading,
    error,
  };
}
