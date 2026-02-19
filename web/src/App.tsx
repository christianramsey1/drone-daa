// web/src/App.tsx — DroneDAA
import "./App.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import MapKitMap, { type Annotation, type Polyline } from "./MapKitMap";
import { getApiBaseUrl } from "./platform";
import { useAdsb, type AdsbConnectionStatus } from "./services/useAdsb";
import type { AircraftTrack } from "./services/adsb";
import { distanceNm, destinationPoint } from "./nav";
import { useFaaLayers } from "./services/useFaaLayers";
import { FAA_LAYERS, airspaceColor } from "./services/airspace";
import type { AirspaceBbox } from "./services/airspace";
import { useRemoteId, type RidConnectionStatus } from "./services/useRemoteId";
import type { DroneTrack } from "./services/remoteId";
import { broadcastTypeLabel } from "./services/remoteId";

const LeafletMap = lazy(() => import("./LeafletMap"));

// ── Types ──────────────────────────────────────────────────────────────

type PanelTab = "maps" | "alerts" | "adsb" | "remoteid" | "details" | "weather" | "settings" | "howto";

type MapLayer = "apple" | "topo";

const MAP_LAYER_KEY = "dronedaa.mapLayer";

function loadMapLayer(): MapLayer {
  try {
    const stored = localStorage.getItem(MAP_LAYER_KEY);
    if (stored === "apple" || stored === "topo") return stored;
  } catch { /* ignore */ }
  return "apple";
}

type AircraftDisplaySettings = {
  iconSize: "small" | "medium" | "large";
  dataTagLines: [boolean, boolean, boolean];
  trailingBreadcrumbs: number;
  velocityVector: number;
};

const ICON_SIZE_PX: Record<AircraftDisplaySettings["iconSize"], number> = {
  small: 24,
  medium: 32,
  large: 48,
};

const DEFAULT_AIRCRAFT_DISPLAY: AircraftDisplaySettings = {
  iconSize: "medium",
  dataTagLines: [true, true, false],
  trailingBreadcrumbs: 0,
  velocityVector: 0,
};

const AIRCRAFT_DISPLAY_KEY = "dronedaa.aircraftDisplay";

