// web/src/mapIcons.ts — Shared icon factory functions for map annotations

export const ALERT_COLORS: Record<string, { fill: string; border: string }> = {
  normal:  { fill: "#00ff88", border: "#ffffff" },
  caution: { fill: "#ffee00", border: "#ffffff" },
  warning: { fill: "#ff2200", border: "#ffffff" },
};

export function createSeamarkIcon(color: string): HTMLCanvasElement {
  const size = 12;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const center = size / 2;
  const radius = 4;

  const colorLower = color.toLowerCase();
  const isLightColor = colorLower.includes("#e0e0e0") ||
                       colorLower.includes("#ffd60a") ||
                       colorLower.includes("white") ||
                       colorLower.includes("yellow");

  ctx.beginPath();
  ctx.arc(center, center, radius + 1.5, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  if (isLightColor) {
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  return canvas;
}

export function createStartWaypointIcon(color: string): HTMLCanvasElement {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const centerX = size / 2;
  const centerY = size / 2;
  const triangleSize = 9;

  ctx.beginPath();
  ctx.moveTo(centerX, centerY - triangleSize - 2.5);
  ctx.lineTo(centerX - triangleSize - 2, centerY + triangleSize + 2);
  ctx.lineTo(centerX + triangleSize + 2, centerY + triangleSize + 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX, centerY - triangleSize);
  ctx.lineTo(centerX - triangleSize, centerY + triangleSize);
  ctx.lineTo(centerX + triangleSize, centerY + triangleSize);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  return canvas;
}

export function createEndWaypointIcon(color: string): HTMLCanvasElement {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const centerX = size / 2;
  const centerY = size / 2;
  const radius = 9;
  const angle = Math.PI / 8;

  function drawOctagon(cx: number, cy: number, r: number) {
    if (!ctx) return;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const theta = angle + (i * Math.PI / 4);
      const x = cx + r * Math.cos(theta);
      const y = cy + r * Math.sin(theta);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  drawOctagon(centerX, centerY, radius + 2.5);
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fill();

  drawOctagon(centerX, centerY, radius);
  ctx.fillStyle = color;
  ctx.fill();

  return canvas;
}

export function createGpsPositionIcon(color: string): HTMLCanvasElement {
  const size = 20;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const centerX = size / 2;
  const centerY = size / 2;

  ctx.beginPath();
  ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerX - 1.5, centerY - 1.5, 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fill();

  return canvas;
}

export function createAircraftIcon(
  headingDeg: number,
  alertLevel: string = "normal",
  size: number = 32,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const cx = size / 2;
  const cy = size / 2;
  const rad = (headingDeg * Math.PI) / 180;
  const s = size / 32;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  const colors = ALERT_COLORS[alertLevel] ?? ALERT_COLORS.normal;

  // Strong glow for visibility against any map background
  ctx.shadowColor = colors.fill;
  ctx.shadowBlur = 12 * s;

  // Outer shape (white border for maximum contrast)
  ctx.beginPath();
  ctx.moveTo(0, -13 * s);
  ctx.lineTo(-10 * s, 9 * s);
  ctx.lineTo(0, 5 * s);
  ctx.lineTo(10 * s, 9 * s);
  ctx.closePath();
  ctx.fillStyle = colors.border;
  ctx.fill();

  // Second glow pass for extra pop
  ctx.shadowColor = colors.fill;
  ctx.shadowBlur = 8 * s;

  // Inner fill
  ctx.beginPath();
  ctx.moveTo(0, -10 * s);
  ctx.lineTo(-7 * s, 7 * s);
  ctx.lineTo(0, 3 * s);
  ctx.lineTo(7 * s, 7 * s);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();

  ctx.shadowBlur = 0;

  // Hard white outline for contrast against dark and light backgrounds
  ctx.beginPath();
  ctx.moveTo(0, -13 * s);
  ctx.lineTo(-10 * s, 9 * s);
  ctx.lineTo(0, 5 * s);
  ctx.lineTo(10 * s, 9 * s);
  ctx.closePath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();

  ctx.restore();
  return canvas;
}

export function createDroneIcon(
  headingDeg: number,
  alertLevel: string = "normal",
  size: number = 28,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const cx = size / 2;
  const cy = size / 2;
  const rad = (headingDeg * Math.PI) / 180;
  const s = size / 28;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  const colors = ALERT_COLORS[alertLevel] ?? ALERT_COLORS.normal;

  // Strong glow
  ctx.shadowColor = colors.fill;
  ctx.shadowBlur = 10 * s;

  // Body X-shape (arms) — white border for contrast
  ctx.lineWidth = 3.5 * s;
  ctx.strokeStyle = colors.border;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8 * s, -8 * s);
  ctx.lineTo(8 * s, 8 * s);
  ctx.moveTo(8 * s, -8 * s);
  ctx.lineTo(-8 * s, 8 * s);
  ctx.stroke();

  // Arms in fill color
  ctx.shadowBlur = 6 * s;
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = colors.fill;
  ctx.beginPath();
  ctx.moveTo(-8 * s, -8 * s);
  ctx.lineTo(8 * s, 8 * s);
  ctx.moveTo(8 * s, -8 * s);
  ctx.lineTo(-8 * s, 8 * s);
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Center body circle
  ctx.beginPath();
  ctx.arc(0, 0, 3 * s, 0, Math.PI * 2);
  ctx.fillStyle = colors.border;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 2 * s, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();

  // 4 rotor circles at arm tips
  const rotorPositions = [
    [-8, -8], [8, -8], [-8, 8], [8, 8],
  ];
  for (const [rx, ry] of rotorPositions) {
    ctx.beginPath();
    ctx.arc(rx * s, ry * s, 3.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = colors.border;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx * s, ry * s, 2.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
  }

  // Direction indicator (small triangle at top)
  ctx.beginPath();
  ctx.moveTo(0, -11 * s);
  ctx.lineTo(-2 * s, -8 * s);
  ctx.lineTo(2 * s, -8 * s);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();

  ctx.restore();
  return canvas;
}

export function createOperatorIcon(size: number = 16): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const cx = size / 2;
  const cy = size / 2;

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fill();

  // Inner dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffa500";
  ctx.fill();

  // Person silhouette (simple)
  ctx.beginPath();
  ctx.arc(cx, cy - 1, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy + 3);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + 2, cy + 3);
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fill();

  return canvas;
}

let _breadcrumbDotUrl: string | null = null;
export function getBreadcrumbDotUrl(): string {
  if (!_breadcrumbDotUrl) {
    const size = 6;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(3, 3, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 179, 0, 0.5)";
      ctx.fill();
    }
    _breadcrumbDotUrl = c.toDataURL();
  }
  return _breadcrumbDotUrl;
}

export function createAircraftElement(
  headingDeg: number,
  alertLevel: string,
  iconSize: number,
  dataTagLines: string[],
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    `width:${iconSize}px;height:${iconSize}px;position:relative;overflow:visible;`;

  const canvas = createAircraftIcon(headingDeg, alertLevel, iconSize);
  canvas.style.cssText = `display:block;width:${iconSize}px;height:${iconSize}px;`;
  wrapper.appendChild(canvas);

  if (dataTagLines.length > 0) {
    const tag = document.createElement("div");
    tag.style.cssText =
      `position:absolute;left:${iconSize + 4}px;top:0;` +
      "font-family:system-ui,-apple-system,sans-serif;font-size:10px;line-height:1.3;" +
      "color:#ffffff;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,1);" +
      "white-space:nowrap;pointer-events:none;" +
      "background:rgba(0,0,0,0.75);padding:2px 5px;border-radius:3px;" +
      "border:1px solid rgba(255,255,255,0.3);";
    for (const line of dataTagLines) {
      const div = document.createElement("div");
      div.textContent = line;
      tag.appendChild(div);
    }
    wrapper.appendChild(tag);
  }

  return wrapper;
}
