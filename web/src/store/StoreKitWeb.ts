/**
 * StoreKit Web Fallback
 *
 * Provides a graceful fallback for non-iOS platforms.
 * StoreKit is only available on iOS, so this stub returns appropriate errors.
 */

import { WebPlugin } from "@capacitor/core";
import type { StoreKitPlugin } from "./StoreKitPlugin";
import type { Product, PurchaseResult, RestoreResult, Transaction } from "./types";

export class StoreKitWeb extends WebPlugin implements StoreKitPlugin {
  async isAvailable(): Promise<{ available: boolean }> {
    // StoreKit is not available on web
    return { available: false };
  }

  async getProducts(_options: { productIds: string[] }): Promise<{ products: Product[] }> {
    // Return empty products list on web
    console.log("[StoreKit] getProducts called on web - not available");
    return { products: [] };
  }

  async purchase(_options: { productId: string }): Promise<PurchaseResult> {
    // Purchases not available on web
    console.log("[StoreKit] purchase called on web - not available");
    return {
      status: "error",
      message: "In-app purchases are only available in the iOS app",
    };
  }

  async restorePurchases(): Promise<RestoreResult> {
    // Restore not available on web
    console.log("[StoreKit] restorePurchases called on web - not available");
    return {
      transactions: [],
      error: "Restore purchases is only available in the iOS app",
    };
  }

  async finishTransaction(_options: { transactionId: string }): Promise<void> {
    // No-op on web
    console.log("[StoreKit] finishTransaction called on web - no-op");
  }

  async getCurrentEntitlements(): Promise<{ transactions: Transaction[] }> {
    // No entitlements on web
    console.log("[StoreKit] getCurrentEntitlements called on web - not available");
    return { transactions: [] };
  }
}
