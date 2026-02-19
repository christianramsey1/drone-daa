/**
 * Platform Detection
 *
 * Utilities to detect if running in Capacitor (native iOS) or web browser.
 */

import { Capacitor } from "@capacitor/core";

/**
 * Check if running inside Capacitor native app
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Check if running on iOS (native or web)
 */
export function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

/**
 * Check if running on web
 */
export function isWeb(): boolean {
  return Capacitor.getPlatform() === "web";
}

/**
 * Get current platform name
 */
export function getPlatform(): "ios" | "android" | "web" {
  return Capacitor.getPlatform() as "ios" | "android" | "web";
}

/**
 * Check if a specific plugin is available
 */
export function isPluginAvailable(pluginName: string): boolean {
  return Capacitor.isPluginAvailable(pluginName);
}

/**
 * Get the API base URL
 * - Native: use production URL
 * - Web: use relative path (handled by proxy in dev, same origin in prod)
 */
export function getApiBaseUrl(): string {
  if (isNative()) {
    // Native apps need absolute URL to the API
    return "https://detectandavoid.com";
  }
  // Web uses relative paths
  return "";
}
