import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "./platform";

declare global {
  interface Window {
    mapkit?: any;
    __mapkitPromise?: Promise<any>;
    __mapkitInited?: boolean;
  }
}

export type Annotation = {
  id: string;
  lat: number;
  lon: number;
  title?: string;
  subtitle?: string;
  style?: string;
  kind?: string;
  emoji?: string;
  color?: string; // For seamark circle colors (red/green)
};

export type Polyline = {
  id: string;
  points: Array<{ lat: number; lon: number }>;
  width?: number;
  opacity?: number;
  color?: string;
  dashed?: boolean;
};

export type TileOverlayConfig = {
  id: string;
  urlTemplate: string; // e.g., "https://.../{z}/{x}/{y}.png"
  opacity?: number;
};

type Props = {
  variant?: "full" | "mini";
  center?: { lat: number; lon: number };
  className?: string;
  annotations?: Annotation[];
  polylines?: Polyline[];
  tileOverlays?: TileOverlayConfig[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
};

const DEFAULT_CENTER = { lat: 37.093, lon: -79.671 };

/**
 * Creates a small circle marker with white halo for channel markers
 */
function createSeamarkIcon(color: string): HTMLCanvasElement {
  const size = 12;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const center = size / 2;
  const radius = 4;

  // Check if it's a light color that needs a dark border
  const colorLower = color.toLowerCase();
  const isLightColor = colorLower.includes("#e0e0e0") ||
                       colorLower.includes("#ffd60a") ||
                       colorLower.includes("white") ||
                       colorLower.includes("yellow");

  // White halo (outer circle)
  ctx.beginPath();
  ctx.arc(center, center, radius + 1.5, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fill();

  // Colored inner circle
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  // Add dark border for light-colored markers so they're visible
  if (isLightColor) {
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  return canvas;
}

/**
 * Creates a start waypoint marker (upward triangle with black border)
 */
function createStartWaypointIcon(color: string): HTMLCanvasElement {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const centerX = size / 2;
  const centerY = size / 2;
  const triangleSize = 9;

  // Black border triangle
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - triangleSize - 2.5);
  ctx.lineTo(centerX - triangleSize - 2, centerY + triangleSize + 2);
  ctx.lineTo(centerX + triangleSize + 2, centerY + triangleSize + 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fill();

  // Colored triangle
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - triangleSize);
  ctx.lineTo(centerX - triangleSize, centerY + triangleSize);
  ctx.lineTo(centerX + triangleSize, centerY + triangleSize);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  return canvas;
}

/**
 * Creates an end waypoint marker (octagon/stop sign with black border)
 */
function createEndWaypointIcon(color: string): HTMLCanvasElement {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = 9;
  const angle = Math.PI / 8; // 22.5 degrees

  // Helper function to draw octagon
  function drawOctagon(cx: number, cy: number, r: number) {
    if (!ctx) return;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const theta = angle + (i * Math.PI / 4);
      const x = cx + r * Math.cos(theta);
      const y = cy + r * Math.sin(theta);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }

  // Black border octagon
  drawOctagon(centerX, centerY, radius + 2.5);
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fill();

  // Colored octagon
  drawOctagon(centerX, centerY, radius);
  ctx.fillStyle = color;
  ctx.fill();

  return canvas;
}

/**
 * Creates a GPS position marker (pulsing blue dot with white border)
 */
function createGpsPositionIcon(color: string): HTMLCanvasElement {
  const size = 20;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const centerX = size / 2;
  const centerY = size / 2;

  // White border circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();

  // Colored inner circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Small white center dot for depth
  ctx.beginPath();
  ctx.arc(centerX - 1.5, centerY - 1.5, 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();

  return canvas;
}

function ensureMapKitCss() {
  const id = "mapkit-css";
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.css";
  document.head.appendChild(link);
}

function loadMapKit(): Promise<any> {
  if (window.mapkit) return Promise.resolve(window.mapkit);
  if (window.__mapkitPromise) return window.__mapkitPromise;

  ensureMapKitCss();

  window.__mapkitPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-mapkit="true"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(window.mapkit));
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load existing mapkit.js"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.dataset.mapkit = "true";

    script.onload = () => {
      if (!window.mapkit) {
        reject(new Error("mapkit.js loaded but window.mapkit is missing"));
        return;
      }
      resolve(window.mapkit);
    };

    script.onerror = () => reject(new Error("Failed to load mapkit.js"));
    document.head.appendChild(script);
  });

  return window.__mapkitPromise;
}

async function fetchToken(): Promise<string> {
  const r = await fetch(`${getApiBaseUrl()}/api/mapkit/token`, { cache: "no-store" });
  const t = await r.text();
  if (!r.ok) throw new Error(`token endpoint failed ${r.status}: ${t}`);
  if (!t || t.length < 50) throw new Error(`token looks wrong: "${t}"`);
  return t.trim();
}

