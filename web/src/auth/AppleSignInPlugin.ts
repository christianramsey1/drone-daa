/**
 * Apple Sign In Capacitor Plugin
 *
 * TypeScript interface for the native Apple Sign In Capacitor plugin.
 * On iOS: bridges to the native ASAuthorizationController.
 * On web: returns an error (web uses the Apple JS SDK directly).
 */

import { registerPlugin } from "@capacitor/core";

export interface SignInWithAppleResponse {
  response: {
    identityToken: string;
    authorizationCode: string;
    user: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
  };
}

export interface SignInWithApplePlugin {
  authorize(options: {
    clientId: string;
    redirectURI: string;
    scopes: string;
  }): Promise<SignInWithAppleResponse>;
}

export const SignInWithApple = registerPlugin<SignInWithApplePlugin>(
  "SignInWithApple"
);
