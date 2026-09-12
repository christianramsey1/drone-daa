// web/src/LeafletMap.tsx — Leaflet-based map for the USGS topo layer (online + offline)
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Annotation, Polyline, TileOverlayConfig } from "./MapKitMap";
import {
  createSeamarkIcon,
  createStartWaypointIcon,
  createEndWaypointIcon,
  createGpsPositionIcon,
  createAircraftIcon,
  createDroneIcon,
  createOperatorIcon,
  getBreadcrumbDotUrl,
} from "./mapIcons";
import { CachedTileLayer } from "./services/CachedTileLayer";
import { TOPO_URL_TEMPLATE, TOPO_MAX_NATIVE_ZOOM, TOPO_ATTRIBUTION } from "./services/offlineTiles";

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
  onOverlaySelect?: (id: string) => void;
  onViewChange?: (zoom: number, bounds: { south: number; west: number; north: number; east: number }) => void;
};

const DEFAULT_CENTER = { lat: 37.093, lon: -79.671 };

/**
 * Tile layer whose URLs come from a function rather than a template — needed
 * for WMS sources like the NWS radar mosaic, where each tile is a bbox query.
 */
class FnTileLayer extends L.TileLayer {
  private urlFn: (x: number, y: number, z: number) => string;

  constructor(
    urlFn: (x: number, y: number, z: number) => string,
    options?: L.TileLayerOptions,
  ) {
    super("", options);
    this.urlFn = urlFn;
  }

  setUrlFn(urlFn: (x: number, y: number, z: number) => string) {
    this.urlFn = urlFn;
    this.redraw();
  }

  getTileUrl(coords: L.Coords): string {
    return this.urlFn(coords.x, coords.y, coords.z);
  }
}

