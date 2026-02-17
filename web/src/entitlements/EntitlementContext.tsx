/**
 * Entitlement Context
 *
 * Manages user entitlements and provides access control throughout the app.
 * Fetches entitlements from the backend when authenticated.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth";
import type { Entitlement } from "./types";
import { getApiBaseUrl } from "../platform";

type EntitlementContextValue = {
  entitlements: Entitlement[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  hasEntitlement: (key: string) => boolean;
};

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionToken } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntitlements = useCallback(async () => {
    if (!isAuthenticated || !sessionToken) {
      setEntitlements([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/me/entitlements`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch entitlements: ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.entitlements)) {
        setEntitlements(data.entitlements);
      } else {
        setEntitlements([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch entitlements");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, sessionToken]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchEntitlements();
    } else {
      setEntitlements([]);
    }
  }, [isAuthenticated, fetchEntitlements]);

  const hasEntitlement = useCallback(
    (key: string): boolean => {
      const now = new Date();
      return entitlements.some(
        (e) => e.key === key && (!e.expiresAt || new Date(e.expiresAt) > now)
      );
    },
    [entitlements]
  );

  const value: EntitlementContextValue = {
    entitlements,
    loading,
    error,
    refresh: fetchEntitlements,
    hasEntitlement,
  };

  return (
    <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>
  );
}

export function useEntitlements(): EntitlementContextValue {
  const ctx = useContext(EntitlementContext);
  if (!ctx) {
    throw new Error("useEntitlements must be used within an EntitlementProvider");
  }
  return ctx;
}
