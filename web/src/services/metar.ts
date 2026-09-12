// web/src/services/metar.ts — METAR types + plain-English decoding
//
// Data comes from /api/aviation/metar (NOAA aviationweather.gov proxy).
// Aviation units are preserved as reported (knots, statute miles, °C, inHg);
// conversions happen only in the decoded text, where plain English is the point.

export type MetarCloud = {
  /** SKC/CLR/FEW/SCT/BKN/OVC/OVX */
  cover: string;
  /** Cloud base in feet AGL */
  baseFt: number | null;
};

export type MetarStation = {
  icaoId: string;
  name: string;
  lat: number;
  lon: number;
  elevM: number | null;
  /** Distance from the requested position, nautical miles */
  distanceNm: number | null;
  /** Observation time, ms epoch */
  obsTime: number | null;
  reportTime: string | null;
  tempC: number | null;
  dewpC: number | null;
  /** Degrees true, or "VRB" when variable */
  windDirDeg: number | string | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibilitySm: number | null;
  /** Raw visibility as reported — preserves values like "10+" */
  visibilityRaw: number | string | null;
  altimeterInHg: number | null;
  clouds: MetarCloud[];
  /** Present-weather group, e.g. "-RA BR" */
  wxString: string | null;
  /** VFR / MVFR / IFR / LIFR */
  flightCategory: string | null;
  rawOb: string | null;
};

export type MetarResponse = {
  ok: boolean;
  source?: string;
  fetchedAtUtc?: string;
  stations?: MetarStation[];
  error?: string;
};

export type TafPeriod = {
  /** ms epoch */
  timeFrom: number | null;
  timeTo: number | null;
  /** null for the opening period, else FM / TEMPO / BECMG / PROB */
  changeType: string | null;
  probability: number | null;
  windDirDeg: number | string | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  windShearHeightFt: number | null;
  windShearDirDeg: number | null;
  windShearSpeedKt: number | null;
  visibilitySm: number | null;
  visibilityRaw: number | string | null;
  vertVisFt: number | null;
  wxString: string | null;
  clouds: MetarCloud[];
};

export type Taf = {
  icaoId: string;
  name: string | null;
  issueTime: string | null;
  validFrom: number | null;
  validTo: number | null;
  rawTaf: string | null;
  periods: TafPeriod[];
};

export type TafResponse = {
  ok: boolean;
  source?: string;
  fetchedAtUtc?: string;
  taf?: Taf | null;
  error?: string;
};

// ── Formatting helpers ────────────────────────────────────────────────

const COMPASS = [
  "north", "north-northeast", "northeast", "east-northeast",
  "east", "east-southeast", "southeast", "south-southeast",
  "south", "south-southwest", "southwest", "west-southwest",
  "west", "west-northwest", "northwest", "north-northwest",
];

