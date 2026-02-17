/**
 * StoreKit Capacitor Plugin
 *
 * TypeScript interface for the native StoreKit 2 Capacitor plugin.
 * This plugin handles in-app purchases on iOS.
 */

import { registerPlugin } from "@capacitor/core";
import type { Product, Transaction, PurchaseResult, RestoreResult } from "./types";

/**
 * StoreKit plugin interface
 */
export interface StoreKitPlugin {
  /**
   * Check if StoreKit is available on this device
   */
  isAvailable(): Promise<{ available: boolean }>;

  /**
   * Fetch products from App Store
   * @param productIds - Array of product IDs to fetch
   */
  getProducts(options: { productIds: string[] }): Promise<{ products: Product[] }>;

  /**
   * Purchase a product
   * @param productId - The product ID to purchase
   */
  purchase(options: { productId: string }): Promise<PurchaseResult>;

  /**
   * Restore previous purchases
   * Returns all current entitlements/transactions for the user
   */
  restorePurchases(): Promise<RestoreResult>;

  /**
   * Finish a transaction after verification
   * Call this after server successfully verifies and grants entitlement
   * @param transactionId - The transaction ID to finish
   */
  finishTransaction(options: { transactionId: string }): Promise<void>;

  /**
   * Get current entitlements (owned products)
   * Useful for checking current state without making a purchase
   */
  getCurrentEntitlements(): Promise<{ transactions: Transaction[] }>;
}

/**
 * StoreKit plugin instance
 *
 * On iOS native: bridges to Swift StoreKit 2 implementation
 * On web: returns a stub that always indicates unavailable
 */
export const StoreKit = registerPlugin<StoreKitPlugin>("StoreKit", {
  // Web fallback - StoreKit is iOS only
  web: () =>
    import("./StoreKitWeb").then((m) => new m.StoreKitWeb()),
});
