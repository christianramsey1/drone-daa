// web/src/services/platformDetect.ts — OS detection for relay download links

export type DesktopOS = "mac" | "windows" | "linux" | "unknown";

export function detectDesktopOS(): DesktopOS {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).userAgentData?.platform?.toLowerCase()
    ?? navigator.platform?.toLowerCase() ?? "";

  if (platform.includes("mac") || ua.includes("macintosh")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("linux")) return "linux";
  return "unknown";
}

const GITHUB_REPO = "christianramsey1/drone-daa";

export function getRelayDownloadUrl(os: DesktopOS): string {
  const base = `https://github.com/${GITHUB_REPO}/releases/latest/download`;
  switch (os) {
    case "mac": return `${base}/DroneDAA-Relay.dmg`;
    case "windows": return `${base}/DroneDAA-Relay-Setup.exe`;
    default: return `https://github.com/${GITHUB_REPO}/releases/latest`;
  }
}

export function getOSLabel(os: DesktopOS): string {
  switch (os) {
    case "mac": return "macOS";
    case "windows": return "Windows";
    case "linux": return "Linux";
    default: return "your computer";
  }
}
