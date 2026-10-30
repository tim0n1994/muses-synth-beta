import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeDashboardError } from "../api";
import type { DashboardApi, DashboardError, ObservatoryEvent } from "../types";

const DEFAULT_PAGE_SIZE = 24;

export interface EventFeedState {
  readonly items: readonly ObservatoryEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly loadState: "idle" | "loading" | "error";
  readonly error: DashboardError | null;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

interface UseEventFeedOptions {
  readonly api: DashboardApi;
  readonly snapshotId: string | null;
  readonly pageSize?: number | undefined;
}

function mergeEvents(
  current: readonly ObservatoryEvent[],
  incoming: readonly ObservatoryEvent[],
): readonly ObservatoryEvent[] {
  const byId = new Map<string, ObservatoryEvent>();
  for (const event of current) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return [...byId.values()].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

export function useEventFeed(options: UseEventFeedOptions): EventFeedState {
  const { api, snapshotId } = options;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const [items, setItems] = useState<readonly ObservatoryEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const hasMoreRef = useRef(true);
  const loadStateRef = useRef<"idle" | "loading" | "error">("idle");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<DashboardError | null>(null);
  const [request, setRequest] = useState<{
    readonly snapshotId: string | null;
    readonly mode: "initial" | "more";
    readonly cursor: string | null;
    readonly token: number;
  }>({ snapshotId: null, mode: "initial", cursor: null, token: 0 });
  const requestIdRef = useRef(0);

  const loadMore = useCallback((): void => {
    if (
      snapshotId === null ||
      nextCursorRef.current === null ||
      loadStateRef.current === "loading" ||
      !hasMoreRef.current
    ) {
      return;
    }
    setLoadingMore(true);
    setLoadState("loading");

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const cursor = nextCursorRef.current;

    void api
      .getEvents(cursor, pageSize, controller.signal)
      .then((page) => {
        if (requestIdRef.current !== requestId) return;
        setItems((current) => mergeEvents(current, page.items));
        setNextCursor(page.nextCursor);
        nextCursorRef.current = page.nextCursor;
        setHasMore(page.hasMore);
        hasMoreRef.current = page.hasMore;
        setLoadState("idle");
        loadStateRef.current = "idle";
        setLoadingMore(false);
      })
      .catch((caught: unknown) => {
        const normalized = normalizeDashboardError(caught);
        if (
          normalized.kind !== "aborted" &&
          requestIdRef.current === requestId
        ) {
          setError(normalized);
          setLoadState("error");
          loadStateRef.current = "error";
          setLoadingMore(false);
        }
      });
  }, [api, pageSize, snapshotId]);

  const reload = useCallback((): void => {
    setItems([]);
    setNextCursor(null);
    setHasMore(true);
    setRequest((value) => ({
      snapshotId,
      mode: "initial",
      cursor: null,
      token: value.token + 1,
    }));
  }, [snapshotId]);

  useEffect(() => {
    if (snapshotId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears state when the external dashboard snapshot is removed.
      setItems([]);
      setNextCursor(null);
      setHasMore(true);
      setLoadState("idle");
      setError(null);
      return undefined;
    }

    if (request.snapshotId !== snapshotId) {
      setItems([]);
      setNextCursor(null);
      setHasMore(true);
      setError(null);
      setRequest((value) => ({
        snapshotId,
        mode: "initial",
        cursor: null,
        token: value.token + 1,
      }));
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    setLoadState("loading");
    setError(null);

    void api
      .getEvents(request.cursor, pageSize, controller.signal)
      .then((page) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setItems((current) =>
          request.mode === "more"
            ? mergeEvents(current, page.items)
            : mergeEvents([], page.items),
        );
        setNextCursor(page.nextCursor);
        nextCursorRef.current = page.nextCursor;
        setHasMore(page.hasMore);
        hasMoreRef.current = page.hasMore;
        setLoadState("idle");
        loadStateRef.current = "idle";
        if (request.mode === "more") {
          setLoadingMore(false);
        }
      })
      .catch((caught: unknown) => {
        const normalized = normalizeDashboardError(caught);
        if (
          normalized.kind !== "aborted" &&
          requestIdRef.current === requestId
        ) {
          setError(normalized);
          setLoadState("error");
          loadStateRef.current = "error";
          if (request.mode === "more") {
            setLoadingMore(false);
          }
        }
      });

    return () => {
      controller.abort();
    };
  }, [api, pageSize, request, snapshotId]);

  return {
    items,
    nextCursor,
    hasMore,
    loadState: loadingMore ? "loading" : loadState,
    error,
    loadMore,
    reload,
  };
}
