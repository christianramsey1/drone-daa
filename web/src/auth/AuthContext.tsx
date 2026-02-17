/**
 * Authentication Context
 *
 * Provides auth state and Sign in with Apple functionality.
 * Uses native Sign in with Apple on iOS via Capacitor, web JS SDK otherwise.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { SignInWithApple } from "./AppleSignInPlugin";
import type { User, AuthState } from "../entitlements/types";
import { getApiBaseUrl } from "../platform";

// Apple Sign In JS types (for web)
declare global {
  interface Window {
    AppleID?: {
      auth: {
        init: (config: AppleSignInConfig) => void;
        signIn: () => Promise<AppleSignInWebResponse>;
      };
    };
  }
}

type AppleSignInConfig = {
  clientId: string;
  scope: string;
  redirectURI: string;
  usePopup: boolean;
};

type AppleSignInWebResponse = {
  authorization: {
    code: string;
    id_token: string;
    state?: string;
  };
  user?: {
    email?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
};

type AuthContextValue = AuthState & {
  signIn: () => Promise<void>;
  signOut: () => void;
  isAuthenticated: boolean;
  isAppleSignInReady: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_STORAGE_KEY = "dronedaa.auth";

// Apple Sign In configuration
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID || "com.dronedaa.web";

// Redirect URI for Apple Sign In popup mode.
// In popup mode, Apple redirects the popup to this URL after auth, and the Apple JS SDK
// on that page sends a postMessage back to the parent window (works cross-origin).
// Always use the production canonical URL so localhost dev works via the popup flow.
const PRODUCTION_ORIGIN = "https://dronedaa.com";
const getRedirectUri = () => {
  if (import.meta.env.VITE_APPLE_REDIRECT_URI) {
    return import.meta.env.VITE_APPLE_REDIRECT_URI;
  }
  if (window.location.hostname === "dronedaa.com" || window.location.hostname === "www.dronedaa.com") {
    return PRODUCTION_ORIGIN;
  }
  // Local dev: redirect through production (popup postMessage works cross-origin)
  return PRODUCTION_ORIGIN;
};

const APPLE_REDIRECT_URI = getRedirectUri();

type StoredAuth = {
  user: User;
  sessionToken: string;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    sessionToken: null,
    loading: true,
    error: null,
  });
  const [isAppleSignInReady, setIsAppleSignInReady] = useState(false);
  const initAttempted = useRef(false);

  const isNative = Capacitor.isNativePlatform();

  // Initialize Apple Sign In (native or web)
  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    if (isNative) {
      // Native iOS - Sign in with Apple is always available
      setIsAppleSignInReady(true);
      console.log("[Auth] Native Sign in with Apple ready");
    } else {
      // Web - load Apple Sign In JS SDK
      if (window.AppleID) {
        initializeWebAppleSignIn();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
      script.async = true;
      script.onload = () => {
        initializeWebAppleSignIn();
      };
      script.onerror = () => {
        console.error("[Auth] Failed to load Apple Sign In SDK");
      };
      document.head.appendChild(script);
    }
  }, [isNative]);

  function initializeWebAppleSignIn() {
    if (!window.AppleID) {
      console.error("[Auth] Apple Sign In SDK not available");
      return;
    }

    try {
      window.AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: "name email",
        redirectURI: APPLE_REDIRECT_URI,
        usePopup: true,
      });
      setIsAppleSignInReady(true);
      console.log("[Auth] Web Apple Sign In initialized");
    } catch (err) {
      console.error("[Auth] Failed to initialize Apple Sign In:", err);
    }
  }

  // Load persisted auth on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed: StoredAuth = JSON.parse(stored);
        if (parsed.user && parsed.sessionToken) {
          setState({
            user: parsed.user,
            sessionToken: parsed.sessionToken,
            loading: false,
            error: null,
          });
          return;
        }
      }
    } catch {
      // Invalid stored auth, ignore
    }
    setState((s) => ({ ...s, loading: false }));
  }, []);

  // Native iOS Sign in with Apple
  const signInNative = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const response = await SignInWithApple.authorize({
        clientId: "com.dronedaa.app",
        redirectURI: "https://dronedaa.com",
        scopes: "email name",
      });

      console.log("[Auth] Native Apple Sign In successful");

      // Send to backend for verification
      const apiBase = getApiBaseUrl();
      const backendResponse = await fetch(`${apiBase}/api/auth/apple`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identityToken: response.response.identityToken,
          user: response.response.givenName || response.response.familyName
            ? {
                name: {
                  firstName: response.response.givenName,
                  lastName: response.response.familyName,
                },
                email: response.response.email,
              }
            : undefined,
        }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok || !data.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      // Store auth state
      const authData: StoredAuth = {
        user: data.user,
        sessionToken: data.sessionToken,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));

      setState({
        user: data.user,
        sessionToken: data.sessionToken,
        loading: false,
        error: null,
      });

      console.log("[Auth] Signed in as:", data.user.email || data.user.id);
    } catch (err: any) {
      console.error("[Auth] Native sign in failed:", err);

      // Handle user cancellation
      if (err?.message?.includes("cancelled") || err?.message?.includes("canceled")) {
        setState((s) => ({ ...s, loading: false, error: null }));
        return;
      }

      setState((s) => ({
        ...s,
        loading: false,
        error: err?.message || "Sign in failed",
      }));
    }
  }, []);

  // Web Sign in with Apple
  const signInWeb = useCallback(async () => {
    if (!window.AppleID) {
      setState((s) => ({ ...s, error: "Apple Sign In not available" }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const response = await window.AppleID.auth.signIn();
      console.log("[Auth] Web Apple Sign In successful");

      // Send to backend for verification
      const backendResponse = await fetch(`${getApiBaseUrl()}/api/auth/apple`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identityToken: response.authorization.id_token,
          user: response.user,
        }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok || !data.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      // Store auth state
      const authData: StoredAuth = {
        user: data.user,
        sessionToken: data.sessionToken,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));

      setState({
        user: data.user,
        sessionToken: data.sessionToken,
        loading: false,
        error: null,
      });

      console.log("[Auth] Signed in as:", data.user.email || data.user.id);
    } catch (err: any) {
      console.error("[Auth] Web sign in failed:", err);

      // Handle user cancellation
      if (err?.error === "popup_closed_by_user") {
        setState((s) => ({ ...s, loading: false, error: null }));
        return;
      }

      setState((s) => ({
        ...s,
        loading: false,
        error: err?.message || "Sign in failed",
      }));
    }
  }, []);

  // Main sign in function - routes to native or web
  const signIn = useCallback(async () => {
    if (isNative) {
      await signInNative();
    } else {
      await signInWeb();
    }
  }, [isNative, signInNative, signInWeb]);

  const signOut = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setState({
      user: null,
      sessionToken: null,
      loading: false,
      error: null,
    });
    console.log("[Auth] Signed out");
  }, []);

  const value: AuthContextValue = {
    ...state,
    signIn,
    signOut,
    isAuthenticated: !!state.user && !!state.sessionToken,
    isAppleSignInReady,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
