// web/src/App.tsx — DroneDAA
import "./App.css";
import { useEffect, useMemo, useState } from "react";
import MapKitMap, { type Annotation, type Polyline } from "./MapKitMap";
import { getApiBaseUrl } from "./platform";
import { DEFAULT_ZONE } from "./zones";

// ── Types ──────────────────────────────────────────────────────────────

type PanelTab = "airspace" | "weather" | "flights" | "settings";

type WeatherData = {
  temperature_2m?: number;
  wind_speed_10m?: number;
  wind_gusts_10m?: number;
  wind_direction_10m?: number;
  visibility?: number;
  cloud_cover?: number;
  is_day?: number;
};

type GpsPos = {
  lat: number;
  lon: number;
  accuracyM?: number;
};

// ── Helpers ────────────────────────────────────────────────────────────

function windArrow(deg: number | undefined): string {
  if (deg == null) return "";
  const arrows = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return arrows[Math.round(deg / 45) % 8] ?? "";
}

function formatVisibility(v: number | undefined): string {
  if (v == null) return "—";
  return `${(v / 1609.34).toFixed(1)} mi`;
}

// ── Component ──────────────────────────────────────────────────────────

export default function App() {
  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("airspace");

  // Map state
  const [mapCenter] = useState(DEFAULT_ZONE.center);

  // GPS
  const [gps, setGps] = useState<GpsPos | null>(null);

  // Weather
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // ── GPS tracking ──────────────────────────────────────────────────

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      () => { /* GPS not available */ },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
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
        if (data?.current) setWeather(data.current);
      })
      .catch(() => { /* weather unavailable */ })
      .finally(() => { if (!cancelled) setWeatherLoading(false); });

    return () => { cancelled = true; };
  }, [gps?.lat?.toFixed(2), gps?.lon?.toFixed(2), mapCenter.lat, mapCenter.lon]);

  // ── Annotations (placeholder — future drone/aircraft markers) ────

  const mapAnnotations: Annotation[] = useMemo(() => {
    return [];
  }, []);

  const mapPolylines: Polyline[] = useMemo(() => {
    return [];
  }, []);

  // ── Render ────────────────────────────────────────────────────────

  const windStr = weather?.wind_speed_10m != null
    ? `${Math.round(weather.wind_speed_10m)} mph ${windArrow(weather.wind_direction_10m)}`
    : null;

  const gustStr = weather?.wind_gusts_10m != null && weather.wind_gusts_10m > (weather?.wind_speed_10m ?? 0) + 3
    ? `G${Math.round(weather.wind_gusts_10m)}`
    : null;

  return (
    <div className="app-root">
      {/* ── Map ── */}
      <MapKitMap
        variant="full"
        center={mapCenter}
        annotations={mapAnnotations}
        polylines={mapPolylines}
      />

      {/* ── Weather Pill (top-right) ── */}
      <div
        className="weather-pill"
        onClick={() => { setPanelTab("weather"); setPanelOpen(true); }}
      >
        {weatherLoading ? (
          <span style={{ opacity: 0.5 }}>Loading...</span>
        ) : weather ? (
          <>
            {weather.temperature_2m != null && (
              <span>{Math.round(weather.temperature_2m)}°F</span>
            )}
            {windStr && (
              <span style={{ marginLeft: 8 }}>{windStr}{gustStr ? ` ${gustStr}` : ""}</span>
            )}
            {weather.visibility != null && (
              <span style={{ marginLeft: 8 }}>Vis {formatVisibility(weather.visibility)}</span>
            )}
          </>
        ) : (
          <span style={{ opacity: 0.5 }}>No weather</span>
        )}
      </div>

      {/* ── Panel Toggle ── */}
      <button
        className="panel-toggle"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label={panelOpen ? "Close panel" : "Open panel"}
      >
        {panelOpen ? "\u2715" : "\u2630"}
      </button>

      {/* ── Side Panel ── */}
      {panelOpen && (
        <div className="side-panel">
          {/* Tab bar */}
          <div className="panel-tabs">
            {(["airspace", "weather", "flights", "settings"] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                className={`panel-tab ${panelTab === tab ? "active" : ""}`}
                onClick={() => setPanelTab(tab)}
              >
                {tab === "airspace" && "Airspace"}
                {tab === "weather" && "Weather"}
                {tab === "flights" && "Flights"}
                {tab === "settings" && "Settings"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="panel-content">
            {panelTab === "airspace" && (
              <div>
                <h3 style={{ marginBottom: 12 }}>Airspace</h3>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
                  FAA airspace classes, TFRs, and restricted areas will appear here.
                </p>
              </div>
            )}

            {panelTab === "weather" && (
              <div>
                <h3 style={{ marginBottom: 12 }}>Weather</h3>
                {weather ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div className="weather-card">
                      <div className="weather-label">Temperature</div>
                      <div className="weather-value">
                        {weather.temperature_2m != null ? `${Math.round(weather.temperature_2m)}°F` : "—"}
                      </div>
                    </div>
                    <div className="weather-card">
                      <div className="weather-label">Wind</div>
                      <div className="weather-value">{windStr ?? "—"}</div>
                    </div>
                    <div className="weather-card">
                      <div className="weather-label">Gusts</div>
                      <div className="weather-value">
                        {weather.wind_gusts_10m != null ? `${Math.round(weather.wind_gusts_10m)} mph` : "—"}
                      </div>
                    </div>
                    <div className="weather-card">
                      <div className="weather-label">Visibility</div>
                      <div className="weather-value">{formatVisibility(weather.visibility)}</div>
                    </div>
                    <div className="weather-card">
                      <div className="weather-label">Cloud Cover</div>
                      <div className="weather-value">
                        {weather.cloud_cover != null ? `${weather.cloud_cover}%` : "—"}
                      </div>
                    </div>
                    <div className="weather-card">
                      <div className="weather-label">Wind Dir</div>
                      <div className="weather-value">
                        {weather.wind_direction_10m != null ? `${weather.wind_direction_10m}° ${windArrow(weather.wind_direction_10m)}` : "—"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
                    {weatherLoading ? "Loading weather..." : "Weather data unavailable."}
                  </p>
                )}
              </div>
            )}

            {panelTab === "flights" && (
              <div>
                <h3 style={{ marginBottom: 12 }}>Live Flights</h3>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
                  Live drone (Remote ID) and aircraft (ADS-B) tracks will appear here.
                </p>
              </div>
            )}

            {panelTab === "settings" && (
              <div>
                <h3 style={{ marginBottom: 12 }}>Settings</h3>
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
                  DAA alert thresholds, map layers, and account settings.
                </p>
                <div style={{ marginTop: 24 }}>
                  <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255, 255, 255, 0.35)" }}>
                    <a href="/privacy" style={{ color: "rgba(255, 255, 255, 0.45)", textDecoration: "none" }}>
                      Privacy Policy
                    </a>
                    {" · "}
                    <a href="/support" style={{ color: "rgba(255, 255, 255, 0.45)", textDecoration: "none" }}>
                      Support
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
