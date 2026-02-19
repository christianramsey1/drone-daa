// web/src/nav.ts
// Pure functions: no React, no browser APIs.

export type LatLon = { lat: number; lon: number };

// Convert degrees <-> radians
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Great-circle distance using haversine formula.
// Returns nautical miles by default (common in navigation).
export function distanceNm(a: LatLon, b: LatLon): number {
  const Rm = 6371000; // Earth radius (meters)
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δφ = toRad(b.lat - a.lat);
  const Δλ = toRad(b.lon - a.lon);

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);

  const h =
    sinΔφ * sinΔφ +
    Math.cos(φ1) * Math.cos(φ2) * (sinΔλ * sinΔλ);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  const meters = Rm * c;

  const metersPerNm = 1852;
  return meters / metersPerNm;
}

// Initial bearing from point a to b.
// Returns degrees true, normalized to [0, 360).
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const λ1 = toRad(a.lon);
  const λ2 = toRad(b.lon);

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);

  const θ = Math.atan2(y, x);
  const deg = (toDeg(θ) + 360) % 360;
  return deg;
}

// --- Angle helpers ---------------------------------------------------------

export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// returns signed delta in [-180, +180]
export function signedDeltaDeg(fromDeg: number, toDeg: number): number {
  const a = wrap360(toDeg) - wrap360(fromDeg);
  return ((a + 540) % 360) - 180;
}

// --- Speed/time helpers ----------------------------------------------------

export function knotsToNmPerMin(kts: number): number {
  return kts / 60;
}

export function etaMinutes(distanceNmVal: number, speedKts: number | null | undefined): number | null {
  if (!speedKts || !Number.isFinite(speedKts) || speedKts <= 0) return null;
  return distanceNmVal / knotsToNmPerMin(speedKts);
}

// --- Projection helpers -------------------------------------------------------

// Great-circle destination point from origin, bearing, speed, and time.
export function destinationPoint(
  from: LatLon,
  bearingDeg: number,
  speedKts: number,
  seconds: number,
): LatLon {
  const distNm = (speedKts / 3600) * seconds;
  const distRad = (distNm * 1852) / 6371000;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distRad) +
    Math.cos(lat1) * Math.sin(distRad) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distRad) * Math.cos(lat1),
      Math.cos(distRad) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}
