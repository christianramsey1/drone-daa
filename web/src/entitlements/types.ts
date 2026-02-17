/**
 * Entitlement Types
 *
 * Central definitions for the entitlement/access control system.
 */

export type EntitlementSource = "appstore" | "stripe" | "admin";

export type Entitlement = {
  key: string; // e.g., "premium", "pro"
  expiresAt: string | null; // ISO timestamp, null = perpetual
  source: EntitlementSource;
};

export type User = {
  id: string;
  appleSub: string;
  email?: string;
  displayName?: string;
};

export type AuthState = {
  user: User | null;
  sessionToken: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * Product ID naming convention:
 * - Feature: com.dronedaa.pass.<feature>.1y
 * - Pro: com.dronedaa.pass.pro.1y
 */
export function skuToEntitlementKey(productId: string): string | null {
  const featureMatch = productId.match(/^com\.dronedaa\.pass\.(\w+)\.1y$/);
  if (featureMatch) return featureMatch[1];

  return null;
}

/**
 * Convert entitlement key to product ID
 */
export function entitlementKeyToSku(key: string): string | null {
  if (/^\w+$/.test(key)) return `com.dronedaa.pass.${key}.1y`;
  return null;
}