export default function MapKitMap({
  variant = "full",
  center,
  className,
  annotations = [],
  polylines = [],
  tileOverlays = [],
  selectedId,
  onSelect,
  onMapClick,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [status, setStatus] = useState("initializing");

  // Store annotation and polyline objects by ID
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annotationsMapRef = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polylinesMapRef = useRef<Map<string, any>>(new Map());

  // Initialize MapKit
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStatus("loading mapkit.js");
        const mapkit = await loadMapKit();
        if (cancelled) return;

        if (!window.__mapkitInited) {
          setStatus("initializing mapkit");
          mapkit.init({
            authorizationCallback: async (done: (token: string) => void) => {
              try {
                const token = await fetchToken();
                done(token);
              } catch (e: any) {
                console.error("[MapKit] token fetch failed", e);
                setStatus(`token error: ${e.message}`);
                done("");
              }
            },
          });
          window.__mapkitInited = true;
        }

        if (!elRef.current) return;

        const c = center ?? DEFAULT_CENTER;
        const region = new mapkit.CoordinateRegion(
          new mapkit.Coordinate(c.lat, c.lon),
          new mapkit.CoordinateSpan(0.18, 0.18)
        );

        if (!mapRef.current) {
          setStatus("creating map");

          const mapOptions = {
            region,
            showsCompass: mapkit.FeatureVisibility.Visible,
            showsZoomControl: true,
            showsMapTypeControl: true, // Show satellite/hybrid/standard picker
            showsUserLocation: true, // Show native blue dot for user location
            showsUserLocationControl: true, // Show "locate me" button
            isRotationEnabled: true,
            isScrollEnabled: true,
            isZoomEnabled: true,
            mapType: mapkit.Map.MapTypes.Standard,
            colorScheme: mapkit.Map.ColorSchemes.Dark,
          };

          mapRef.current = new mapkit.Map(elRef.current, mapOptions);

          mapRef.current.addEventListener("error", (evt: any) => {
            console.error("[MapKit] map error event:", evt);
            setStatus(`map error: ${evt?.message || "unknown"}`);
          });

          setStatus("ready");
        } else {
          mapRef.current.region = region;
          setStatus("ready");
        }
      } catch (e: any) {
        console.error("[MapKit] init failure:", e);
        setStatus(`error: ${String(e?.message || e)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lon]);

  // Add click handler for map (not annotations)
  useEffect(() => {
    if (!mapRef.current || !onMapClick || status !== "ready") return;

    const map = mapRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMapClick = (event: any) => {
      // Only handle clicks on the map itself, not on annotations
      if (!event.pointOnPage) return;

      try {
        const coordinate = map.convertPointOnPageToCoordinate(event.pointOnPage);
        onMapClick(coordinate.latitude, coordinate.longitude);
      } catch (err) {
        console.error("[MapKit] Failed to convert click to coordinate:", err);
      }
    };

    // Use MapKit's single-tap event which fires only for map clicks, not annotation clicks
    map.addEventListener("single-tap", handleMapClick);

    return () => {
      map.removeEventListener("single-tap", handleMapClick);
    };
  }, [onMapClick, status]);

  // Update annotations
  useEffect(() => {
    if (!mapRef.current || !window.mapkit || status !== "ready") return;

    const mapkit = window.mapkit;
    const map = mapRef.current;

    // Create a set of current annotation IDs
    const currentIds = new Set(annotations.map((a) => a.id));

    // Remove annotations that are no longer in the list
    const toRemove: string[] = [];
    annotationsMapRef.current.forEach((annotation, id) => {
      if (!currentIds.has(id)) {
        map.removeAnnotation(annotation);
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => annotationsMapRef.current.delete(id));

    // Add or update annotations
    annotations.forEach((a) => {
      let annotation = annotationsMapRef.current.get(a.id);

      if (!annotation) {
        // Create new annotation
        const coord = new mapkit.Coordinate(a.lat, a.lon);

        // Use custom circle icon for seamarks
        if (a.style === "seamark") {
          // Use custom circle icon
          const canvas = createSeamarkIcon(a.color ?? "#ff3b30");
          const url = canvas.toDataURL();

          annotation = new mapkit.ImageAnnotation(coord, {
            title: a.title,
            subtitle: a.subtitle,
            data: { id: a.id, style: a.style },
            url: { 1: url },
            size: { width: 12, height: 12 },
            anchorOffset: new DOMPoint(0, 0),
            calloutEnabled: true,
            // Custom minimal callout for channel markers
            callout: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              calloutContentForAnnotation: (ann: any) => {
                const el = document.createElement("div");
                el.style.cssText = `
                  font-family: system-ui, -apple-system, sans-serif;
                  font-size: 10px;
                  line-height: 1.3;
                  padding: 4px 6px;
                  max-width: 120px;
                  text-align: center;
                `;
                if (ann.title) {
                  const title = document.createElement("div");
                  title.style.cssText = "font-weight: 600; color: #fff;";
                  title.textContent = ann.title;
                  el.appendChild(title);
                }
                if (ann.subtitle) {
                  const subtitle = document.createElement("div");
                  subtitle.style.cssText = "color: rgba(255,255,255,0.7); font-size: 9px; margin-top: 1px;";
                  subtitle.textContent = ann.subtitle;
                  el.appendChild(subtitle);
                }
                return el;
              },
            },
          });
        } else if (a.style === "waypoint-start" || a.style === "waypoint-end") {
          // Use custom shapes for waypoints (triangle for start, octagon for end)
          const canvas = a.style === "waypoint-start"
            ? createStartWaypointIcon(a.color ?? "#16a34a")
            : createEndWaypointIcon(a.color ?? "#dc2626");
          const url = canvas.toDataURL();

          annotation = new mapkit.ImageAnnotation(coord, {
            title: a.title,
            subtitle: a.subtitle,
            data: { id: a.id, style: a.style },
            url: { 1: url },
            size: { width: 24, height: 24 },
            anchorOffset: new DOMPoint(0, -12),
            calloutEnabled: false,
          });
        } else if (a.style === "gps-position") {
          // GPS position marker (blue dot)
          const canvas = createGpsPositionIcon(a.color ?? "#007aff");
          const url = canvas.toDataURL();

          annotation = new mapkit.ImageAnnotation(coord, {
            title: a.title,
            subtitle: a.subtitle,
            data: { id: a.id, style: a.style },
            url: { 1: url },
            size: { width: 20, height: 20 },
            anchorOffset: new DOMPoint(0, 0),
            calloutEnabled: false,
          });
        } else {
          // Regular marker annotation for POIs
          annotation = new mapkit.MarkerAnnotation(coord, {
            title: a.title,
            subtitle: a.subtitle,
            data: { id: a.id, style: a.style, emoji: a.emoji },
            calloutEnabled: false, // Disable callouts - we use side panel for details
          });

          // Style POI markers
          if (a.style === "poi" && a.emoji) {
            annotation.glyphText = a.emoji;
            annotation.color = "#007aff";
          }
        }

        // Handle selection
        annotation.addEventListener("select", () => {
          if (onSelect) onSelect(a.id);
        });

        map.addAnnotation(annotation);
        annotationsMapRef.current.set(a.id, annotation);
      } else {
        // Update existing annotation
        annotation.coordinate = new mapkit.Coordinate(a.lat, a.lon);
        annotation.title = a.title;
        annotation.subtitle = a.subtitle;
      }

      // Update selection state
      if (selectedId === a.id) {
        annotation.selected = true;
      } else {
        annotation.selected = false;
      }
    });
  }, [annotations, status, selectedId, onSelect]);

  // Update polylines
  useEffect(() => {
    if (!mapRef.current || !window.mapkit || status !== "ready") return;

    const mapkit = window.mapkit;
    const map = mapRef.current;

    // Create a set of current polyline IDs
    const currentIds = new Set(polylines.map((p) => p.id));

    // Remove polylines that are no longer in the list
    const toRemove: string[] = [];
    polylinesMapRef.current.forEach((polyline, id) => {
      if (!currentIds.has(id)) {
        map.removeOverlay(polyline);
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => polylinesMapRef.current.delete(id));

    // Add or update polylines
    polylines.forEach((p) => {
      let overlay = polylinesMapRef.current.get(p.id);
      const coordinates = p.points.map((pt) => new mapkit.Coordinate(pt.lat, pt.lon));

      if (!overlay) {
        overlay = new mapkit.PolylineOverlay(coordinates, {
          style: new mapkit.Style({
            lineWidth: p.width ?? 3,
            strokeOpacity: p.opacity ?? 0.8,
            strokeColor: p.color ?? "#007aff",
            lineDash: p.dashed ? [8, 4] : undefined,
          }),
        });

        map.addOverlay(overlay);
        polylinesMapRef.current.set(p.id, overlay);
      } else {
        overlay.points = coordinates;
        overlay.style = new mapkit.Style({
          lineWidth: p.width ?? 3,
          strokeOpacity: p.opacity ?? 0.8,
          strokeColor: p.color ?? "#007aff",
          lineDash: p.dashed ? [8, 4] : undefined,
        });
      }
    });
  }, [polylines, status]);

  // Note: MapKit JS doesn't have built-in TileOverlay support like native MapKit
  // The tileOverlays prop is accepted but ignored - would need custom canvas implementation
  void tileOverlays; // Acknowledged but not implemented

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: variant === "mini" ? 200 : 400,
        background: "#1a1a1a",
      }}
    >
      <div
        ref={elRef}
        style={{
          position: "absolute",
          inset: 0,
        }}
      />
      {status !== "ready" && (
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            padding: "8px 10px",
            borderRadius: 10,
            fontSize: 12,
            background: "rgba(0,0,0,0.75)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.25)",
            maxWidth: 520,
            zIndex: 10,
          }}
        >
          Map status: {status}
        </div>
      )}
    </div>
  );
}