function loadAircraftDisplay(): AircraftDisplaySettings {
  try {
    const stored = localStorage.getItem(AIRCRAFT_DISPLAY_KEY);
    if (stored) return { ...DEFAULT_AIRCRAFT_DISPLAY, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return DEFAULT_AIRCRAFT_DISPLAY;
}

type AlertVolumeSettings = {
  outerEnabled: boolean;
  outerRangeNm: number;
  outerCeilingFt: number;
  innerEnabled: boolean;
  innerRangeNm: number;
  innerCeilingFt: number;
  soundEnabled: boolean;
  hapticEnabled: boolean;
};

const DEFAULT_ALERT_VOLUMES: AlertVolumeSettings = {
  outerEnabled: true,
  outerRangeNm: 5,
  outerCeilingFt: 3000,
  innerEnabled: true,
  innerRangeNm: 2,
  innerCeilingFt: 1500,
  soundEnabled: true,
  hapticEnabled: true,
};

const ALERT_VOLUMES_KEY = "dronedaa.alertVolumes";

function loadAlertVolumes(): AlertVolumeSettings {
  try {
    const stored = localStorage.getItem(ALERT_VOLUMES_KEY);
    if (stored) return { ...DEFAULT_ALERT_VOLUMES, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return DEFAULT_ALERT_VOLUMES;
}

// ── Center source for range rings / distance calculations ─────────────

type CenterSourceKind =
  | "deviceGps"         // This device's GPS
  | "gdl90Gps"          // GDL-90 receiver's ownship GPS
  | "ridDrone"           // A specific RID drone's position
  | "tapMap";            // User tapped map location

type CenterSourceConfig = {
  kind: CenterSourceKind;
  ridDroneId?: string;   // Only when kind === "ridDrone"
};

type CenterSourceSettings = {
  primary: CenterSourceConfig;
  secondary: CenterSourceConfig;
  // Tertiary is always "tapMap" (not user-selectable)
};

const DEFAULT_CENTER_SOURCE: CenterSourceSettings = {
  primary: { kind: "deviceGps" },
  secondary: { kind: "tapMap" },
};

const CENTER_SOURCE_KEY = "dronedaa.centerSource";

function loadCenterSource(): CenterSourceSettings {
  try {
    const stored = localStorage.getItem(CENTER_SOURCE_KEY);
    if (stored) return { ...DEFAULT_CENTER_SOURCE, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return DEFAULT_CENTER_SOURCE;
}

const CENTER_SOURCE_LABELS: Record<CenterSourceKind, string> = {
  deviceGps: "This Device GPS",
  gdl90Gps: "GDL-90 Receiver GPS",
  ridDrone: "My Drone (RID)",
  tapMap: "Tap Map to Set",
};

type AlertLevel = "normal" | "caution" | "warning";

function computeAlertLevel(
  distNm: number | undefined,
  altFt: number,
  settings: AlertVolumeSettings,
): AlertLevel {
  if (distNm == null) return "normal";
  if (settings.innerEnabled && distNm <= settings.innerRangeNm && altFt <= settings.innerCeilingFt) {
    return "warning";
  }
  if (settings.outerEnabled && distNm <= settings.outerRangeNm && altFt <= settings.outerCeilingFt) {
    return "caution";
  }
  return "normal";
}

// Audio context for alert tones (created lazily)
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function playAlertTone(level: AlertLevel) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    const beeps = level === "warning" ? 3 : 2;
    const freq = level === "warning" ? 1200 : 880;
    const gap = level === "warning" ? 0.18 : 0.25;
    const dur = level === "warning" ? 0.12 : 0.15;
    const vol = level === "warning" ? 0.5 : 0.4;

    for (let i = 0; i < beeps; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * gap;
      osc.start(t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
      osc.stop(t + dur);
    }
  } catch { /* audio not available */ }
}

function hapticPulse(level: AlertLevel) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(level === "warning" ? [300, 100, 300, 100, 300] : [200, 100, 200]);
    }
  } catch { /* vibration not available */ }
}

function circlePolyPoints(
  center: { lat: number; lon: number },
  radiusNm: number,
  n = 72,
): Array<{ lat: number; lon: number }> {
  const speedKts = radiusNm * 3600;
  const pts: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i <= n; i++) {
    const bearing = (i / n) * 360;
    pts.push(destinationPoint(center, bearing, speedKts, 1));
  }
  return pts;
}

type CurrentWeather = {
  temperature_2m?: number;
  temperatureApparent?: number;
  humidity?: number;
  wind_speed_10m?: number;
  wind_gusts_10m?: number;
  wind_direction_10m?: number;
  visibility?: number;
  cloud_cover?: number;
  uvIndex?: number;
  conditionCode?: string;
  daylight?: boolean;
};

type HourlyForecast = {
  time: string;
  temperature?: number;
  precipitationChance?: number;
  conditionCode?: string;
};

type NextHourData = {
  summary?: Array<{ condition: string; startTime: string; endTime?: string }>;
  minutes?: Array<{
    time: string;
    precipitationChance?: number;
    precipitationIntensity?: number;
  }>;
};

type WeatherResponse = {
  current?: CurrentWeather;
  hourly?: HourlyForecast[];
  nextHour?: NextHourData | null;
};

type GpsPos = {
  lat: number;
  lon: number;
  accuracyM?: number;
};

// ── Helpers ────────────────────────────────────────────────────────────

function conditionLabel(code: string | undefined): string {
  if (!code) return "";
  const map: Record<string, string> = {
    Clear: "Clear",
    MostlyClear: "Mostly Clear",
    PartlyCloudy: "Partly Cloudy",
    MostlyCloudy: "Mostly Cloudy",
    Cloudy: "Cloudy",
    Overcast: "Overcast",
    Haze: "Haze",
    Fog: "Fog",
    Rain: "Rain",
    HeavyRain: "Heavy Rain",
    Drizzle: "Drizzle",
    Snow: "Snow",
    HeavySnow: "Heavy Snow",
    Sleet: "Sleet",
    FreezingRain: "Freezing Rain",
    Thunderstorms: "Thunderstorms",
    StrongStorms: "Strong Storms",
    Windy: "Windy",
    Breezy: "Breezy",
    Flurries: "Flurries",
    BlowingSnow: "Blowing Snow",
    ScatteredThunderstorms: "Scattered Storms",
    IsolatedThunderstorms: "Isolated Storms",
    SunShowers: "Sun Showers",
    BlowingDust: "Blowing Dust",
    Smoky: "Smoky",
    TropicalStorm: "Tropical Storm",
    Hurricane: "Hurricane",
  };
  return map[code] ?? code.replace(/([A-Z])/g, " $1").trim();
}

function conditionEmoji(code: string | undefined, daylight?: boolean): string {
  if (!code) return "";
  const day = daylight !== false;
  const map: Record<string, string> = {
    Clear: day ? "\u2600\uFE0F" : "\uD83C\uDF19",
    MostlyClear: day ? "\uD83C\uDF24" : "\uD83C\uDF19",
    PartlyCloudy: day ? "\u26C5" : "\uD83C\uDF19",
    MostlyCloudy: "\uD83C\uDF25",
    Cloudy: "\u2601\uFE0F",
    Overcast: "\u2601\uFE0F",
    Haze: "\uD83C\uDF2B\uFE0F",
    Fog: "\uD83C\uDF2B\uFE0F",
    Rain: "\uD83C\uDF27",
    HeavyRain: "\uD83C\uDF27",
    Drizzle: "\uD83C\uDF26",
    Snow: "\uD83C\uDF28",
    HeavySnow: "\uD83C\uDF28",
    Sleet: "\uD83C\uDF28",
    FreezingRain: "\uD83E\uDDCA",
    Thunderstorms: "\u26C8",
    StrongStorms: "\u26C8",
    ScatteredThunderstorms: "\u26C8",
    IsolatedThunderstorms: "\u26C8",
    Windy: "\uD83C\uDF2C\uFE0F",
    Breezy: "\uD83C\uDF2C\uFE0F",
    Flurries: "\u2744\uFE0F",
    BlowingSnow: "\uD83C\uDF28",
    SunShowers: "\uD83C\uDF26",
    TropicalStorm: "\uD83C\uDF00",
    Hurricane: "\uD83C\uDF00",
  };
  return map[code] ?? "\uD83C\uDF24";
}

function formatVisibility(v: number | undefined): string {
  if (v == null) return "—";
  return `${(v / 1609.34).toFixed(1)} mi`;
}

function formatHour(iso: string): string {
  try {
    const d = new Date(iso);
    const h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12} ${ampm}`;
  } catch {
    return "";
  }
}

function nextHourSummaryText(nextHour: NextHourData | null | undefined): string {
  if (!nextHour) return "No data";
  const summaries = nextHour.summary;
  if (summaries && summaries.length > 0) {
    const first = summaries[0];
    if (first.condition === "clear" || first.condition === "precipitation") {
      // Check if any minutes have precipitation
      const hasAny = nextHour.minutes?.some((m) => (m.precipitationIntensity ?? 0) > 0);
      if (!hasAny) return "No precipitation expected";
      return "Precipitation expected";
    }
    return first.condition.charAt(0).toUpperCase() + first.condition.slice(1);
  }
  const hasAny = nextHour.minutes?.some((m) => (m.precipitationIntensity ?? 0) > 0);
  return hasAny ? "Precipitation expected" : "No precipitation expected";
}

// ── Sub-components ─────────────────────────────────────────────────────

function AdsbStatusBadge({ status, gpsValid }: {
  status: AdsbConnectionStatus;
  gpsValid: boolean;
}) {
  const colors: Record<AdsbConnectionStatus, string> = {
    disconnected: "#ff453a",
    connecting: "#ffd60a",
    connected: "#ffd60a",
    receiving: "#30d158",
  };
  const labels: Record<AdsbConnectionStatus, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting to relay...",
    connected: "Relay connected (no receiver data)",
    receiving: "ADS-B Receiver Connected",
  };

  return (
    <div className="kv" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colors[status],
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 12 }}>{labels[status]}</span>
      {status === "receiving" && (
        <span className="smallMuted" style={{ marginLeft: "auto" }}>
          GPS: {gpsValid ? "Fix" : "No fix"}
        </span>
      )}
    </div>
  );
}

function AircraftCard({ aircraft, distNm, alertLevel }: {
  aircraft: AircraftTrack;
  distNm?: number;
  alertLevel?: AlertLevel;
}) {
  const vertChar = aircraft.vertRateFpm
    ? aircraft.vertRateFpm > 100 ? "\u2191"
    : aircraft.vertRateFpm < -100 ? "\u2193"
    : ""
    : "";

  const alertColor = alertLevel === "warning" ? "#ff453a"
    : alertLevel === "caution" ? "#ffd60a"
    : undefined;

  const alertBg = alertLevel === "warning" ? "rgba(255, 69, 58, 0.18)"
    : alertLevel === "caution" ? "rgba(255, 214, 10, 0.14)"
    : undefined;

  return (
    <div className="listItem" style={{
      display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
      borderColor: alertColor,
      background: alertBg,
    }}>
      {alertColor && <div style={{
        width: 6, height: 6, borderRadius: 3, background: alertColor, flexShrink: 0,
      }} />}
      <span style={{ fontWeight: 600, fontSize: 12, minWidth: 64, flexShrink: 0 }}>
        {aircraft.callsign || aircraft.id}
      </span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {Math.round(aircraft.altFt).toLocaleString()} ft{vertChar} · {Math.round(aircraft.speedKts)} kts
      </span>
      {distNm != null && (
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>
          {distNm.toFixed(1)} nm
        </span>
      )}
    </div>
  );
}

function RidStatusBadge({ status }: { status: RidConnectionStatus }) {
  const colors: Record<RidConnectionStatus, string> = {
    unavailable: "#ff453a",
    idle: "#ff453a",
    scanning: "#ffd60a",
    receiving: "#30d158",
  };
  const labels: Record<RidConnectionStatus, string> = {
    unavailable: "Not Available",
    idle: "Idle",
    scanning: "Scanning...",
    receiving: "Receiving",
  };

  return (
    <div className="kv" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colors[status],
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 12 }}>{labels[status]}</span>
    </div>
  );
}

function DroneCard({ drone, distNm }: {
  drone: DroneTrack & { _distNm?: number };
  distNm?: number;
}) {
  const vertChar = drone.vertRateFpm
    ? drone.vertRateFpm > 100 ? "\u2191"
    : drone.vertRateFpm < -100 ? "\u2193"
    : ""
    : "";

  const idLabel = drone.serialNumber ?? drone.sessionId ?? drone.id;
  const locLabel = drone.operatorLat != null ? "Operator" : drone.takeoffLat != null ? "Takeoff" : null;

  return (
    <div className="listItem" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 12, minWidth: 64, flexShrink: 0 }}>
          {idLabel.length > 12 ? idLabel.slice(0, 12) + "\u2026" : idLabel}
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {Math.round(drone.altFt)} ft{vertChar} · {Math.round(drone.speedKts)} kts
        </span>
        {distNm != null && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>
            {distNm.toFixed(1)} nm
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.45)", flexWrap: "wrap" }}>
        <span style={{
          padding: "1px 5px", borderRadius: 4,
          background: "rgba(255,255,255,0.08)",
        }}>
          {drone.ridType === "standard" ? "Std RID" : "Module"}
        </span>
        <span style={{
          padding: "1px 5px", borderRadius: 4,
          background: "rgba(255,255,255,0.08)",
        }}>
          {broadcastTypeLabel(drone.broadcastType)}
        </span>
        {locLabel && (
          <span style={{
            padding: "1px 5px", borderRadius: 4,
            background: "rgba(255,165,0,0.15)", color: "#ffa500",
          }}>
            {locLabel} loc
          </span>
        )}
        <span>{drone.operationalStatus}</span>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function App() {
  // Panel state
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("maps");

  // Map state — starts null, set once from first GPS fix
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  const gpsCenteredRef = useRef(false);

  // GPS
  const [gps, setGps] = useState<GpsPos | null>(null);

  // Weather
  const [weatherData, setWeatherData] = useState<WeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const weather = weatherData?.current ?? null;
  const hourly = weatherData?.hourly ?? [];
  const nextHour = weatherData?.nextHour ?? null;

  // ADS-B
  const adsb = useAdsb();

  // Map bbox for FAA layer fetching (common across both map engines)
  const [mapBbox, setMapBbox] = useState<AirspaceBbox | null>(null);

  // FAA layers
  const faa = useFaaLayers(mapBbox);
  const [vfrSectionalEnabled, setVfrSectionalEnabled] = useState(false);

  // Selected items (for Details tab)
  const [selectedFaaZone, setSelectedFaaZone] = useState<import("./services/airspace").AirspaceZone | null>(null);
  const [selectedObstruction, setSelectedObstruction] = useState<import("./services/airspace").ObstructionPoint | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<string | null>(null); // aircraft id
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null); // drone id

  // Remote ID
  const rid = useRemoteId();

  // Center source for range rings / distance calculations
  const [centerSource, setCenterSource] = useState<CenterSourceSettings>(loadCenterSource);
  const [tapMapPos, setTapMapPos] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(CENTER_SOURCE_KEY, JSON.stringify(centerSource));
  }, [centerSource]);

  // Map layer
  const [mapLayer, setMapLayer] = useState<MapLayer>(loadMapLayer);

  useEffect(() => {
    localStorage.setItem(MAP_LAYER_KEY, mapLayer);
  }, [mapLayer]);

  // Tile download state
  const [downloadProgress, setDownloadProgress] = useState<{
    downloading: boolean;
    downloaded: number;
    total: number;
    failed: number;
  } | null>(null);
  const [cacheStats, setCacheStats] = useState<{ tileCount: number; totalBytes: number } | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);

  // Leaflet view state for tile downloads
  const [leafletView, setLeafletView] = useState<{
    zoom: number;
    bounds: { south: number; west: number; north: number; east: number };
  } | null>(null);

  // Load cache stats on mount
  useEffect(() => {
    import("./services/offlineTiles").then(({ getCacheStats }) =>
      getCacheStats().then(setCacheStats).catch(() => {})
    );
  }, []);

  // Aircraft display settings
  const [aircraftDisplay, setAircraftDisplay] = useState<AircraftDisplaySettings>(loadAircraftDisplay);

  useEffect(() => {
    localStorage.setItem(AIRCRAFT_DISPLAY_KEY, JSON.stringify(aircraftDisplay));
  }, [aircraftDisplay]);

  // Alert volume settings
  const [alertVolumes, setAlertVolumes] = useState<AlertVolumeSettings>(loadAlertVolumes);

  useEffect(() => {
    localStorage.setItem(ALERT_VOLUMES_KEY, JSON.stringify(alertVolumes));
  }, [alertVolumes]);

  // Position history for breadcrumbs
  const posHistoryRef = useRef<Map<string, Array<{ lat: number; lon: number }>>>(new Map());

  // Alert state tracking for transition detection
  const prevAlertRef = useRef<Map<string, AlertLevel>>(new Map());

  // ── GPS tracking ──────────────────────────────────────────────────

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        };
        setGps(loc);
        // Center map on first GPS fix only
        if (!gpsCenteredRef.current) {
          gpsCenteredRef.current = true;
          setMapCenter({ lat: loc.lat, lon: loc.lon });
        }
      },
      () => { /* GPS not available */ },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ── Audio unlock (browser autoplay policy requires user gesture) ──
  useEffect(() => {
    const unlock = () => {
      try {
        const ctx = getAudioCtx();
        if (ctx.state === "suspended") ctx.resume();
      } catch { /* ignore */ }
    };
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  // ── Weather fetch ─────────────────────────────────────────────────

  useEffect(() => {
    const center = gps ?? mapCenter;
    if (!center) return;

    let cancelled = false;
    setWeatherLoading(true);

    const url = `${getApiBaseUrl()}/api/weather?lat=${center.lat}&lon=${center.lon}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.current) setWeatherData(data);
      })
      .catch(() => { /* weather unavailable */ })
      .finally(() => { if (!cancelled) setWeatherLoading(false); });

    return () => { cancelled = true; };
  }, [gps?.lat?.toFixed(2), gps?.lon?.toFixed(2), mapCenter?.lat, mapCenter?.lon]);

  // ── Resolved center (3-tier fallback) ─────────────────────────────

  const isValidCoord = (lat: number, lon: number): boolean =>
    lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  const resolveSource = (src: CenterSourceConfig): { lat: number; lon: number } | null => {
    switch (src.kind) {
      case "deviceGps":
        return gps && isValidCoord(gps.lat, gps.lon) ? { lat: gps.lat, lon: gps.lon } : null;
      case "gdl90Gps":
        return adsb.ownship && isValidCoord(adsb.ownship.lat, adsb.ownship.lon)
          ? { lat: adsb.ownship.lat, lon: adsb.ownship.lon } : null;
      case "ridDrone": {
        if (!src.ridDroneId) return null;
        const drone = rid.drones.find((d) => d.id === src.ridDroneId);
        return drone && isValidCoord(drone.lat, drone.lon)
          ? { lat: drone.lat, lon: drone.lon } : null;
      }
      case "tapMap":
        if (tapMapPos && isValidCoord(tapMapPos.lat, tapMapPos.lon)) return tapMapPos;
        return gps && isValidCoord(gps.lat, gps.lon) ? { lat: gps.lat, lon: gps.lon } : null;
      default:
        return null;
    }
  };

  // Resolve with fallback: primary → secondary → tertiary (tapMap)
  const resolvedCenter: { lat: number; lon: number } | null = useMemo(() => {
    return resolveSource(centerSource.primary)
      ?? resolveSource(centerSource.secondary)
      ?? resolveSource({ kind: "tapMap" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    centerSource.primary.kind, centerSource.primary.ridDroneId,
    centerSource.secondary.kind, centerSource.secondary.ridDroneId,
    gps?.lat, gps?.lon,
    adsb.ownship?.lat, adsb.ownship?.lon,
    rid.drones,
    tapMapPos?.lat, tapMapPos?.lon,
  ]);

  // Track which tier is active (for display)
  const activeCenterTier: "primary" | "secondary" | "tertiary" = useMemo(() => {
    if (resolveSource(centerSource.primary)) return "primary";
    if (resolveSource(centerSource.secondary)) return "secondary";
    return "tertiary";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedCenter]);

  // ── Sorted aircraft by distance ──────────────────────────────────

  type AircraftWithDist = AircraftTrack & { _distNm?: number; _alertLevel: AlertLevel };

  const sortedAircraft: AircraftWithDist[] = useMemo(() => {
    const center = resolvedCenter;
    const list: AircraftWithDist[] = adsb.aircraft.map((ac) => {
      const d = center ? distanceNm(center, ac) : undefined;
      return {
        ...ac,
        _distNm: d,
        _alertLevel: computeAlertLevel(d, ac.altFt, alertVolumes),
      };
    });
    if (center) list.sort((a, b) => (a._distNm ?? 99999) - (b._distNm ?? 99999));
    return list;
  }, [adsb.aircraft, resolvedCenter, alertVolumes]);

  // ── Position history for breadcrumbs ───────────────────────────────

  useEffect(() => {
    const history = posHistoryRef.current;
    const maxPts = aircraftDisplay.trailingBreadcrumbs;
    const currentIds = new Set(adsb.aircraft.map((ac) => ac.id));

    for (const id of history.keys()) {
      if (!currentIds.has(id)) history.delete(id);
    }
    for (const ac of adsb.aircraft) {
      let trail = history.get(ac.id);
      if (!trail) { trail = []; history.set(ac.id, trail); }
      const last = trail[trail.length - 1];
      if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
        trail.push({ lat: ac.lat, lon: ac.lon });
      }
      if (trail.length > maxPts) trail.splice(0, trail.length - maxPts);
    }
  }, [adsb.aircraft, aircraftDisplay.trailingBreadcrumbs]);

  // ── Alert transition detection ──────────────────────────────────

  useEffect(() => {
    const prev = prevAlertRef.current;
    const levels: Record<AlertLevel, number> = { normal: 0, caution: 1, warning: 2 };

    for (const ac of sortedAircraft) {
      const curLevel = ac._alertLevel;
      const prevLevel = prev.get(ac.id) ?? "normal";

      if (levels[curLevel] > levels[prevLevel]) {
        if (alertVolumes.soundEnabled) playAlertTone(curLevel);
        if (alertVolumes.hapticEnabled) hapticPulse(curLevel);
      }
      prev.set(ac.id, curLevel);
    }

    const currentIds = new Set(sortedAircraft.map((a) => a.id));
    for (const id of prev.keys()) {
      if (!currentIds.has(id)) prev.delete(id);
    }
  }, [sortedAircraft, alertVolumes.soundEnabled, alertVolumes.hapticEnabled]);

  // ── Aircraft annotations from ADS-B ──────────────────────────────

  const iconSizePx = ICON_SIZE_PX[aircraftDisplay.iconSize];

  const mapAnnotations: Annotation[] = useMemo(() => {
    const result: Annotation[] = [];

    // GPS position dot — only on Leaflet/Topo; Apple Maps shows its own via showsUserLocation
    if (gps && mapLayer === "topo") {
      result.push({
        id: "gps-pos",
        lat: gps.lat,
        lon: gps.lon,
        style: "gps-position",
        color: "#007aff",
      });
    }

    for (const ac of sortedAircraft) {
      const tagLines: string[] = [];
      if (aircraftDisplay.dataTagLines[0]) tagLines.push(ac.callsign || ac.id);
      if (aircraftDisplay.dataTagLines[1]) {
        const vert = ac.vertRateFpm
          ? ac.vertRateFpm > 100 ? "\u2191" : ac.vertRateFpm < -100 ? "\u2193" : ""
          : "";
        tagLines.push(`${Math.round(ac.altFt)} ft${vert} ${Math.round(ac.speedKts)} kts`);
      }
      if (aircraftDisplay.dataTagLines[2]) tagLines.push(ac.category);

      result.push({
        id: `adsb-${ac.id}`,
        lat: ac.lat,
        lon: ac.lon,
        title: ac.callsign || ac.id,
        subtitle: `${Math.round(ac.altFt)} ft`,
        style: "aircraft",
        kind: "traffic",
        heading: ac.headingDeg,
        iconSize: iconSizePx,
        dataTagLines: tagLines,
        alertLevel: ac._alertLevel,
      });
    }

    // Breadcrumb dots
    if (aircraftDisplay.trailingBreadcrumbs > 0) {
      for (const [id, trail] of posHistoryRef.current) {
        for (let i = 0; i < trail.length - 1; i++) {
          result.push({
            id: `bc-${id}-${trail[i].lat.toFixed(5)}_${trail[i].lon.toFixed(5)}`,
            lat: trail[i].lat,
            lon: trail[i].lon,
            style: "breadcrumb-dot",
          });
        }
      }
    }

    return result;
  }, [sortedAircraft, aircraftDisplay, iconSizePx, gps?.lat, gps?.lon, mapLayer]);

  // ── Polylines: breadcrumbs + velocity vectors ──────────────────────

  const mapPolylines: Polyline[] = useMemo(() => {
    const lines: Polyline[] = [];

    // Velocity vectors
    if (aircraftDisplay.velocityVector > 0) {
      for (const ac of sortedAircraft) {
        if (ac.speedKts > 0) {
          const end = destinationPoint(
            { lat: ac.lat, lon: ac.lon },
            ac.headingDeg,
            ac.speedKts,
            aircraftDisplay.velocityVector,
          );
          const vecColor = ac._alertLevel === "warning" ? "#ff453a"
            : ac._alertLevel === "caution" ? "#ffd60a"
            : "#00d1ff";
          lines.push({
            id: `vector-${ac.id}`,
            points: [{ lat: ac.lat, lon: ac.lon }, end],
            width: 1.5,
            opacity: 0.7,
            color: vecColor,
          });
        }
      }
    }

    // Range rings (centered on resolvedCenter)
    const center = resolvedCenter;
    if (center) {
      // Determine active alert states for ring fills
      const hasWarning = sortedAircraft.some((ac) => ac._alertLevel === "warning");
      const hasCaution = sortedAircraft.some((ac) => ac._alertLevel === "caution" || ac._alertLevel === "warning");

      if (alertVolumes.outerEnabled) {
        lines.push({
          id: "ring-outer",
          points: circlePolyPoints(center, alertVolumes.outerRangeNm),
          width: 4,
          opacity: 0.9,
          color: "#ffd60a",
          dashed: true,
          fillColor: hasCaution ? (hasWarning ? "#ff453a" : "#ffd60a") : undefined,
          fillOpacity: hasCaution ? 0.25 : undefined,
        });
      }
      if (alertVolumes.innerEnabled) {
        lines.push({
          id: "ring-inner",
          points: circlePolyPoints(center, alertVolumes.innerRangeNm),
          width: 4,
          opacity: 0.9,
          color: "#ff453a",
          dashed: true,
          fillColor: hasWarning ? "#ff453a" : undefined,
          fillOpacity: hasWarning ? 0.25 : undefined,
        });
      }
    }

    return lines;
  }, [sortedAircraft, aircraftDisplay.velocityVector, resolvedCenter, alertVolumes]);

  // ── FAA airspace polylines ───────────────────────────────────────

  const faaPolylines: Polyline[] = useMemo(() => {
    return faa.zones.map((zone) => ({
      id: `faa-${zone.id}`,
      points: zone.polygon,
      width: zone.type === "laanc" ? 1.5 : 2,
      opacity: zone.type === "laanc" ? 0.8 : 0.6,
      color: airspaceColor(zone.type),
      fillColor: airspaceColor(zone.type),
      fillOpacity: zone.type === "laanc" ? 0.25 : 0.12,
    }));
  }, [faa.zones]);

  // ── Sorted drones by distance ─────────────────────────────────────

  type DroneWithDist = DroneTrack & { _distNm?: number };

  const sortedDrones: DroneWithDist[] = useMemo(() => {
    const center = resolvedCenter;
    const list: DroneWithDist[] = rid.drones.map((d) => {
      const dist = center ? distanceNm(center, d) : undefined;
      return { ...d, _distNm: dist };
    });
    if (center) list.sort((a, b) => (a._distNm ?? 99999) - (b._distNm ?? 99999));
    return list;
  }, [rid.drones, resolvedCenter]);

  // ── Drone annotations for map ─────────────────────────────────────

  const droneAnnotations: Annotation[] = useMemo(() => {
    const result: Annotation[] = [];
    for (const drone of sortedDrones) {
      result.push({
        id: `rid-${drone.id}`,
        lat: drone.lat,
        lon: drone.lon,
        title: drone.serialNumber ?? drone.sessionId ?? drone.id,
        subtitle: `${Math.round(drone.altFt)} ft`,
        style: "drone",
        kind: "drone",
        heading: drone.headingDeg,
        iconSize: 28,
        dataTagLines: [
          (drone.serialNumber ?? drone.sessionId ?? drone.id).slice(0, 12),
          `${Math.round(drone.altFt)} ft ${Math.round(drone.speedKts)} kts`,
        ],
        alertLevel: "normal",
      });

      // Operator / takeoff location marker
      const opLat = drone.operatorLat ?? drone.takeoffLat;
      const opLon = drone.operatorLon ?? drone.takeoffLon;
      if (opLat != null && opLon != null) {
        result.push({
          id: `rid-op-${drone.id}`,
          lat: opLat,
          lon: opLon,
          style: "rid-operator",
          title: drone.operatorLat != null ? "Operator" : "Takeoff",
        });
      }
    }
    return result;
  }, [sortedDrones]);

  // ── Drone-to-operator/takeoff connecting lines ───────────────────

  const droneOperatorLines: Polyline[] = useMemo(() => {
    const lines: Polyline[] = [];
    for (const drone of sortedDrones) {
      const opLat = drone.operatorLat ?? drone.takeoffLat;
      const opLon = drone.operatorLon ?? drone.takeoffLon;
      if (opLat != null && opLon != null) {
        lines.push({
          id: `rid-link-${drone.id}`,
          points: [
            { lat: drone.lat, lon: drone.lon },
            { lat: opLat, lon: opLon },
          ],
          width: 1.5,
          opacity: 0.5,
          color: "#ffa500",
          dashed: true,
        });
      }
    }
    return lines;
  }, [sortedDrones]);

  // ── Merged polylines for map ──────────────────────────────────────

  const allMapPolylines: Polyline[] = useMemo(() => [
    ...mapPolylines,
    ...faaPolylines,
    ...droneOperatorLines,
  ], [mapPolylines, faaPolylines, droneOperatorLines]);

  // ── Merged annotations for map ────────────────────────────────────

  // ── Obstruction annotations ──────────────────────────────────────
  const obstructionAnnotations: Annotation[] = useMemo(() => {
    return faa.obstructions.map((obs) => ({
      id: obs.id,
      lat: obs.lat,
      lon: obs.lon,
      title: `${obs.typeCode} ${obs.aglFt} ft AGL`,
      subtitle: obs.city ? `${obs.city}, ${obs.state}` : undefined,
      style: "obstruction",
      color: "#fb923c",
    }));
  }, [faa.obstructions]);

  const allMapAnnotations: Annotation[] = useMemo(() => [
    ...mapAnnotations,
    ...droneAnnotations,
    ...obstructionAnnotations,
  ], [mapAnnotations, droneAnnotations, obstructionAnnotations]);

  // ── Tile overlays (VFR Sectional chart) ─────────────────────────
  const VFR_SECTIONAL_URL = "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}";
  const mapTileOverlays: import("./MapKitMap").TileOverlayConfig[] = useMemo(() => {
    if (!vfrSectionalEnabled) return [];
    return [{ id: "vfr-sectional", urlTemplate: VFR_SECTIONAL_URL, opacity: 0.7 }];
  }, [vfrSectionalEnabled]);

  // ── Derived ─────────────────────────────────────────────────────

  const emoji = conditionEmoji(weather?.conditionCode, weather?.daylight);
  const condText = conditionLabel(weather?.conditionCode);

  // ── Annotation click → select item and show Details tab ─────────
  const handleAnnotationSelect = (annotationId: string) => {
    if (annotationId.startsWith("obs-")) {
      const obs = faa.obstructions.find((o) => o.id === annotationId);
      if (obs) {
        setSelectedObstruction((prev) => prev?.id === obs.id ? null : obs);
        setSelectedFaaZone(null);
        setSelectedAircraft(null);
        setSelectedDrone(null);
        setPanelTab("details");
        setPanelOpen(true);
      }
    } else if (annotationId.startsWith("adsb-")) {
      const acId = annotationId.slice(5);
      setSelectedAircraft((prev) => prev === acId ? null : acId);
      setSelectedFaaZone(null);
      setSelectedObstruction(null);
      setSelectedDrone(null);
      setPanelTab("details");
      setPanelOpen(true);
    } else if (annotationId.startsWith("rid-") && !annotationId.startsWith("rid-op-")) {
      const droneId = annotationId.slice(4);
      setSelectedDrone((prev) => prev === droneId ? null : droneId);
      setSelectedFaaZone(null);
      setSelectedObstruction(null);
      setSelectedAircraft(null);
      setPanelTab("details");
      setPanelOpen(true);
    }
  };

  // ── Overlay click → select FAA zone ─────────────────────────────
  const handleOverlaySelect = (overlayId: string) => {
    if (!overlayId.startsWith("faa-")) return;
    const zoneId = overlayId.slice(4); // strip "faa-" prefix
    const zone = faa.zones.find((z) => z.id === zoneId);
    if (zone) {
      setSelectedObstruction(null);
      setSelectedFaaZone((prev) => prev?.id === zone.id ? null : zone);
      setSelectedAircraft(null);
      setSelectedDrone(null);
      setPanelTab("details");
      setPanelOpen(true);
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="appShell">
      {/* ── Map ── */}
      <div className="mapLayer">
        {mapLayer === "apple" ? (
          <MapKitMap
            variant="full"
            center={mapCenter ?? undefined}
            annotations={allMapAnnotations}
            polylines={allMapPolylines}
            tileOverlays={mapTileOverlays}
            onSelect={handleAnnotationSelect}
            onViewChange={(_zoom, bounds) => {
              setMapBbox(bounds);
            }}
            onMapClick={(lat, lon) => setTapMapPos({ lat, lon })}
            onOverlaySelect={handleOverlaySelect}
          />
        ) : (
          <Suspense fallback={<div style={{ background: "#1a1a1a", width: "100%", height: "100%" }} />}>
            <LeafletMap
              variant="full"
              center={mapCenter ?? undefined}
              annotations={allMapAnnotations}
              polylines={allMapPolylines}
              tileOverlays={mapTileOverlays}
              onSelect={handleAnnotationSelect}
              onViewChange={(zoom, bounds) => {
                setLeafletView({ zoom, bounds });
                setMapBbox(bounds);
              }}
              onMapClick={(lat, lon) => setTapMapPos({ lat, lon })}
              onOverlaySelect={handleOverlaySelect}
            />
          </Suspense>
        )}
      </div>

      {/* ── Side Panel Layer ── */}
      <div className="sidePanelLayer">
        <div className={`sidePanel ${panelOpen ? "" : "closed"}`}>
          {/* Handle */}
          <div
            className="panelHandle"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <div className="panelHandleBar" />
          </div>

          {/* Header */}
          <div className="panelHeader">
            <div className="panelTitle">
              <div className="panelAppName">DroneDAA</div>
              <div className="panelSubtitle">Detect & Avoid</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="panelTabs">
            <div className="tabRow">
              {([["maps", "Maps"], ["alerts", "Alerts"], ["adsb", "ADS-B"], ["remoteid", "Remote ID"]] as const).map(([id, label]) => (
                <button key={id} className={`tabBtn ${panelTab === id ? "active" : ""}`}
                  onClick={() => setPanelTab(id)}>{label}</button>
              ))}
            </div>
            <div className="tabRow">
              {([["details", "Details"], ["weather", "Weather"], ["settings", "Settings"], ["howto", "How To"]] as const).map(([id, label]) => (
                <button key={id} className={`tabBtn ${panelTab === id ? "active" : ""}`}
                  onClick={() => setPanelTab(id)}>{label}</button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="panelBody">
            {panelTab === "maps" && (
              <div className="panelSection">
                {/* Map Layer */}
                <div className="sectionTitle">Map Layer</div>
                <div className="row">
                  <span className="rowTitle">Base Map</span>
                  <div className="btnRow">
                    <button
                      className={`chipBtn compact ${mapLayer === "apple" ? "active" : ""}`}
                      onClick={() => setMapLayer("apple")}
                    >
                      Apple
                    </button>
                    <button
                      className={`chipBtn compact ${mapLayer === "topo" ? "active" : ""}`}
                      onClick={() => setMapLayer("topo")}
                    >
                      Topo
                    </button>
                  </div>
                </div>

                {/* Offline Maps (topo only) */}
                {mapLayer === "topo" && (
                  <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                    <div className="sectionTitle" style={{ fontSize: 12, marginTop: 4 }}>Offline Maps</div>
                    <button
                      className="chipBtn"
                      disabled={!!downloadProgress?.downloading}
                      onClick={async () => {
                        const { downloadTilesForArea, getCacheStats, cacheFaaLayer } = await import("./services/offlineTiles");
                        const { FAA_LAYERS: allLayers, fetchAirspace: fetchAir, fetchObstructions: fetchObs } = await import("./services/airspace");
                        const abort = new AbortController();
                        downloadAbortRef.current = abort;
                        setDownloadProgress({ downloading: true, downloaded: 0, total: 0, failed: 0 });
                        const currentZoom = leafletView?.zoom ?? 12;
                        const bbox = leafletView?.bounds ?? (() => {
                          const c = mapCenter ?? { lat: 37.09, lon: -79.67 };
                          const d = 0.08;
                          return { south: c.lat - d, north: c.lat + d, west: c.lon - d, east: c.lon + d };
                        })();
                        const zoomMin = Math.max(currentZoom - 2, 8);
                        const zoomMax = Math.min(currentZoom + 2, 16);
                        try {
                          // Download map tiles
                          await downloadTilesForArea(bbox, zoomMin, zoomMax,
                            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
                            (downloaded, total, failed) => {
                              setDownloadProgress({ downloading: true, downloaded, total, failed });
                            },
                            abort.signal,
                          );
                          // Cache enabled FAA layers + obstructions for offline use
                          const enabledIds = faa.enabledLayers;
                          for (const layer of allLayers) {
                            if (!enabledIds.has(layer.id) || layer.id === "obstructions") continue;
                            try {
                              const zones = await fetchAir(bbox, layer, abort.signal);
                              await cacheFaaLayer(layer.id, bbox, JSON.stringify(zones));
                            } catch { /* skip on error */ }
                          }
                          if (enabledIds.has("obstructions")) {
                            try {
                              const obs = await fetchObs(bbox, abort.signal);
                              await cacheFaaLayer("obstructions", bbox, JSON.stringify(obs));
                            } catch { /* skip */ }
                          }
                        } catch { /* aborted or failed */ }
                        setDownloadProgress(null);
                        downloadAbortRef.current = null;
                        const stats = await getCacheStats();
                        setCacheStats(stats);
                      }}
                    >
                      {downloadProgress?.downloading
                        ? `Downloading... ${downloadProgress.downloaded}/${downloadProgress.total}`
                        : "Download Current View"}
                    </button>
                    {downloadProgress?.downloading && (
                      <>
                        <div style={{
                          position: "relative", height: 4, borderRadius: 2,
                          background: "rgba(255,255,255,0.1)",
                        }}>
                          <div style={{
                            position: "absolute", left: 0, top: 0, bottom: 0,
                            width: `${downloadProgress.total > 0 ? (downloadProgress.downloaded / downloadProgress.total) * 100 : 0}%`,
                            background: "rgba(0, 209, 255, 0.7)",
                            borderRadius: 2,
                          }} />
                        </div>
                        <button
                          className="linkBtn"
                          onClick={() => downloadAbortRef.current?.abort()}
                          style={{ fontSize: 11 }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {cacheStats && (
                      <span className="smallMuted">
                        {cacheStats.tileCount.toLocaleString()} tiles cached
                        ({(cacheStats.totalBytes / (1024 * 1024)).toFixed(1)} MB)
                      </span>
                    )}
                    <button
                      className="linkBtn"
                      style={{ fontSize: 11 }}
                      onClick={async () => {
                        const { clearTileCache, getCacheStats } = await import("./services/offlineTiles");
                        await clearTileCache();
                        const stats = await getCacheStats();
                        setCacheStats(stats);
                      }}
                    >
                      Clear tile cache
                    </button>
                  </div>
                )}
                <p className="smallMuted">Only Topo maps are available for offline use.</p>

                <div className="divider" />

                {/* FAA Airspace Layer Toggles */}
                <div className="sectionTitle">FAA Airspace Layers</div>
                <p className="smallMuted">Toggle layers to display on map. Data from FAA ArcGIS.</p>

                {/* VFR Sectional chart overlay */}
                <div className="row" style={{ alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: 2,
                      background: "linear-gradient(135deg, #8b5cf6, #3b82f6, #10b981)",
                      flexShrink: 0,
                    }} />
                    <span className="rowTitle">VFR Sectional Chart</span>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={vfrSectionalEnabled}
                      onChange={() => setVfrSectionalEnabled((v) => !v)}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="divider" />
                <div className="sectionTitle" style={{ fontSize: 11 }}>Airspace &amp; Restriction Layers</div>

                {FAA_LAYERS.map((layer) => (
                  <div className="row" key={layer.id} style={{ alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: 2,
                        background: airspaceColor(layer.defaultType),
                        flexShrink: 0,
                      }} />
                      <span className="rowTitle">{layer.label}</span>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={faa.enabledLayers.has(layer.id)}
                        onChange={() => faa.toggleLayer(layer.id)}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                ))}

                {faa.loading && (
                  <p className="smallMuted">Loading airspace data...</p>
                )}
                {faa.error && (
                  <p className="errText">{faa.error}</p>
                )}
              </div>
            )}

            {panelTab === "alerts" && (
              <div className="panelSection">
                {/* ── Notifications (top) ── */}
                <div className="sectionTitle">Notifications</div>
                <div className="row">
                  <span className="rowTitle">Alert Sound</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={alertVolumes.soundEnabled}
                      onChange={() => setAlertVolumes((s) => ({ ...s, soundEnabled: !s.soundEnabled }))}
                    />
                    <span className="slider" />
                  </label>
                </div>
                <div className="row">
                  <span className="rowTitle">Alert Haptic</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={alertVolumes.hapticEnabled}
                      onChange={() => setAlertVolumes((s) => ({ ...s, hapticEnabled: !s.hapticEnabled }))}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="divider" />

                {/* ── Alert Volumes ── */}
                <div className="sectionTitle">Alert Volumes</div>

                {/* Outer Ring (Caution) */}
                <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="rowTitle" style={{ color: "#ffd60a" }}>Outer Ring (Caution)</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={alertVolumes.outerEnabled}
                        onChange={() => setAlertVolumes((s) => ({ ...s, outerEnabled: !s.outerEnabled }))}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                  {alertVolumes.outerEnabled && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="smallMuted">Range</span>
                        <span className="smallMuted">{alertVolumes.outerRangeNm} nm</span>
                      </div>
                      <input
                        type="range" min={0.5} max={15} step={0.5}
                        value={alertVolumes.outerRangeNm}
                        onChange={(e) => setAlertVolumes((s) => {
                          const v = Number(e.target.value);
                          return { ...s, outerRangeNm: v, innerRangeNm: Math.min(s.innerRangeNm, v) };
                        })}
                        className="settingsRange"
                      />
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="smallMuted">Ceiling</span>
                        <span className="smallMuted">{alertVolumes.outerCeilingFt.toLocaleString()} ft</span>
                      </div>
                      <input
                        type="range" min={500} max={30000} step={500}
                        value={alertVolumes.outerCeilingFt}
                        onChange={(e) => setAlertVolumes((s) => {
                          const v = Number(e.target.value);
                          return { ...s, outerCeilingFt: v, innerCeilingFt: Math.min(s.innerCeilingFt, v) };
                        })}
                        className="settingsRange"
                      />
                    </>
                  )}
                </div>

                {/* Inner Ring (Warning) */}
                <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="rowTitle" style={{ color: "#ff453a" }}>Inner Ring (Warning)</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={alertVolumes.innerEnabled}
                        onChange={() => setAlertVolumes((s) => ({ ...s, innerEnabled: !s.innerEnabled }))}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                  {alertVolumes.innerEnabled && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="smallMuted">Range</span>
                        <span className="smallMuted">{alertVolumes.innerRangeNm} nm</span>
                      </div>
                      <input
                        type="range" min={0.5} max={alertVolumes.outerRangeNm} step={0.5}
                        value={alertVolumes.innerRangeNm}
                        onChange={(e) => setAlertVolumes((s) => ({ ...s, innerRangeNm: Math.min(Number(e.target.value), s.outerRangeNm) }))}
                        className="settingsRange"
                      />
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span className="smallMuted">Ceiling</span>
                        <span className="smallMuted">{alertVolumes.innerCeilingFt.toLocaleString()} ft</span>
                      </div>
                      <input
                        type="range" min={500} max={alertVolumes.outerCeilingFt} step={500}
                        value={alertVolumes.innerCeilingFt}
                        onChange={(e) => setAlertVolumes((s) => ({ ...s, innerCeilingFt: Math.min(Number(e.target.value), s.outerCeilingFt) }))}
                        className="settingsRange"
                      />
                    </>
                  )}
                </div>

                <div className="divider" />

                {/* ── Ring Center ── */}
                <div className="sectionTitle">Ring Center</div>
                <p className="smallMuted">
                  Select sources for centering range rings. Falls back through tiers
                  if a source is unavailable.
                </p>

                {(["primary", "secondary"] as const).map((tier) => {
                  const src = centerSource[tier];
                  const tierLabel = tier === "primary" ? "Primary" : "Secondary";
                  return (
                    <div className="row" key={tier} style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                      <span className="smallMuted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                        {tierLabel}
                        {activeCenterTier === tier && (
                          <span style={{ color: "#30d158", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>Active</span>
                        )}
                      </span>
                      <select
                        style={{
                          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 8, color: "white", padding: "6px 8px", fontSize: 12, width: "100%",
                        }}
                        value={src.kind === "ridDrone" ? `ridDrone:${src.ridDroneId ?? ""}` : src.kind}
                        onChange={(e) => {
                          const val = e.target.value;
                          let config: CenterSourceConfig;
                          if (val.startsWith("ridDrone:")) {
                            config = { kind: "ridDrone", ridDroneId: val.slice(9) };
                          } else {
                            config = { kind: val as CenterSourceKind };
                          }
                          setCenterSource((s) => ({ ...s, [tier]: config }));
                        }}
                      >
                        <option value="deviceGps">{CENTER_SOURCE_LABELS.deviceGps}</option>
                        <option value="gdl90Gps">{CENTER_SOURCE_LABELS.gdl90Gps}</option>
                        {rid.drones.map((d) => (
                          <option key={d.id} value={`ridDrone:${d.id}`}>
                            Drone: {(d.serialNumber ?? d.sessionId ?? d.id).slice(0, 16)}
                          </option>
                        ))}
                        <option value="tapMap">{CENTER_SOURCE_LABELS.tapMap}</option>
                      </select>
                    </div>
                  );
                })}

                <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                  <span className="smallMuted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    Tertiary (fallback)
                    {activeCenterTier === "tertiary" && (
                      <span style={{ color: "#30d158", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>Active</span>
                    )}
                  </span>
                  <span className="smallMuted">{CENTER_SOURCE_LABELS.tapMap}</span>
                </div>

                {resolvedCenter && (
                  <div className="smallMuted" style={{ marginTop: 4 }}>
                    Center: {resolvedCenter.lat.toFixed(4)}, {resolvedCenter.lon.toFixed(4)}
                  </div>
                )}
              </div>
            )}

            {panelTab === "details" && (
              <div className="panelSection">
                <div className="sectionTitle">Details</div>

                {/* Selected airspace zone detail */}
                {selectedFaaZone && (
                  <div className="kv" style={{
                    padding: 8,
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    borderLeft: `3px solid ${airspaceColor(selectedFaaZone.type)}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>{selectedFaaZone.name}</div>
                      <span
                        style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: "0 2px" }}
                        onClick={() => setSelectedFaaZone(null)}
                      >
                        dismiss
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                      Type: {selectedFaaZone.type.toUpperCase()}
                      {selectedFaaZone.floorFt > 0 || selectedFaaZone.ceilingFt < 99999
                        ? ` | ${selectedFaaZone.floorFt} - ${selectedFaaZone.ceilingFt} ft`
                        : ""}
                    </div>
                    {selectedFaaZone.type === "tfr" && selectedFaaZone.attributes && (
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                        {selectedFaaZone.attributes.NOTAM_ID && (
                          <div>NOTAM: {selectedFaaZone.attributes.NOTAM_ID}</div>
                        )}
                        {selectedFaaZone.attributes.REASON && (
                          <div>Reason: {selectedFaaZone.attributes.REASON}</div>
                        )}
                        {selectedFaaZone.attributes.DESCRIPTION && (
                          <div style={{ marginTop: 2 }}>{selectedFaaZone.attributes.DESCRIPTION}</div>
                        )}
                        {selectedFaaZone.attributes.EFFECTIVE_DATE && (
                          <div>Effective: {new Date(selectedFaaZone.attributes.EFFECTIVE_DATE).toLocaleDateString()}</div>
                        )}
                        {selectedFaaZone.attributes.EXPIRE_DATE && (
                          <div>Expires: {new Date(selectedFaaZone.attributes.EXPIRE_DATE).toLocaleDateString()}</div>
                        )}
                        {selectedFaaZone.attributes.CITY && (
                          <div>Location: {selectedFaaZone.attributes.CITY}{selectedFaaZone.attributes.STATE ? `, ${selectedFaaZone.attributes.STATE}` : ""}</div>
                        )}
                      </div>
                    )}
                    {selectedFaaZone.type === "laanc" && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#22d3ee" }}>
                          {selectedFaaZone.ceilingFt < 99999 ? `${selectedFaaZone.ceilingFt} ft AGL` : "Check LAANC"}
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                          Maximum altitude for this LAANC grid cell
                        </div>
                        {selectedFaaZone.ceilingFt === 0 && (
                          <div style={{ fontSize: 11, color: "#ff453a", marginTop: 4, fontWeight: 600 }}>
                            Flight not authorized in this grid cell
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Selected obstruction detail */}
                {selectedObstruction && (
                  <div className="kv" style={{
                    padding: 8,
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 8,
                    borderLeft: "3px solid #fb923c",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>Obstruction</div>
                      <span
                        style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: "0 2px" }}
                        onClick={() => setSelectedObstruction(null)}
                      >
                        dismiss
                      </span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#fb923c", marginTop: 4 }}>
                      {selectedObstruction.aglFt} ft AGL
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                      <div>Type: {selectedObstruction.typeCode}</div>
                      <div>AMSL: {selectedObstruction.amslFt} ft</div>
                      {selectedObstruction.lighting && (
                        <div>Lighting: {selectedObstruction.lighting === "R" ? "Red" : selectedObstruction.lighting === "D" ? "Dual (Red/White)" : selectedObstruction.lighting === "W" ? "White" : selectedObstruction.lighting === "N" ? "None" : selectedObstruction.lighting}</div>
                      )}
                      {selectedObstruction.city && (
                        <div>{selectedObstruction.city}{selectedObstruction.state ? `, ${selectedObstruction.state}` : ""}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                      {selectedObstruction.lat.toFixed(5)}, {selectedObstruction.lon.toFixed(5)}
                    </div>
                  </div>
                )}

                {/* Selected aircraft detail */}
                {selectedAircraft && (() => {
                  const ac = sortedAircraft.find((a) => a.id === selectedAircraft);
                  if (!ac) return null;
                  const vertChar = ac.vertRateFpm
                    ? ac.vertRateFpm > 100 ? "\u2191" : ac.vertRateFpm < -100 ? "\u2193" : ""
                    : "";
                  const alertColor = ac._alertLevel === "warning" ? "#ff453a"
                    : ac._alertLevel === "caution" ? "#ffd60a" : "#00d1ff";
                  return (
                    <div className="kv" style={{
                      padding: 8,
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      borderLeft: `3px solid ${alertColor}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {ac.callsign || ac.id}
                        </div>
                        <span
                          style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: "0 2px" }}
                          onClick={() => setSelectedAircraft(null)}
                        >
                          dismiss
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        ADS-B Aircraft
                      </div>
                      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Altitude</div>
                          <div style={{ fontWeight: 600 }}>{Math.round(ac.altFt).toLocaleString()} ft{vertChar}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Speed</div>
                          <div style={{ fontWeight: 600 }}>{Math.round(ac.speedKts)} kts</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Heading</div>
                          <div style={{ fontWeight: 600 }}>{Math.round(ac.headingDeg)}&deg;</div>
                        </div>
                      </div>
                      {ac._distNm != null && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
                          Distance: {ac._distNm.toFixed(1)} nm
                        </div>
                      )}
                      {ac.vertRateFpm != null && Math.abs(ac.vertRateFpm) > 50 && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                          Vertical rate: {ac.vertRateFpm > 0 ? "+" : ""}{Math.round(ac.vertRateFpm)} fpm
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        Category: {ac.category || "Unknown"}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                        ICAO: {ac.id} | {ac.lat.toFixed(5)}, {ac.lon.toFixed(5)}
                      </div>
                    </div>
                  );
                })()}

                {/* Selected drone detail */}
                {selectedDrone && (() => {
                  const drone = sortedDrones.find((d) => d.id === selectedDrone);
                  if (!drone) return null;
                  const vertChar = drone.vertRateFpm
                    ? drone.vertRateFpm > 100 ? "\u2191" : drone.vertRateFpm < -100 ? "\u2193" : ""
                    : "";
                  const idLabel = drone.serialNumber ?? drone.sessionId ?? drone.id;
                  return (
                    <div className="kv" style={{
                      padding: 8,
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 8,
                      borderLeft: "3px solid #ffa500",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {idLabel.length > 20 ? idLabel.slice(0, 20) + "\u2026" : idLabel}
                        </div>
                        <span
                          style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: "0 2px" }}
                          onClick={() => setSelectedDrone(null)}
                        >
                          dismiss
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        Remote ID Drone
                      </div>
                      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Altitude</div>
                          <div style={{ fontWeight: 600 }}>{Math.round(drone.altFt)} ft{vertChar}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Speed</div>
                          <div style={{ fontWeight: 600 }}>{Math.round(drone.speedKts)} kts</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Heading</div>
                          <div style={{ fontWeight: 600 }}>{Math.round(drone.headingDeg)}&deg;</div>
                        </div>
                      </div>
                      {drone._distNm != null && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
                          Distance: {drone._distNm.toFixed(1)} nm
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 6, flexWrap: "wrap" }}>
                        <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.08)" }}>
                          {drone.ridType === "standard" ? "Standard RID" : "Broadcast Module"}
                        </span>
                        <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.08)" }}>
                          {broadcastTypeLabel(drone.broadcastType)}
                        </span>
                        <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.08)" }}>
                          {drone.operationalStatus}
                        </span>
                      </div>
                      {(drone.operatorLat != null || drone.takeoffLat != null) && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
                          {drone.operatorLat != null
                            ? `Operator: ${drone.operatorLat!.toFixed(5)}, ${drone.operatorLon!.toFixed(5)}`
                            : `Takeoff: ${drone.takeoffLat!.toFixed(5)}, ${drone.takeoffLon!.toFixed(5)}`}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                        {drone.lat.toFixed(5)}, {drone.lon.toFixed(5)}
                      </div>
                    </div>
                  );
                })()}

                {/* Nothing selected state */}
                {!selectedFaaZone && !selectedObstruction && !selectedAircraft && !selectedDrone && (
                  <div style={{ textAlign: "center", padding: "24px 12px" }}>
                    <p className="smallMuted" style={{ fontSize: 12 }}>
                      No item selected
                    </p>
                    <p className="smallMuted" style={{ fontSize: 11, marginTop: 8 }}>
                      Tap an airspace zone, obstruction, aircraft, or drone on the map to view its details here.
                    </p>
                  </div>
                )}
              </div>
            )}

            {panelTab === "weather" && (
              <div className="panelSection">
                <div className="sectionTitle">Weather</div>
                {resolvedCenter && (
                  <p className="smallMuted" style={{ marginBottom: 6 }}>
                    Location: {resolvedCenter.lat.toFixed(4)}, {resolvedCenter.lon.toFixed(4)}
                  </p>
                )}

                {weatherLoading && !weather ? (
                  <p className="smallMuted">Loading weather...</p>
                ) : weather ? (
                  <>
                    {/* ── Next Hour Precipitation Card ── */}
                    <div className="kv">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{"\u2601\uFE0F"}</span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>Next Hour</span>
                        <span className="smallMuted" style={{ marginLeft: "auto" }}>
                          {nextHourSummaryText(nextHour)}
                        </span>
                      </div>

                      {/* Precipitation mini-chart */}
                      <div style={{ marginTop: 8 }}>
                        <svg width="100%" height="32" viewBox="0 0 300 32" preserveAspectRatio="none">
                          {/* Baseline */}
                          <line x1="0" y1="28" x2="300" y2="28"
                            stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
                          {/* Bars for each 5-min bucket (up to 12 bars) */}
                          {nextHour?.minutes && (() => {
                            const buckets = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
                            return buckets.map((idx, i) => {
                              const m = nextHour.minutes?.[idx];
                              const intensity = m?.precipitationIntensity ?? 0;
                              const h = Math.min(intensity * 60, 24); // scale: 1mm/hr → full bar
                              return (
                                <rect
                                  key={i}
                                  x={i * 25 + 2}
                                  y={28 - h}
                                  width={20}
                                  height={Math.max(h, 0.5)}
                                  rx={2}
                                  fill={intensity > 0 ? "rgba(0, 180, 255, 0.5)" : "rgba(255,255,255,0.06)"}
                                />
                              );
                            });
                          })()}
                        </svg>
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginTop: 4,
                          fontSize: 11,
                          color: "rgba(255,255,255,0.4)",
                        }}>
                          <span>Now</span>
                          <span>+15m</span>
                          <span>+30m</span>
                          <span>+45m</span>
                          <span>+60m</span>
                        </div>
                      </div>
                    </div>

                    {/* ── Current Conditions Card ── */}
                    <div className="kv">
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <span style={{ fontSize: 28, fontWeight: 700 }}>
                          {weather.temperature_2m != null ? `${Math.round(weather.temperature_2m)}°F` : "—"}
                        </span>
                        <span style={{ fontSize: 15, color: "rgba(255,255,255,0.7)" }}>
                          {emoji} {condText}
                        </span>
                      </div>

                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
                        <div>
                          Feels like: {weather.temperatureApparent != null ? `${Math.round(weather.temperatureApparent)}°F` : "—"}
                        </div>
                        <div>
                          Wind: {weather.wind_speed_10m != null ? `${Math.round(weather.wind_speed_10m)} mph` : "—"}
                          {weather.wind_direction_10m != null ? ` from ${Math.round(weather.wind_direction_10m)}°` : ""}
                          {weather.wind_gusts_10m != null ? ` (gusts ${Math.round(weather.wind_gusts_10m)} mph)` : ""}
                        </div>
                        <div>
                          Humidity: {weather.humidity != null ? `${weather.humidity}%` : "—"}
                        </div>
                        <div>
                          Cloud cover: {weather.cloud_cover != null ? `${weather.cloud_cover}%` : "—"}
                        </div>
                        <div>
                          UV Index: {weather.uvIndex != null ? weather.uvIndex : "—"}
                        </div>
                        <div>
                          Visibility: {formatVisibility(weather.visibility)}
                        </div>
                      </div>
                    </div>

                    {/* ── Divider ── */}
                    <div className="divider" />

                    {/* ── Next Hours ── */}
                    {hourly.length > 0 && (
                      <>
                        <div className="sectionTitle">Next Hours</div>
                        <div className="hourlyScroll">
                          {hourly.slice(0, 12).map((h, i) => (
                            <div key={i} className="kv" style={{
                              minWidth: 64,
                              textAlign: "center",
                              padding: "8px 6px",
                              gap: 4,
                              flex: "0 0 auto",
                            }}>
                              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                                {formatHour(h.time)}
                              </div>
                              <div style={{ fontSize: 16, fontWeight: 600 }}>
                                {h.temperature != null ? `${h.temperature}°` : "—"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* ── Attribution ── */}
                    <div style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "rgba(255,255,255,0.25)",
                    }}>
                      Apple Weather
                    </div>
                  </>
                ) : (
                  <p className="smallMuted">Weather data unavailable.</p>
                )}
              </div>
            )}

            {panelTab === "adsb" && (
              <div className="panelSection">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="sectionTitle">Live Flights</div>
                  <span className="smallMuted">{adsb.count} tracked</span>
                </div>

                {/* Connection status */}
                <AdsbStatusBadge status={adsb.status} gpsValid={adsb.gpsValid} />

                {/* Traffic — sorted by distance */}
                {sortedAircraft.length > 0 && (
                  <div className="list">
                    {sortedAircraft.map((ac) => (
                      <div key={ac.id} style={{ cursor: "pointer" }} onClick={() => {
                        setSelectedAircraft(ac.id);
                        setSelectedFaaZone(null);
                        setSelectedObstruction(null);
                        setSelectedDrone(null);
                        setPanelTab("details");
                      }}>
                        <AircraftCard aircraft={ac} distNm={ac._distNm} alertLevel={ac._alertLevel} />
                      </div>
                    ))}
                  </div>
                )}

                {adsb.status === "disconnected" && (
                  <p className="smallMuted" style={{ marginTop: 12 }}>
                    Connect a GDL-90 compatible ADS-B receiver to your network
                    and start the relay to see live traffic.
                  </p>
                )}
              </div>
            )}

            {panelTab === "settings" && (
              <div className="panelSection">
                <div className="sectionTitle">Aircraft Display</div>

                {/* Icon Size */}
                <div className="row">
                  <span className="rowTitle">Icon Size</span>
                  <div className="btnRow">
                    {(["small", "medium", "large"] as const).map((sz) => (
                      <button
                        key={sz}
                        className={`chipBtn compact ${aircraftDisplay.iconSize === sz ? "active" : ""}`}
                        onClick={() => setAircraftDisplay((s) => ({ ...s, iconSize: sz }))}
                      >
                        {sz === "small" ? "S" : sz === "medium" ? "M" : "L"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Data Tag Lines */}
                <div className="sectionTitle" style={{ fontSize: 12, marginTop: 4 }}>Data Tag</div>
                {[
                  { idx: 0, label: "Callsign / ICAO" },
                  { idx: 1, label: "Altitude & Speed" },
                  { idx: 2, label: "Category" },
                ].map(({ idx, label }) => (
                  <div className="row" key={idx}>
                    <span className="rowTitle">{label}</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={aircraftDisplay.dataTagLines[idx]}
                        onChange={() =>
                          setAircraftDisplay((s) => {
                            const lines = [...s.dataTagLines] as [boolean, boolean, boolean];
                            lines[idx] = !lines[idx];
                            return { ...s, dataTagLines: lines };
                          })
                        }
                      />
                      <span className="slider" />
                    </label>
                  </div>
                ))}

                {/* Trailing Breadcrumbs */}
                <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="rowTitle">Trailing Breadcrumbs</span>
                    <span className="smallMuted">
                      {aircraftDisplay.trailingBreadcrumbs === 0 ? "Off" : aircraftDisplay.trailingBreadcrumbs}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0} max={20} step={1}
                    value={aircraftDisplay.trailingBreadcrumbs}
                    onChange={(e) =>
                      setAircraftDisplay((s) => ({ ...s, trailingBreadcrumbs: Number(e.target.value) }))
                    }
                    className="settingsRange"
                  />
                </div>

                {/* Velocity Vector */}
                <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="rowTitle">Velocity Vector</span>
                    <span className="smallMuted">
                      {aircraftDisplay.velocityVector === 0 ? "Off" : `${aircraftDisplay.velocityVector}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0} max={120} step={5}
                    value={aircraftDisplay.velocityVector}
                    onChange={(e) =>
                      setAircraftDisplay((s) => ({ ...s, velocityVector: Number(e.target.value) }))
                    }
                    className="settingsRange"
                  />
                </div>

                <div className="divider" />

                <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255, 255, 255, 0.35)" }}>
                  <a href="/privacy" className="linkBtn">Privacy Policy</a>
                  {" · "}
                  <a href="/support" className="linkBtn">Support</a>
                </div>
              </div>
            )}

            {panelTab === "remoteid" && (
              <div className="panelSection">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="sectionTitle">Remote ID</div>
                  <span className="smallMuted">{rid.count} drones</span>
                </div>

                {/* Scan controls */}
                <div className="row">
                  <span className="rowTitle">RID Scan</span>
                  <button
                    className={`chipBtn compact ${rid.status === "scanning" || rid.status === "receiving" ? "active" : ""}`}
                    onClick={() => rid.status === "scanning" || rid.status === "receiving"
                      ? rid.stopScan()
                      : rid.startScan()
                    }
                  >
                    {rid.status === "scanning" || rid.status === "receiving" ? "Stop" : "Start"}
                  </button>
                </div>

                {/* Status */}
                <RidStatusBadge status={rid.status} />

                {rid.error && <p className="errText">{rid.error}</p>}

                {/* Drone list sorted by distance */}
                {sortedDrones.length > 0 && (
                  <div className="list">
                    {sortedDrones.map((d) => (
                      <div key={d.id} style={{ cursor: "pointer" }} onClick={() => {
                        setSelectedDrone(d.id);
                        setSelectedFaaZone(null);
                        setSelectedObstruction(null);
                        setSelectedAircraft(null);
                        setPanelTab("details");
                      }}>
                        <DroneCard drone={d} distNm={d._distNm} />
                      </div>
                    ))}
                  </div>
                )}

                {rid.count === 0 && (rid.status === "scanning" || rid.status === "receiving") && (
                  <p className="smallMuted" style={{ marginTop: 8 }}>
                    No drones detected yet. Ensure you are within broadcast range.
                  </p>
                )}

                {rid.status === "idle" && (
                  <p className="smallMuted" style={{ marginTop: 8 }}>
                    Start scanning to detect nearby drones broadcasting Remote ID
                    via Bluetooth 5 or WiFi. Compatible with ASTM F3586-22.
                  </p>
                )}
              </div>
            )}

            {panelTab === "howto" && (
              <div className="panelSection">
                <div className="sectionTitle">How To Use DroneDAA</div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Getting Started</div>
                  <p className="smallMuted">
                    DroneDAA helps drone pilots detect and avoid manned aircraft
                    and other drones using ADS-B and Remote ID data. Center the map
                    on your flight location and enable the layers you need.
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Relay Setup</div>
                  <p className="smallMuted">
                    ADS-B and Remote ID data require a local relay process
                    running on your computer or network. Start the relay with:
                  </p>
                  <div style={{
                    background: "rgba(255,255,255,0.06)", borderRadius: 6,
                    padding: "6px 10px", marginTop: 4, fontSize: 12,
                    fontFamily: "monospace", color: "rgba(255,255,255,0.8)",
                  }}>
                    npx dronedaa-relay
                  </div>
                  <p className="smallMuted" style={{ marginTop: 4 }}>
                    Or clone the repo and run: node relay/start.js
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>ADS-B Traffic (Flights Tab)</div>
                  <p className="smallMuted">
                    Connect a GDL-90 compatible ADS-B receiver (e.g., Stratux, SkyEcho,
                    Ping, ForeFlight Sentry) to your device's network. The relay
                    listens on UDP port 4000 for GDL-90 data and forwards it to the
                    web app. Aircraft are color-coded by alert level: cyan (normal),
                    yellow (caution), red (warning).
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Alert Volumes (Alerts Tab)</div>
                  <p className="smallMuted">
                    Configure caution (yellow) and warning (red) rings around your position.
                    Set the range in nautical miles and altitude ceiling in feet.
                    When aircraft enter these volumes, you'll receive audio beeps
                    and haptic vibration alerts.
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>FAA Airspace (Maps Tab)</div>
                  <p className="smallMuted">
                    Toggle FAA airspace classes (B/C/D/E), TFRs, restricted areas,
                    security zones, and LAANC grid overlays from the Maps tab. Data
                    is fetched live from FAA ArcGIS services. Tap any airspace zone,
                    obstruction, aircraft, or drone to see details on the Details tab.
                    Always check NOTAMs before flight.
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Remote ID (Remote ID Tab)</div>
                  <p className="smallMuted">
                    Detects nearby drones broadcasting Remote ID per ASTM F3586-22.
                    Supports all broadcast types: Bluetooth 5 (Long Range and Legacy),
                    WiFi Beacon, and WiFi NAN. The relay scans BLE directly when
                    Bluetooth hardware is available, and also accepts WiFi RID data
                    from external scanners via its HTTP ingest API.
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Maps & Offline</div>
                  <p className="smallMuted">
                    Choose between Apple satellite/hybrid maps or OpenTopoMap.
                    Switch to Topo and use "Download Current View" to cache tiles
                    for offline field use. Only Topo maps support offline caching.
                  </p>
                </div>

                <div className="kv">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Weather</div>
                  <p className="smallMuted">
                    View current conditions, wind speed and direction, visibility,
                    cloud cover, and a 12-hour hourly forecast. The next-hour
                    precipitation chart shows minute-by-minute rain probability.
                    Data from Apple WeatherKit.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── HUD Pills (bottom-center) ── */}
      <div
        className="hudPills"
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 30,
          display: "flex",
          gap: 8,
        }}
      >
        {/* Weather pill */}
        <div
          className="pill"
          onClick={() => { setPanelTab("weather"); setPanelOpen(true); }}
          style={{ whiteSpace: "nowrap" }}
        >
          {weatherLoading && !weather ? (
            <span style={{ opacity: 0.5 }}>Loading...</span>
          ) : weather ? (
            <>
              {weather.temperature_2m != null && (
                <span>{"\uD83C\uDF21"} {Math.round(weather.temperature_2m)} °F</span>
              )}
              {weather.wind_speed_10m != null && (
                <span> {"\u00B7"} {"\uD83C\uDF2C\uFE0F"} {Math.round(weather.wind_speed_10m)} mph{weather.wind_gusts_10m != null ? ` (g ${Math.round(weather.wind_gusts_10m)} mph)` : ""}</span>
              )}
              {weather.visibility != null && (
                <span> {"\u00B7"} {"\uD83D\uDC41"} {formatVisibility(weather.visibility)}</span>
              )}
            </>
          ) : (
            <span style={{ opacity: 0.5 }}>No weather</span>
          )}
        </div>

        {/* ADS-B pill */}
        {adsb.status !== "disconnected" && (
          <div
            className="pill"
            onClick={() => { setPanelTab("adsb"); setPanelOpen(true); }}
            style={{ whiteSpace: "nowrap" }}
          >
            <span style={{
              display: "inline-block",
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: adsb.status === "receiving" ? "#30d158" : "#ffd60a",
              marginRight: 6,
            }} />
            <span>{adsb.count} aircraft</span>
          </div>
        )}

        {/* Remote ID pill */}
        {(rid.status === "scanning" || rid.status === "receiving" || rid.count > 0) && (
          <div
            className="pill"
            onClick={() => { setPanelTab("remoteid"); setPanelOpen(true); }}
            style={{ whiteSpace: "nowrap" }}
          >
            <span style={{
              display: "inline-block",
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: rid.count > 0 ? "#30d158" : "#ffd60a",
              marginRight: 6,
            }} />
            <span>{rid.count} drone{rid.count !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
