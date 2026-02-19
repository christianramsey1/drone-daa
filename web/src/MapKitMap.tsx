import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "./platform";
import {
  createSeamarkIcon,
  createStartWaypointIcon,
  createEndWaypointIcon,
  createGpsPositionIcon,
  createAircraftElement,
  createDroneIcon,
  createOperatorIcon,
  getBreadcrumbDotUrl,
} from "./mapIcons";

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
  // Aircraft-specific fields
  heading?: number;
  iconSize?: number;
  dataTagLines?: string[];
  alertLevel?: "normal" | "caution" | "warning";
};

export type Polyline = {
  id: string;
  points: Array<{ lat: number; lon: number }>;
  width?: number;
  opacity?: number;
  color?: string;
  dashed?: boolean;
  fillColor?: string;
  fillOpacity?: number;
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
  onViewChange?: (zoom: number, bounds: { south: number; west: number; north: number; east: number }) => void;
};

const DEFAULT_CENTER = { lat: 37.093, lon: -79.671 };

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
  onViewChange,
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

          // Report view changes for FAA layer fetching
          mapRef.current.addEventListener("region-change-end", () => {
            if (onViewChange && mapRef.current) {
              const r = mapRef.current.region;
              const lat = r.center.latitude;
              const lon = r.center.longitude;
              const dLat = r.span.latitudeDelta / 2;
              const dLon = r.span.longitudeDelta / 2;
              // Approximate zoom from span
              const zoom = Math.round(Math.log2(360 / r.span.longitudeDelta));
              onViewChange(zoom, {
                south: lat - dLat,
                north: lat + dLat,
                west: lon - dLon,
                east: lon + dLon,
              });
            }
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

      // Aircraft/Drone: check if existing annotation needs full recreation
      if (annotation && (a.style === "aircraft" || a.style === "drone")) {
        const heading = a.heading ?? 0;
        const iconSz = a.iconSize ?? 32;
        const tagLines = a.dataTagLines ?? [];
        const level = a.alertLevel ?? "normal";
        const newKey = `${Math.round(heading / 5) * 5}_${iconSz}_${level}_${tagLines.join("|")}`;
        if (annotation.data?._key !== newKey) {
          map.removeAnnotation(annotation);
          annotationsMapRef.current.delete(a.id);
          annotation = undefined; // recreate immediately below
        }
      }

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
        } else if (a.style === "aircraft") {
          // Aircraft: DOM-based annotation with icon + data tag
          const heading = a.heading ?? 0;
          const iconSz = a.iconSize ?? 32;
          const tagLines = a.dataTagLines ?? [];
          const level = a.alertLevel ?? "normal";
          const _key = `${Math.round(heading / 5) * 5}_${iconSz}_${level}_${tagLines.join("|")}`;

          annotation = new mapkit.Annotation(coord, () => {
            return createAircraftElement(heading, level, iconSz, tagLines);
          }, {
            data: { id: a.id, style: a.style, kind: a.kind, heading, _key },
            anchorOffset: new DOMPoint(0, -iconSz / 2),
            calloutEnabled: false,
            animates: false,
          });
        } else if (a.style === "drone") {
          // Drone: DOM-based annotation with quadcopter icon + data tag
          const heading = a.heading ?? 0;
          const iconSz = a.iconSize ?? 28;
          const tagLines = a.dataTagLines ?? [];
          const level = a.alertLevel ?? "normal";
          const _key = `${Math.round(heading / 5) * 5}_${iconSz}_${level}_${tagLines.join("|")}`;

          annotation = new mapkit.Annotation(coord, () => {
            const wrapper = document.createElement("div");
            wrapper.style.cssText = `width:${iconSz}px;height:${iconSz}px;position:relative;overflow:visible;`;
            const canvas = createDroneIcon(heading, level, iconSz);
            canvas.style.cssText = `display:block;width:${iconSz}px;height:${iconSz}px;`;
            wrapper.appendChild(canvas);
            if (tagLines.length > 0) {
              const tag = document.createElement("div");
              tag.style.cssText =
                `position:absolute;left:${iconSz + 4}px;top:0;` +
                "font-family:system-ui,-apple-system,sans-serif;font-size:10px;line-height:1.3;" +
                "color:rgba(255,255,255,0.95);text-shadow:0 1px 2px rgba(0,0,0,0.9);" +
                "white-space:nowrap;pointer-events:none;" +
                "background:rgba(0,0,0,0.55);padding:1px 4px;border-radius:3px;";
              for (const line of tagLines) {
                const div = document.createElement("div");
                div.textContent = line;
                tag.appendChild(div);
              }
              wrapper.appendChild(tag);
            }
            return wrapper;
          }, {
            data: { id: a.id, style: a.style, kind: a.kind, heading, _key },
            anchorOffset: new DOMPoint(0, -iconSz / 2),
            calloutEnabled: false,
            animates: false,
          });
        } else if (a.style === "rid-operator") {
          // Operator/takeoff location marker
          const canvas = createOperatorIcon(16);
          const url = canvas.toDataURL();
          annotation = new mapkit.ImageAnnotation(coord, {
            data: { id: a.id, style: a.style },
            url: { 1: url },
            size: { width: 16, height: 16 },
            anchorOffset: new DOMPoint(0, 0),
            calloutEnabled: false,
          });
        } else if (a.style === "breadcrumb-dot") {
          // Small amber dot for breadcrumb trail
          annotation = new mapkit.ImageAnnotation(coord, {
            data: { id: a.id, style: a.style },
            url: { 1: getBreadcrumbDotUrl() },
            size: { width: 6, height: 6 },
            anchorOffset: new DOMPoint(0, -3),
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
        // Update existing annotation position
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

    // Add or update polylines (use PolygonOverlay when fill is needed)
    polylines.forEach((p) => {
      let overlay = polylinesMapRef.current.get(p.id);
      const coordinates = p.points.map((pt) => new mapkit.Coordinate(pt.lat, pt.lon));

      // Recreate if fill state changed (polyline ↔ polygon)
      if (overlay) {
        const needsFill = !!p.fillColor;
        const hadFill = !!(overlay as any)._daaFilled;
        if (needsFill !== hadFill) {
          map.removeOverlay(overlay);
          polylinesMapRef.current.delete(p.id);
          overlay = undefined;
        }
      }

      if (!overlay) {
        const style = new mapkit.Style({
          lineWidth: p.width ?? 3,
          strokeOpacity: p.opacity ?? 0.8,
          strokeColor: p.color ?? "#007aff",
          lineDash: p.dashed ? [8, 4] : undefined,
          ...(p.fillColor ? { fillColor: p.fillColor, fillOpacity: p.fillOpacity ?? 0.15 } : {}),
        });

        if (p.fillColor) {
          overlay = new mapkit.PolygonOverlay(coordinates, { style });
          (overlay as any)._daaFilled = true;
        } else {
          overlay = new mapkit.PolylineOverlay(coordinates, { style });
        }

        map.addOverlay(overlay);
        polylinesMapRef.current.set(p.id, overlay);
      } else {
        overlay.points = coordinates;
        overlay.style = new mapkit.Style({
          lineWidth: p.width ?? 3,
          strokeOpacity: p.opacity ?? 0.8,
          strokeColor: p.color ?? "#007aff",
          lineDash: p.dashed ? [8, 4] : undefined,
          ...(p.fillColor ? { fillColor: p.fillColor, fillOpacity: p.fillOpacity ?? 0.15 } : {}),
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
