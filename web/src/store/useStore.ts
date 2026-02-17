/**
 * useStore Hook
 *
 * Provides in-app purchase functionality.
 * Handles purchase flow, restore, and backend verification.
 */

import { useState, useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { StoreKit } from "./StoreKitPlugin";
import { useAuth } from "../auth";
import { useEntitlements } from "../entitlements";
import { entitlementKeyToSku } from "../entitlements/types";
import { getApiBaseUrl } from "../platform";
import type { Product, Transaction, StoreStatus } from "./types";

type UseStoreReturn = {
  /** Whether StoreKit is available (iOS native only) */
  isAvailable: boolean;
  /** Current status of the store */
  status: StoreStatus;
  /** Products loaded from App Store */
  products: Product[];
  /** Error message if any */
  error: string | null;

  /**
   * Purchase a feature pass
   * @param featureKey - The entitlement key (e.g., "pro")
   * @returns true if purchase succeeded and entitlement was granted
   */
  purchasePass: (featureKey: string) => Promise<boolean>;

  /**
   * Restore previous purchases
   * Sends all restored transactions to backend for verification
   * @returns true if any entitlements were restored
   */
  restorePurchases: () => Promise<boolean>;

  /**
   * Get the product for a specific feature
   */
  getProduct: (featureKey: string) => Product | null;

  /** Whether a purchase is in progress */
  purchasing: boolean;

  /** Whether restore is in progress */
  restoring: boolean;
};

export function useStore(): UseStoreReturn {
  const { sessionToken, isAuthenticated } = useAuth();
  const { refresh: refreshEntitlements } = useEntitlements();

  const [isAvailable, setIsAvailable] = useState(false);
  const [status, setStatus] = useState<StoreStatus>("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Initialize store on mount
  useEffect(() => {
    initializeStore();
  }, []);

  const initializeStore = useCallback(async () => {
    // Only available on native iOS
    if (!Capacitor.isNativePlatform()) {
      setIsAvailable(false);
      setStatus("unavailable");
      return;
    }

    try {
      const { available } = await StoreKit.isAvailable();
      setIsAvailable(available);

      if (!available) {
        setStatus("unavailable");
        return;
      }

      // Load products — add product IDs here as you add paid features
      const productIds = [
        "com.dronedaa.pass.pro.1y",
      ];

      const { products: loadedProducts } = await StoreKit.getProducts({
        productIds,
      });
      setProducts(loadedProducts);
      setStatus("ready");
      console.log("[Store] Initialized with", loadedProducts.length, "products");
    } catch (err) {
      console.error("[Store] Failed to initialize:", err);
      setStatus("unavailable");
      setError(err instanceof Error ? err.message : "Failed to initialize store");
    }
  }, []);

  const getProduct = useCallback(
    (featureKey: string): Product | null => {
      const sku = entitlementKeyToSku(featureKey);
      if (!sku) return null;
      return products.find((p) => p.id === sku) ?? null;
    },
    [products]
  );

  /**
   * Verify a transaction with the backend and grant entitlement
   */
  const verifyTransaction = useCallback(
    async (transaction: Transaction): Promise<boolean> => {
      if (!sessionToken) {
        console.error("[Store] Cannot verify transaction: not authenticated");
        return false;
      }

      const apiBase = getApiBaseUrl();

      try {
        const response = await fetch(`${apiBase}/api/purchases/ios/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            productId: transaction.productId,
            transactionId: transaction.id,
            originalTransactionId: transaction.originalId,
            signedTransaction: transaction.signedTransaction,
            environment: transaction.environment,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          console.error("[Store] Backend verification failed:", data.error);
          return false;
        }

        // Mark transaction as finished in StoreKit
        await StoreKit.finishTransaction({ transactionId: transaction.id });

        console.log("[Store] Transaction verified and finished:", transaction.id);
        return true;
      } catch (err) {
        console.error("[Store] Verification error:", err);
        return false;
      }
    },
    [sessionToken]
  );

  const purchasePass = useCallback(
    async (featureKey: string): Promise<boolean> => {
      if (!isAuthenticated) {
        setError("Please sign in to make purchases");
        return false;
      }

      if (!isAvailable) {
        setError("In-app purchases are only available in the iOS app");
        return false;
      }

      const sku = entitlementKeyToSku(featureKey);
      if (!sku) {
        setError(`Unknown feature: ${featureKey}`);
        return false;
      }

      setPurchasing(true);
      setError(null);

      try {
        console.log("[Store] Starting purchase for:", sku);
        const result = await StoreKit.purchase({ productId: sku });

        switch (result.status) {
          case "success": {
            console.log("[Store] Purchase successful, verifying with backend...");
            const verified = await verifyTransaction(result.transaction);

            if (verified) {
              // Refresh entitlements to reflect the new purchase
              await refreshEntitlements();
              console.log("[Store] Purchase complete, entitlements refreshed");
              return true;
            } else {
              setError("Purchase succeeded but verification failed. Please try restoring purchases.");
              return false;
            }
          }

          case "cancelled":
            console.log("[Store] Purchase cancelled by user");
            return false;

          case "pending":
            setError("Purchase pending approval. It will unlock once approved.");
            return false;

          case "error":
            setError(result.message);
            return false;

          default:
            setError("Unknown purchase result");
            return false;
        }
      } catch (err) {
        console.error("[Store] Purchase error:", err);
        setError(err instanceof Error ? err.message : "Purchase failed");
        return false;
      } finally {
        setPurchasing(false);
      }
    },
    [isAuthenticated, isAvailable, verifyTransaction, refreshEntitlements]
  );

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) {
      setError("Please sign in to restore purchases");
      return false;
    }

    if (!isAvailable) {
      setError("Restore purchases is only available in the iOS app");
      return false;
    }

    setRestoring(true);
    setError(null);

    try {
      console.log("[Store] Restoring purchases...");
      const result = await StoreKit.restorePurchases();

      if (result.error) {
        setError(result.error);
        return false;
      }

      if (result.transactions.length === 0) {
        console.log("[Store] No purchases to restore");
        // Still refresh entitlements in case backend has records
        await refreshEntitlements();
        return false;
      }

      console.log("[Store] Found", result.transactions.length, "transactions to verify");

      // Verify each transaction with backend
      let anyVerified = false;
      for (const transaction of result.transactions) {
        const verified = await verifyTransaction(transaction);
        if (verified) {
          anyVerified = true;
        }
      }

      // Refresh entitlements after all verifications
      await refreshEntitlements();

      if (anyVerified) {
        console.log("[Store] Restore complete, entitlements refreshed");
        return true;
      } else {
        setError("No valid purchases to restore");
        return false;
      }
    } catch (err) {
      console.error("[Store] Restore error:", err);
      setError(err instanceof Error ? err.message : "Restore failed");
      return false;
    } finally {
      setRestoring(false);
    }
  }, [isAuthenticated, isAvailable, verifyTransaction, refreshEntitlements]);

  return {
    isAvailable,
    status,
    products,
    error,
    purchasePass,
    restorePurchases,
    getProduct,
    purchasing,
    restoring,
  };
}
