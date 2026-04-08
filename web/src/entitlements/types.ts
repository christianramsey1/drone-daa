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
 * - Feature: com.dronedaa.<feature>.<period>
 * - Pro: com.dronedaa.pro.1yr
 */
export function skuToEntitlementKey(productId: string): string | null {
  // com.dronedaa.pro.1yr → "pro"
  const match = productId.match(/^com\.dronedaa\.(\w+)\.\w+$/);
  if (match) return match[1];

  return null;
}

/**
 * Convert entitlement key to product ID
 */
export function entitlementKeyToSku(key: string): string | null {
  if (key === "pro") return "com.dronedaa.pro.1yr";
  return null;
}
