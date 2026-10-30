import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { normalizeDashboardError } from "../api";
import type {
  DashboardApi,
  DashboardError,
  DashboardSnapshot,
  DashboardViewStatus,
} from "../types";

const DEFAULT_REFRESH_INTERVAL_MS = 15_000;

export interface DashboardDataState {
  readonly snapshot: DashboardSnapshot | null;
  readonly status: DashboardViewStatus;
  readonly error: DashboardError | null;
  readonly isRefreshing: boolean;
  readonly liveRefresh: boolean;
  readonly refreshIntervalMs: number;
  readonly lastSuccessfulRefreshAt: string | null;
  readonly refresh: () => void;
  readonly setLiveRefresh: (enabled: boolean) => void;
  readonly setRefreshIntervalMs: (intervalMs: number) => void;
}

interface UseDashboardDataOptions {
  readonly api: DashboardApi;
  readonly initialLiveRefresh?: boolean | undefined;
  readonly initialRefreshIntervalMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

function isSnapshotEmpty(snapshot: DashboardSnapshot): boolean {
  return (
    snapshot.state === null &&
    snapshot.belief === null &&
    snapshot.evidence.items.length === 0 &&
    snapshot.decision === null &&
    snapshot.audio === null &&
    snapshot.metrics === null &&
    snapshot.privacy === null
  );
}

function isSnapshotStale(snapshot: DashboardSnapshot, now: number): boolean {
  if (snapshot.freshness === "stale") {
    return true;
  }
  const generatedAt = Date.parse(snapshot.generatedAt);
  return (
    !Number.isFinite(generatedAt) || now - generatedAt > snapshot.staleAfterMs
  );
}

export function useDashboardData(
  options: UseDashboardDataOptions,
): DashboardDataState {
  const { api } = options;
  const now = options.now ?? Date.now;
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<DashboardError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveRefresh, setLiveRefresh] = useState(
    options.initialLiveRefresh ?? true,
  );
  const [refreshIntervalMs, setRefreshIntervalMsState] = useState(
    options.initialRefreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
  );
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<
    string | null
  >(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);

  const refresh = useCallback((): void => {
    setRefreshToken((value) => value + 1);
  }, []);

  const setRefreshIntervalMs = useCallback((intervalMs: number): void => {
    const safeInterval = Math.max(
      5_000,
      Math.min(60_000, Math.round(intervalMs)),
    );
    setRefreshIntervalMsState(safeInterval);
  }, []);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the lifecycle of this external request before it resolves.
    setIsRefreshing(true);

    void api
      .getSnapshot(controller.signal)
      .then((nextSnapshot) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setSnapshot(nextSnapshot);
        setError(null);
        setLastSuccessfulRefreshAt(new Date(now()).toISOString());
      })
      .catch((caught: unknown) => {
        const normalized = normalizeDashboardError(caught);
        if (
          normalized.kind !== "aborted" &&
          requestIdRef.current === requestId
        ) {
          setError(normalized);
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsRefreshing(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [api, now, refreshToken]);

  useEffect(() => {
    if (!liveRefresh) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, refreshIntervalMs);
    return () => {
      window.clearInterval(interval);
    };
  }, [liveRefresh, refresh, refreshIntervalMs]);

  useEffect(() => {
    if (!liveRefresh) {
      return undefined;
    }
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [liveRefresh, refresh]);

  const status = useMemo<DashboardViewStatus>(() => {
    if (snapshot === null) {
      if (error?.kind === "network") {
        return "disconnected";
      }
      if (error !== null) {
        return "server-error";
      }
      return "loading";
    }
    if (error !== null || isSnapshotStale(snapshot, now())) {
      return "stale";
    }
    if (isSnapshotEmpty(snapshot)) {
      return "empty";
    }
    return "ready";
  }, [error, now, snapshot]);

  return {
    snapshot,
    status,
    error,
    isRefreshing,
    liveRefresh,
    refreshIntervalMs,
    lastSuccessfulRefreshAt,
    refresh,
    setLiveRefresh,
    setRefreshIntervalMs,
  };
}
