/**
 * StoreKit Capacitor Plugin
 *
 * Bridges StoreKit 2 to the web layer via Capacitor.
 * Handles in-app purchases for lake passes.
 */

import Foundation
import Capacitor
import StoreKit

@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentEntitlements", returnType: CAPPluginReturnPromise),
    ]

    private var transactionListener: Task<Void, Error>?

    public override func load() {
        // Start listening for transactions (for interrupted purchases, etc.)
        startTransactionListener()
    }

    deinit {
        transactionListener?.cancel()
    }

    // MARK: - Transaction Listener

    private func startTransactionListener() {
        transactionListener = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self = self else { return }
                await self.handleTransactionUpdate(result)
            }
        }
    }

    private func handleTransactionUpdate(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else {
            print("[StoreKit] Unverified transaction update ignored")
            return
        }

        // Notify web layer about the transaction
        // The web layer will verify with backend and call finishTransaction
        var data = transactionToDict(transaction)
        data["signedTransaction"] = result.jwsRepresentation
        notifyListeners("transactionUpdate", data: data)

        print("[StoreKit] Transaction update received: \(transaction.id)")
    }

    // MARK: - Plugin Methods

    @objc func isAvailable(_ call: CAPPluginCall) {
        // StoreKit 2 requires iOS 15+
        if #available(iOS 15.0, *) {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["products": []])
            return
        }

        guard let productIds = call.getArray("productIds", String.self) else {
            call.reject("Missing productIds parameter")
            return
        }

        Task {
            do {
                let products = try await Product.products(for: Set(productIds))
                let productDicts = products.map { productToDict($0) }
                call.resolve(["products": productDicts])
            } catch {
                print("[StoreKit] Failed to fetch products: \(error)")
                call.reject("Failed to fetch products: \(error.localizedDescription)")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["status": "error", "message": "StoreKit 2 requires iOS 15+"])
            return
        }

        guard let productId = call.getString("productId") else {
            call.reject("Missing productId parameter")
            return
        }

        Task {
            do {
                // Fetch the product
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    call.resolve(["status": "error", "message": "Product not found: \(productId)"])
                    return
                }

                // Attempt purchase
                let result = try await product.purchase()

                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        // Don't finish yet - wait for backend verification
                        var transactionData = transactionToDict(transaction)
                        transactionData["signedTransaction"] = verification.jwsRepresentation
                        call.resolve([
                            "status": "success",
                            "transaction": transactionData
                        ])

                    case .unverified(_, let error):
                        call.resolve([
                            "status": "error",
                            "message": "Transaction verification failed: \(error.localizedDescription)"
                        ])
                    }

                case .userCancelled:
                    call.resolve(["status": "cancelled"])

                case .pending:
                    call.resolve(["status": "pending"])

                @unknown default:
                    call.resolve(["status": "error", "message": "Unknown purchase result"])
                }

            } catch {
                print("[StoreKit] Purchase failed: \(error)")
                call.resolve([
                    "status": "error",
                    "message": error.localizedDescription
                ])
            }
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["transactions": [], "error": "StoreKit 2 requires iOS 15+"])
            return
        }

        Task {
            do {
                // Sync with App Store to get latest transaction history
                try await AppStore.sync()

                // Get current entitlements
                var transactions: [[String: Any]] = []

                for await result in Transaction.currentEntitlements {
                    if case .verified(let transaction) = result {
                        var dict = transactionToDict(transaction)
                        dict["signedTransaction"] = result.jwsRepresentation
                        transactions.append(dict)
                    }
                }

                call.resolve(["transactions": transactions])

            } catch {
                print("[StoreKit] Restore failed: \(error)")
                call.resolve([
                    "transactions": [],
                    "error": error.localizedDescription
                ])
            }
        }
    }

    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve()
            return
        }

        guard let transactionIdStr = call.getString("transactionId"),
              let transactionId = UInt64(transactionIdStr) else {
            call.reject("Missing or invalid transactionId parameter")
            return
        }

        Task {
            // Find and finish the transaction
            for await result in Transaction.unfinished {
                if case .verified(let transaction) = result,
                   transaction.id == transactionId {
                    await transaction.finish()
                    print("[StoreKit] Transaction finished: \(transactionId)")
                    call.resolve()
                    return
                }
            }

            // Transaction might already be finished, that's ok
            print("[StoreKit] Transaction not found (may already be finished): \(transactionId)")
            call.resolve()
        }
    }

    @objc func getCurrentEntitlements(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["transactions": []])
            return
        }

        Task {
            var transactions: [[String: Any]] = []

            for await result in Transaction.currentEntitlements {
                if case .verified(let transaction) = result {
                    var dict = transactionToDict(transaction)
                    dict["signedTransaction"] = result.jwsRepresentation
                    transactions.append(dict)
                }
            }

            call.resolve(["transactions": transactions])
        }
    }

    // MARK: - Helpers

    @available(iOS 15.0, *)
    private func productToDict(_ product: Product) -> [String: Any] {
        return [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "price": product.price as NSDecimalNumber,
            "displayPrice": product.displayPrice,
            "currencyCode": product.priceFormatStyle.currencyCode
        ]
    }

    @available(iOS 15.0, *)
    private func transactionToDict(_ transaction: Transaction) -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        var dict: [String: Any] = [
            "id": String(transaction.id),
            "originalId": String(transaction.originalID),
            "productId": transaction.productID,
            "purchaseDate": formatter.string(from: transaction.purchaseDate),
        ]

        if #available(iOS 16.0, *) {
            dict["environment"] = transaction.environment == .production ? "production" : "sandbox"
        } else {
            dict["environment"] = "unknown"
        }

        if let expirationDate = transaction.expirationDate {
            dict["expirationDate"] = formatter.string(from: expirationDate)
        } else {
            dict["expirationDate"] = NSNull()
        }

        return dict
    }
}
