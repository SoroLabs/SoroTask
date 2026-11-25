"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { Permission } from "@/types/auth";
import { getRbacApi } from "./api";
import { getRbacEngine } from "./engine";
import { RBAC_EVENT_NAME, type RbacConnectionState, type RbacStateChangeEvent } from "./types";

type RbacUiEngineContextValue = {
  connectionState: RbacConnectionState;
  cachedPermissions: Permission[];
  evaluate: (permissions: Permission[], requireAll?: boolean) => boolean;
  hasPermission: (permission: Permission) => boolean;
  refreshPermissions: () => Promise<void>;
  lastError: string | null;
};

const RbacUiEngineContext = createContext<RbacUiEngineContextValue | undefined>(
  undefined,
);

export function RbacUiEngineProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const engine = useMemo(() => getRbacEngine(), []);
  const api = useMemo(() => getRbacApi(), []);

  const [connectionState, setConnectionState] =
    useState<RbacConnectionState>("online");
  const [cachedPermissions, setCachedPermissions] = useState<Permission[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshPermissions = useCallback(async () => {
    if (!user?.id) return;

    const result = await api.fetchPermissions(user.id);
    setConnectionState(result.connectionState);
    engine.setConnectionState(result.connectionState);

    if (result.data) {
      setCachedPermissions(result.data);
    }

    setLastError(result.error?.message ?? null);
  }, [api, engine, user?.id]);

  useEffect(() => {
    refreshPermissions();

    const handleStateChange = (event: Event) => {
      const detail = (event as CustomEvent<RbacStateChangeEvent>).detail;
      setConnectionState(detail.connectionState);
      engine.setConnectionState(detail.connectionState);
      setLastError(detail.error ?? null);
    };

    window.addEventListener(RBAC_EVENT_NAME, handleStateChange);
    return () => window.removeEventListener(RBAC_EVENT_NAME, handleStateChange);
  }, [engine, refreshPermissions]);

  const evaluate = useCallback(
    (permissions: Permission[], requireAll = true) => {
      if (!user) return false;

      return engine.evaluate(
        permissions,
        {
          userPermissions: user.permissions,
          userRole: user.role,
          cachedPermissions,
          connectionState,
        },
        requireAll,
      ).allowed;
    },
    [cachedPermissions, connectionState, engine, user],
  );

  const hasPermission = useCallback(
    (permission: Permission) => evaluate([permission], true),
    [evaluate],
  );

  const value = useMemo(
    () => ({
      connectionState,
      cachedPermissions,
      evaluate,
      hasPermission,
      refreshPermissions,
      lastError,
    }),
    [cachedPermissions, connectionState, evaluate, hasPermission, lastError, refreshPermissions],
  );

  return (
    <RbacUiEngineContext.Provider value={value}>
      {children}
    </RbacUiEngineContext.Provider>
  );
}

export function useRbacUiEngine(): RbacUiEngineContextValue {
  const context = useContext(RbacUiEngineContext);
  if (!context) {
    throw new Error("useRbacUiEngine must be used within RbacUiEngineProvider");
  }
  return context;
}