export default function LeafletMap({
  variant = "full",
  center,
  className,
  annotations = [],
  polylines = [],
  tileOverlays = [],
  onSelect,
  onMapClick,
  onOverlaySelect,
  onViewChange,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline | L.Polygon>>(new Map());
  const centeredRef = useRef(false);
  const centerRef = useRef(center);

  const onOverlaySelectRef = useRef(onOverlaySelect);
  onOverlaySelectRef.current = onOverlaySelect;
  const onViewChangeRef = useRef(onViewChange);

  // Keep refs current
  useEffect(() => { centerRef.current = center; }, [center]);
  useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);

  // Initialize map
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;

    const c = center ?? DEFAULT_CENTER;
    const map = L.map(elRef.current, {
      center: [c.lat, c.lon],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });

    // Cached tile layer for the USGS topo base map (see TOPO_URL_TEMPLATE)
    const tileLayer = new CachedTileLayer(
      TOPO_URL_TEMPLATE,
      {
        // USGS serves up to zoom 16; overzoom by scaling for one more level
        maxNativeZoom: TOPO_MAX_NATIVE_ZOOM,
        maxZoom: 17,
        attribution: TOPO_ATTRIBUTION,
      },
    );
    tileLayer.addTo(map);

    // Add recenter button (top-right, below zoom)
    const LocateControl = L.Control.extend({
      options: { position: "topright" as const },
      onAdd: () => {
        const btn = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        btn.innerHTML = `<a href="#" title="Re-center on GPS" style="
          display:flex;align-items:center;justify-content:center;
          width:32px;height:32px;
          background:rgba(18,18,20,0.88);
          color:rgba(255,255,255,0.85);font-size:16px;
          text-decoration:none;cursor:pointer;
          border:1px solid rgba(255,255,255,0.18);
          border-radius:6px;
        ">&#8982;</a>`;
        L.DomEvent.disableClickPropagation(btn);
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          const pos = centerRef.current;
          if (pos && mapRef.current) {
            mapRef.current.setView([pos.lat, pos.lon], mapRef.current.getZoom(), { animate: true });
          }
        });
        return btn;
      },
    });
    new LocateControl().addTo(map);

    // Report view changes for tile downloads
    const fireViewChange = () => {
      if (onViewChangeRef.current) {
        const b = map.getBounds();
        onViewChangeRef.current(map.getZoom(), {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        });
      }
    };
    map.on("moveend", fireViewChange);
    map.on("zoomend", fireViewChange);
    requestAnimationFrame(fireViewChange);

    mapRef.current = map;
    centeredRef.current = !!center;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      polylinesRef.current.clear();
      centeredRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center
  useEffect(() => {
    if (!mapRef.current || !center) return;
    if (!centeredRef.current) {
      mapRef.current.setView([center.lat, center.lon], mapRef.current.getZoom());
      centeredRef.current = true;
    }
  }, [center?.lat, center?.lon]);

  // Map click handler
  useEffect(() => {
    if (!mapRef.current || !onMapClick) return;
    const map = mapRef.current;
    const handler = (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [onMapClick]);

  // Update annotations
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const currentIds = new Set(annotations.map((a) => a.id));

    // Remove stale markers
    const toRemove: string[] = [];
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => markersRef.current.delete(id));

    // Add or update markers
    annotations.forEach((a) => {
      let marker = markersRef.current.get(a.id);

      // Aircraft/Drone: check if needs recreation (heading/size/alert/selected changed)
      if (marker && (a.style === "aircraft" || a.style === "drone")) {
        const heading = a.heading ?? 0;
        const iconSz = a.iconSize ?? 32;
        const tagLines = a.dataTagLines ?? [];
        const level = a.alertLevel ?? "normal";
        const sel = a.selected ? "1" : "0";
        const newKey = `${Math.round(heading / 5) * 5}_${iconSz}_${level}_${sel}_${tagLines.join("|")}`;
        const prevKey = (marker as any)._daaKey;
        if (prevKey !== newKey) {
          map.removeLayer(marker);
          markersRef.current.delete(a.id);
          marker = undefined;
        }
      }

      if (!marker) {
        let icon: L.DivIcon | L.Icon | undefined;

        if (a.style === "aircraft") {
          const heading = a.heading ?? 0;
          const iconSz = a.iconSize ?? 32;
          const tagLines = a.dataTagLines ?? [];
          const level = a.alertLevel ?? "normal";
          const sel = a.selected;
          const canvas = createAircraftIcon(heading, level, iconSz);
          const imgUrl = canvas.toDataURL();
          const glowStyle = sel ? "filter:drop-shadow(0 0 8px #00aaff) drop-shadow(0 0 16px #00aaff) drop-shadow(0 0 24px #00aaff);" : "";
          let tagHtml = "";
          if (tagLines.length > 0) {
            const tagContent = tagLines.map((l) => `<div>${l}</div>`).join("");
            const tagBg = sel
              ? "background:rgba(0,100,255,0.4);padding:2px 5px;border-radius:3px;border:1.5px solid #00aaff;"
              : "";
            tagHtml = `<div style="position:absolute;left:${iconSz + 4}px;top:0;` +
              "font-family:system-ui,-apple-system,sans-serif;font-size:10px;line-height:1.3;" +
              "color:rgba(255,255,255,0.92);text-shadow:0 1px 3px rgba(0,0,0,0.8),0 0 6px rgba(0,0,0,0.6);" +
              `white-space:nowrap;pointer-events:none;${tagBg}">${tagContent}</div>`;
          }
          icon = L.divIcon({
            html: `<div style="width:${iconSz}px;height:${iconSz}px;position:relative;overflow:visible;${glowStyle}">` +
              `<img src="${imgUrl}" width="${iconSz}" height="${iconSz}" style="display:block;" />` +
              tagHtml + `</div>`,
            className: "",
            iconSize: [iconSz, iconSz],
            iconAnchor: [iconSz / 2, iconSz / 2],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: !!onSelect }).addTo(map);
          const key = `${Math.round(heading / 5) * 5}_${iconSz}_${level}_${sel ? "1" : "0"}_${tagLines.join("|")}`;
          (marker as any)._daaKey = key;
        } else if (a.style === "gps-position") {
          const canvas = createGpsPositionIcon(a.color ?? "#007aff");
          const url = canvas.toDataURL();
          icon = L.divIcon({
            html: `<img src="${url}" width="20" height="20" style="display:block;" />`,
            className: "",
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: false }).addTo(map);
        } else if (a.style === "breadcrumb-dot") {
          const dotUrl = getBreadcrumbDotUrl();
          icon = L.divIcon({
            html: `<img src="${dotUrl}" width="6" height="6" style="display:block;" />`,
            className: "",
            iconSize: [6, 6],
            iconAnchor: [3, 3],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: false }).addTo(map);
        } else if (a.style === "drone") {
          const heading = a.heading ?? 0;
          const iconSz = a.iconSize ?? 28;
          const tagLines = a.dataTagLines ?? [];
          const level = a.alertLevel ?? "normal";
          const sel = a.selected;
          const canvas = createDroneIcon(heading, level, iconSz);
          const imgUrl = canvas.toDataURL();
          const glowStyle = sel ? "filter:drop-shadow(0 0 8px #00aaff) drop-shadow(0 0 16px #00aaff) drop-shadow(0 0 24px #00aaff);" : "";
          let tagHtml = "";
          if (tagLines.length > 0) {
            const tagContent = tagLines.map((l) => `<div>${l}</div>`).join("");
            const tagBg = sel
              ? "background:rgba(0,100,255,0.4);padding:1px 4px;border-radius:3px;border:1.5px solid #00aaff;"
              : "";
            tagHtml = `<div style="position:absolute;left:${iconSz + 4}px;top:0;` +
              "font-family:system-ui,-apple-system,sans-serif;font-size:10px;line-height:1.3;" +
              "color:rgba(255,255,255,0.92);text-shadow:0 1px 3px rgba(0,0,0,0.8),0 0 6px rgba(0,0,0,0.6);" +
              `white-space:nowrap;pointer-events:none;${tagBg}">${tagContent}</div>`;
          }
          icon = L.divIcon({
            html: `<div style="width:${iconSz}px;height:${iconSz}px;position:relative;overflow:visible;${glowStyle}">` +
              `<img src="${imgUrl}" width="${iconSz}" height="${iconSz}" style="display:block;" />` +
              tagHtml + `</div>`,
            className: "",
            iconSize: [iconSz, iconSz],
            iconAnchor: [iconSz / 2, iconSz / 2],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: !!onSelect }).addTo(map);
          const key = `${Math.round(heading / 5) * 5}_${iconSz}_${level}_${sel ? "1" : "0"}_${tagLines.join("|")}`;
          (marker as any)._daaKey = key;
        } else if (a.style === "rid-operator") {
          const canvas = createOperatorIcon(16);
          const url = canvas.toDataURL();
          icon = L.divIcon({
            html: `<img src="${url}" width="16" height="16" style="display:block;" />`,
            className: "",
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: false }).addTo(map);
        } else if (a.style === "obstruction") {
          const clr = a.color ?? "#fb923c";
          icon = L.divIcon({
            html: `<svg width="8" height="8" viewBox="0 0 8 8"><polygon points="4,0 8,8 0,8" fill="${clr}"/></svg>`,
            className: "",
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: !!onSelect }).addTo(map);
        } else if (a.style === "seamark") {
          const canvas = createSeamarkIcon(a.color ?? "#ff3b30");
          const url = canvas.toDataURL();
          icon = L.divIcon({
            html: `<img src="${url}" width="12" height="12" style="display:block;" />`,
            className: "",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: !!onSelect }).addTo(map);
        } else if (a.style === "waypoint-start" || a.style === "waypoint-end") {
          const canvas = a.style === "waypoint-start"
            ? createStartWaypointIcon(a.color ?? "#16a34a")
            : createEndWaypointIcon(a.color ?? "#dc2626");
          const url = canvas.toDataURL();
          icon = L.divIcon({
            html: `<img src="${url}" width="24" height="24" style="display:block;" />`,
            className: "",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: false }).addTo(map);
        } else {
          // Default marker
          icon = L.divIcon({
            html: `<div style="font-size:16px;text-align:center;">${a.emoji ?? "📍"}</div>`,
            className: "",
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          marker = L.marker([a.lat, a.lon], { icon, interactive: !!onSelect }).addTo(map);
        }

        if (onSelect) {
          marker.on("click", () => onSelect(a.id));
        }

        markersRef.current.set(a.id, marker);
      } else {
        // Update position of existing marker
        marker.setLatLng([a.lat, a.lon]);
      }
    });
  }, [annotations, onSelect]);

  // Update polylines
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const currentIds = new Set(polylines.map((p) => p.id));

    // Remove stale
    const toRemove: string[] = [];
    polylinesRef.current.forEach((line, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(line);
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => polylinesRef.current.delete(id));

    // Add or update (use L.polygon when fill is needed)
    polylines.forEach((p) => {
      const latlngs = p.points.map((pt) => [pt.lat, pt.lon] as L.LatLngTuple);
      let line = polylinesRef.current.get(p.id);

      // Recreate if fill state changed (polyline ↔ polygon)
      if (line) {
        const needsFill = !!p.fillColor;
        const hadFill = !!(line as any)._daaFilled;
        if (needsFill !== hadFill) {
          map.removeLayer(line);
          polylinesRef.current.delete(p.id);
          line = undefined;
        }
      }

      if (!line) {
        if (p.fillColor) {
          line = L.polygon(latlngs, {
            color: p.color ?? "#007aff",
            weight: p.width ?? 3,
            opacity: p.opacity ?? 0.8,
            dashArray: p.dashed ? "8 4" : undefined,
            fillColor: p.fillColor,
            fillOpacity: p.fillOpacity ?? 0.15,
          }).addTo(map);
          (line as any)._daaFilled = true;
        } else {
          line = L.polyline(latlngs, {
            color: p.color ?? "#007aff",
            weight: p.width ?? 3,
            opacity: p.opacity ?? 0.8,
            dashArray: p.dashed ? "8 4" : undefined,
          }).addTo(map);
        }
        line.on("click", () => onOverlaySelectRef.current?.(p.id));
        polylinesRef.current.set(p.id, line);
      } else {
        line.setLatLngs(latlngs);
        line.setStyle({
          color: p.color ?? "#007aff",
          weight: p.width ?? 3,
          opacity: p.opacity ?? 0.8,
          dashArray: p.dashed ? "8 4" : undefined,
          ...(p.fillColor ? { fillColor: p.fillColor, fillOpacity: p.fillOpacity ?? 0.15 } : {}),
        });
      }
    });
  }, [polylines]);

  // Update tile overlays
  const tileOverlayMapRef = useRef<Map<string, L.TileLayer>>(new Map());
  const tileOverlayVersionRef = useRef<Map<string, number | string | undefined>>(new Map());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(tileOverlays.map((t) => t.id));

    // Remove stale
    tileOverlayMapRef.current.forEach((layer, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(layer);
        tileOverlayMapRef.current.delete(id);
      }
    });

    // Add new, or re-point an existing layer (radar changes its URL on each
    // refresh, so the same id must be able to change source without a flash).
    tileOverlays.forEach((t) => {
      const existing = tileOverlayMapRef.current.get(t.id);
      if (existing) {
        if (t.tileUrlFn && existing instanceof FnTileLayer) {
          if (tileOverlayVersionRef.current.get(t.id) !== t.version) {
            tileOverlayVersionRef.current.set(t.id, t.version);
            existing.setUrlFn(t.tileUrlFn);
          }
        } else if (
          t.urlTemplate &&
          (existing as L.TileLayer & { _url?: string })._url !== t.urlTemplate
        ) {
          existing.setUrl(t.urlTemplate);
        }
        existing.setOpacity(t.opacity ?? 0.7);
        return;
      }

      const options: L.TileLayerOptions = {
        opacity: t.opacity ?? 0.7,
        minZoom: t.minZoom ?? 5,
        maxZoom: t.maxZoom ?? 12,
        // Upscale past the source's real limit instead of asking for tiles
        // it won't render (the NWS radar mosaic is empty above z8).
        ...(t.maxNativeZoom != null ? { maxNativeZoom: t.maxNativeZoom } : null),
      };
      const layer = t.tileUrlFn
        ? new FnTileLayer(t.tileUrlFn, options).addTo(map)
        : L.tileLayer(t.urlTemplate ?? "", options).addTo(map);
      tileOverlayVersionRef.current.set(t.id, t.version);
      tileOverlayMapRef.current.set(t.id, layer);
    });
  }, [tileOverlays]);

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
        style={{ position: "absolute", inset: 0 }}
      />
    </div>
  );
}
