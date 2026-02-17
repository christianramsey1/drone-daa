/**
 * Store Types
 *
 * Types for StoreKit 2 in-app purchases.
 */

/**
 * Product information from App Store
 */
export type Product = {
  id: string; // Product ID (SKU), e.g., "com.dronedaa.pass.pro.1y"
  displayName: string;
  description: string;
  price: number;
  displayPrice: string; // Localized price string, e.g., "$4.99"
  currencyCode: string;
};

/**
 * Verified transaction from StoreKit
 */
export type Transaction = {
  id: string; // Transaction ID
  originalId: string; // Original transaction ID (for renewals)
  productId: string;
  purchaseDate: string; // ISO timestamp
  expirationDate: string | null; // ISO timestamp (for subscriptions/non-renewing)
  environment: "production" | "sandbox";
  signedTransaction: string; // JWS for server verification
};

/**
 * Result of a purchase attempt
 */
export type PurchaseResult =
  | { status: "success"; transaction: Transaction }
  | { status: "cancelled" }
  | { status: "pending" } // Waiting for approval (e.g., Ask to Buy)
  | { status: "error"; message: string };

/**
 * Result of a restore attempt
 */
export type RestoreResult = {
  transactions: Transaction[];
  error?: string;
};

/**
 * Store availability status
 */
export type StoreStatus = "ready" | "unavailable" | "loading";