export function compassPoint(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function ktToMph(kt: number): number {
  return Math.round(kt * 1.15078);
}

export function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

/** Lowest broken/overcast layer — the ceiling, in feet AGL. */
export function ceilingFt(clouds: MetarCloud[]): number | null {
  const ceilings = clouds
    .filter((c) => (c.cover === "BKN" || c.cover === "OVC" || c.cover === "OVX") && c.baseFt != null)
    .map((c) => c.baseFt as number);
  return ceilings.length ? Math.min(...ceilings) : null;
}

export function flightCategoryColor(cat: string | null): string {
  switch (cat) {
    case "VFR": return "#30d158";
    case "MVFR": return "#0a84ff";
    case "IFR": return "#ff453a";
    case "LIFR": return "#ff2d95";
    default: return "rgba(255,255,255,0.5)";
  }
}

export function flightCategoryLabel(cat: string | null): string {
  switch (cat) {
    case "VFR": return "VFR — visual conditions";
    case "MVFR": return "Marginal VFR — reduced ceiling or visibility";
    case "IFR": return "IFR — instrument conditions";
    case "LIFR": return "Low IFR — very low ceiling or visibility";
    default: return "Flight category unavailable";
  }
}

const COVER_WORDS: Record<string, string> = {
  SKC: "clear", CLR: "clear", CAVOK: "clear", NSC: "no significant cloud",
  FEW: "a few clouds", SCT: "scattered clouds", BKN: "broken clouds",
  OVC: "overcast", OVX: "sky obscured",
};

// METAR present-weather groups, decoded piecewise:
// [intensity][descriptor][phenomena], e.g. "-TSRA" = light thunderstorm with rain
const WX_INTENSITY: Record<string, string> = { "-": "light ", "+": "heavy ", VC: "nearby " };
const WX_DESCRIPTOR: Record<string, string> = {
  MI: "shallow ", PR: "partial ", BC: "patchy ", DR: "low drifting ",
  BL: "blowing ", SH: "showers of ", TS: "thunderstorm with ", FZ: "freezing ",
};

// A descriptor can stand alone (e.g. "VCSH" = showers in the vicinity, with
// no precipitation type given) — the connecting words would dangle.
const WX_DESCRIPTOR_ALONE: Record<string, string> = {
  MI: "shallow", PR: "partial", BC: "patchy", DR: "low drifting",
  BL: "blowing", SH: "showers", TS: "thunderstorm", FZ: "freezing",
};
const WX_PHENOMENA: Record<string, string> = {
  DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals",
  PL: "ice pellets", GR: "hail", GS: "small hail", UP: "unknown precipitation",
  BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "dust",
  SA: "sand", HZ: "haze", PY: "spray", PO: "dust whirls", SQ: "squalls",
  FC: "funnel cloud", SS: "sandstorm", DS: "duststorm",
};

/** Decode one present-weather group (e.g. "-TSRA") into plain English. */
export function decodeWxGroup(group: string): string {
  let rest = group;
  let out = "";

  if (rest.startsWith("VC")) { out += WX_INTENSITY.VC; rest = rest.slice(2); }
  else if (rest.startsWith("-") || rest.startsWith("+")) {
    out += WX_INTENSITY[rest[0]];
    rest = rest.slice(1);
  }

  let descriptor: string | null = null;
  const desc = rest.slice(0, 2);
  if (WX_DESCRIPTOR[desc]) { descriptor = desc; rest = rest.slice(2); }

  const words: string[] = [];
  while (rest.length >= 2) {
    const code = rest.slice(0, 2);
    words.push(WX_PHENOMENA[code] ?? code.toLowerCase());
    rest = rest.slice(2);
  }

  if (descriptor) {
    out += words.length
      ? WX_DESCRIPTOR[descriptor]
      : WX_DESCRIPTOR_ALONE[descriptor];
  }

  return (out + words.join(" and ")).trim();
}

export function decodeWxString(wx: string | null): string | null {
  if (!wx) return null;
  const decoded = wx.trim().split(/\s+/).map(decodeWxGroup).filter(Boolean);
  return decoded.length ? decoded.join(", ") : null;
}

/** Wind fields shared by an observation and a forecast period. */
type WindLike = {
  windDirDeg: number | string | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
};

/** Visibility fields shared by an observation and a forecast period. */
type VisibilityLike = {
  visibilitySm: number | null;
  visibilityRaw: number | string | null;
};

export function describeWind(m: WindLike): string {
  const spd = m.windSpeedKt;
  if (spd == null) return "Wind not reported.";
  if (spd === 0) return "Wind calm.";

  const gust = m.windGustKt != null
    ? `, gusting to ${m.windGustKt} kt (${ktToMph(m.windGustKt)} mph)`
    : "";
  const speed = `${spd} kt (${ktToMph(spd)} mph)`;

  if (m.windDirDeg == null || m.windDirDeg === "VRB") {
    return `Wind variable in direction at ${speed}${gust}.`;
  }
  const deg = Number(m.windDirDeg);
  if (!Number.isFinite(deg)) return `Wind at ${speed}${gust}.`;
  return `Wind from the ${compassPoint(deg)} (${Math.round(deg)}°) at ${speed}${gust}.`;
}

export function describeClouds(clouds: MetarCloud[]): string {
  if (!clouds.length) return "No cloud layers reported.";
  const parts = clouds.map((c) => {
    const word = COVER_WORDS[c.cover] ?? c.cover;
    return c.baseFt != null ? `${word} at ${c.baseFt.toLocaleString()} ft` : word;
  });
  const ceil = ceilingFt(clouds);
  const ceilText = ceil != null ? ` Ceiling ${ceil.toLocaleString()} ft.` : "";
  return `Sky: ${parts.join(", ")}.${ceilText}`;
}

export function describeVisibility(m: VisibilityLike): string {
  if (m.visibilityRaw == null) return "Visibility not reported.";
  const raw = String(m.visibilityRaw);
  if (raw.includes("+")) {
    return `Visibility ${raw.replace("+", "")} statute miles or more.`;
  }
  const v = m.visibilitySm;
  if (v == null) return `Visibility ${raw} statute miles.`;
  return `Visibility ${v} statute mile${v === 1 ? "" : "s"}.`;
}

export function describeObsAge(obsTime: number | null, now = Date.now()): string {
  if (obsTime == null) return "Observation time unknown.";
  const mins = Math.max(0, Math.round((now - obsTime) / 60000));
  if (mins < 1) return "Observed just now.";
  if (mins === 1) return "Observed 1 minute ago.";
  if (mins < 90) return `Observed ${mins} minutes ago.`;
  const hrs = Math.round(mins / 60);
  return `Observed about ${hrs} hour${hrs === 1 ? "" : "s"} ago.`;
}

/**
 * Full plain-English translation of a METAR, one sentence group per line.
 * Deliberately spells out the aviation shorthand — this sits next to the
 * raw observation so a pilot can learn to read it.
 */
export function decodeMetar(m: MetarStation, now = Date.now()): string[] {
  const lines: string[] = [];

  const where = m.distanceNm != null
    ? `${m.name || m.icaoId} (${m.icaoId}), ${m.distanceNm} nm away.`
    : `${m.name || m.icaoId} (${m.icaoId}).`;
  lines.push(where);
  lines.push(describeObsAge(m.obsTime, now));

  if (m.flightCategory) lines.push(`${flightCategoryLabel(m.flightCategory)}.`);

  lines.push(describeWind(m));
  lines.push(describeVisibility(m));

  const wx = decodeWxString(m.wxString);
  if (wx) lines.push(`Present weather: ${wx}.`);

  lines.push(describeClouds(m.clouds));

  if (m.tempC != null) {
    const dew = m.dewpC != null
      ? `, dew point ${Math.round(m.dewpC)}°C (${cToF(m.dewpC)}°F)`
      : "";
    lines.push(`Temperature ${Math.round(m.tempC)}°C (${cToF(m.tempC)}°F)${dew}.`);
  }

  if (m.altimeterInHg != null) {
    lines.push(`Altimeter ${m.altimeterInHg.toFixed(2)} inHg.`);
  }

  return lines;
}

// ── TAF (forecast) decoding ───────────────────────────────────────────

function clockTime(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleTimeString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Heading for one forecast period, spelling out the TAF change-group
 * shorthand: FM (from), TEMPO (temporary), BECMG (becoming), PROB (chance).
 */
export function describeTafPeriodHeader(p: TafPeriod, isFirst: boolean): string {
  const from = clockTime(p.timeFrom);
  const to = clockTime(p.timeTo);

  switch (p.changeType) {
    case "TEMPO":
      return `Temporarily, ${from} to ${to}`;
    case "BECMG":
      return `Gradually becoming, ${from} to ${to}`;
    case "PROB":
      return `${p.probability ?? 30}% chance, ${from} to ${to}`;
    case "FM":
      return `From ${from}`;
    default:
      return isFirst ? `Initially, from ${from}` : `From ${from}`;
  }
}

/** Conditions for one forecast period, as plain-English sentences. */
export function describeTafPeriod(p: TafPeriod): string[] {
  const lines: string[] = [];

  if (p.windSpeedKt != null) lines.push(describeWind(p));
  if (p.visibilityRaw != null) lines.push(describeVisibility(p));

  const wx = decodeWxString(p.wxString);
  if (wx) lines.push(`Expect ${wx}.`);

  if (p.clouds.length) lines.push(describeClouds(p.clouds));
  else if (p.vertVisFt != null) {
    lines.push(`Sky obscured, vertical visibility ${p.vertVisFt.toLocaleString()} ft.`);
  }

  if (p.windShearHeightFt != null && p.windShearSpeedKt != null) {
    const dir = p.windShearDirDeg != null ? `${compassPoint(p.windShearDirDeg)} ` : "";
    lines.push(
      `Low-level wind shear at ${p.windShearHeightFt.toLocaleString()} ft: ` +
      `${dir}${p.windShearSpeedKt} kt.`,
    );
  }

  return lines;
}

export type DecodedTafPeriod = {
  header: string;
  lines: string[];
  /** True while this period covers the current time. */
  active: boolean;
};

/** Full plain-English translation of a TAF, one entry per forecast period. */
export function decodeTaf(taf: Taf, now = Date.now()): DecodedTafPeriod[] {
  return taf.periods.map((p, i) => ({
    header: describeTafPeriodHeader(p, i === 0),
    lines: describeTafPeriod(p),
    active:
      p.timeFrom != null && p.timeTo != null &&
      now >= p.timeFrom && now < p.timeTo,
  }));
}
