/**
 * Apple Sign In Capacitor Plugin
 *
 * Bridges ASAuthorizationController to the web layer via Capacitor.
 * Handles Sign in with Apple on iOS.
 */

import Foundation
import Capacitor
import AuthenticationServices

@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
    ]

    private var currentCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        currentCall = call

        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        let delegate = AppleSignInDelegate(plugin: self)
        // Store delegate reference to prevent deallocation
        objc_setAssociatedObject(controller, "delegate", delegate, .OBJC_ASSOCIATION_RETAIN)
        controller.delegate = delegate
        controller.presentationContextProvider = delegate

        DispatchQueue.main.async {
            controller.performRequests()
        }
    }

    fileprivate func handleSuccess(_ credential: ASAuthorizationAppleIDCredential) {
        guard let call = currentCall else { return }
        currentCall = nil

        var response: [String: Any] = [:]

        if let identityToken = credential.identityToken,
           let tokenString = String(data: identityToken, encoding: .utf8) {
            response["identityToken"] = tokenString
        }

        if let authorizationCode = credential.authorizationCode,
           let codeString = String(data: authorizationCode, encoding: .utf8) {
            response["authorizationCode"] = codeString
        }

        response["user"] = credential.user
        response["email"] = credential.email ?? NSNull()
        response["givenName"] = credential.fullName?.givenName ?? NSNull()
        response["familyName"] = credential.fullName?.familyName ?? NSNull()

        call.resolve(["response": response])
    }

    fileprivate func handleError(_ error: Error) {
        guard let call = currentCall else { return }
        currentCall = nil

        let nsError = error as NSError
        if nsError.code == ASAuthorizationError.canceled.rawValue {
            call.reject("cancelled", "USER_CANCELLED")
        } else {
            call.reject(error.localizedDescription, "SIGN_IN_FAILED")
        }
    }
}

private class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private weak var plugin: AppleSignInPlugin?

    init(plugin: AppleSignInPlugin) {
        self.plugin = plugin
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            plugin?.handleError(NSError(domain: "AppleSignIn", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid credential type"]))
            return
        }
        plugin?.handleSuccess(credential)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        plugin?.handleError(error)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first
        return scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first ?? UIWindow()
    }
}
