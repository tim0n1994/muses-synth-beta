import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createTranslator, DEFAULT_LANGUAGE, I18nProvider } from "../i18n";
import {
  DashboardEmptyState,
  DashboardBlockingState,
  InlineError,
  StaleBanner,
} from "./components/DashboardStates";
import { DashboardToolbar } from "./components/DashboardToolbar";
import { RegistrySlot } from "./components/RegistrySlot";
import { useDashboardData } from "./hooks/useDashboardData";
import type { AudioRuntime } from "../audio/audio-runtime";
import { MAX_GAIN } from "../audio/volume";
import { useEffectCommands } from "./hooks/useEffectCommands";
import { useLlmGeneration } from "./hooks/useLlmGeneration";
import { formatDashboardError } from "./api";
import { buildSurfaceSlots } from "./surface";
import { useEventFeed } from "./hooks/useEventFeed";
import type {
  DashboardApi,
  DashboardRegistry,
  DashboardRegistryActions,
  DashboardRegistryContext,
  EffectCommand,
} from "./types";
import "./dashboard.css";

export interface DashboardProps {
  readonly api: DashboardApi;
  readonly registry: DashboardRegistry;
  /** Caller owns/disposes this runtime; dashboard cleanup only cancels its work. */
  readonly audioRuntime: AudioRuntime;
  readonly initialLiveRefresh?: boolean | undefined;
  readonly initialRefreshIntervalMs?: number | undefined;
  readonly eventPageSize?: number | undefined;
}

export function Dashboard(props: DashboardProps): ReactNode {
  const localAudio = useSyncExternalStore(
    useCallback(
      (listener: () => void) => props.audioRuntime.subscribe(listener),
      [props.audioRuntime],
    ),
    useCallback(() => props.audioRuntime.snapshot(), [props.audioRuntime]),
  );
  const [loadingOlderEvents, setLoadingOlderEvents] = useState(false);
  const [promptSuppressed, setPromptSuppressed] = useState(false);
  const dashboard = useDashboardData({
    api: props.api,
    initialLiveRefresh: props.initialLiveRefresh,
    initialRefreshIntervalMs: props.initialRefreshIntervalMs,
  });
  // Receipts are shared history. Transport state belongs to this runtime/tab;
  // a new route has no graph even when the latest receipt reports playing.
  // Keep server permissions and effect identity intact for every command.
  const snapshot = useMemo(() => {
    const server = dashboard.snapshot;
    if (server === null || server.audio === null) return server;
    return {
      ...server,
      audio: {
        ...server.audio,
        status:
          localAudio.started && !localAudio.paused && !localAudio.muted
            ? ("playing" as const)
            : server.audio.status === "unavailable"
              ? ("unavailable" as const)
              : ("paused" as const),
        volume: localAudio.started
          ? localAudio.desiredGain
          : server.audio.volume,
      },
    };
  }, [dashboard.snapshot, localAudio]);
  // The published settings release owns the interface language; hooks that
  // build user-visible error strings take the translator explicitly, and the
  // provider below localizes the rendered tree.
  const lang = dashboard.snapshot?.language ?? DEFAULT_LANGUAGE;
  const t = useMemo(() => createTranslator(lang), [lang]);
  const events = useEventFeed({
    api: props.api,
    snapshotId: dashboard.snapshot?.snapshotId ?? null,
    pageSize: props.eventPageSize,
  });
  useEffect(() => {
    if (events.loadState !== "loading") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the completion of an external event-feed request.
      setLoadingOlderEvents(false);
    }
  }, [events.loadState]);
  const refreshDashboard = dashboard.refresh;
  const reloadEvents = events.reload;
  const refreshAll = useCallback((): void => {
    refreshDashboard();
    reloadEvents();
  }, [refreshDashboard, reloadEvents]);
  const currentEffectIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    currentEffectIdRef.current = dashboard.snapshot?.audio?.effectId ?? null;
  }, [dashboard.snapshot?.audio?.effectId]);
  const activePromptEffectIdRef = useRef<string | null>(null);
  const isCurrentEffect = useCallback(
    (effectId: string): boolean => currentEffectIdRef.current === effectId,
    [],
  );
  const effects = useEffectCommands(
    props.api,
    props.audioRuntime,
    dashboard.snapshot?.pendingEffect ?? null,
    refreshAll,
    isCurrentEffect,
    t,
  );
  // Optional enhancement layer: mounted unconditionally (cheap when idle),
  // but it only renders anything when the surface publishes an llm.narration
  // widget and the server reports the feature available.
  const llmGeneration = useLlmGeneration(props.api, t);
  useLayoutEffect(() => {
    if (
      activePromptEffectIdRef.current !== null &&
      activePromptEffectIdRef.current !== dashboard.snapshot?.audio?.effectId
    ) {
      props.audioRuntime.cancelPendingStart();
      activePromptEffectIdRef.current = null;
    }
  }, [dashboard.snapshot?.audio?.effectId, props.audioRuntime]);
  useEffect(
    () => () => props.audioRuntime.cancelPendingStart(),
    [props.audioRuntime],
  );

  const timelineData = useMemo(
    () => ({
      items: events.items,
      totalLoaded: events.items.length,
      hasMore: events.hasMore,
      nextCursor: events.nextCursor,
    }),
    [events.hasMore, events.items, events.nextCursor],
  );

  // The published `settings.surface.widgets` list is the composition: which
  // components exist, in what order, with which props. Nothing about the
  // dashboard body is hardcoded any more.
  const slots = useMemo(
    () =>
      snapshot === null ? [] : buildSurfaceSlots(snapshot, timelineData, t),
    [snapshot, timelineData, t],
  );
  const timelineSlot = slots.find(
    (slot) => slot.block.type === "events.timeline",
  );
  const primarySlots = slots.filter(
    (slot) =>
      slot.region === "primary" && slot.block.type !== "events.timeline",
  );
  const railSlots = slots.filter((slot) => slot.region === "rail");

  const submitEffect = useCallback(
    (command: Omit<EffectCommand, "expectedSnapshotId">): void => {
      const snapshotId = dashboard.snapshot?.snapshotId;
      if (snapshotId === undefined) {
        return;
      }
      void effects.submit({ ...command, expectedSnapshotId: snapshotId });
    },
    [dashboard.snapshot?.snapshotId, effects],
  );

  const registryActions = useMemo<DashboardRegistryActions>(
    () => ({
      refresh: refreshAll,
      loadMoreEvents: events.loadMore,
      setAudioPlaying: (playing: boolean): void => {
        const audio = dashboard.snapshot?.audio;
        if (audio === null || audio === undefined) {
          return;
        }
        if (!playing) {
          setPromptSuppressed(true);
        }
        submitEffect({
          command: playing ? "play" : "pause",
          effectId: audio.effectId,
        });
      },
      setAudioVolume: (volume: number): void => {
        const audio = dashboard.snapshot?.audio;
        if (audio === null || audio === undefined || !Number.isFinite(volume)) {
          return;
        }
        submitEffect({
          command: "set-volume",
          effectId: audio.effectId,
          volume: Math.max(0, Math.min(MAX_GAIN, volume)),
        });
      },
      undoDecision: (): void => {
        const decision = dashboard.snapshot?.decision;
        if (
          decision === null ||
          decision === undefined ||
          !decision.undoAvailable
        ) {
          return;
        }
        submitEffect({
          command: "undo-decision",
          decisionId: decision.id,
        });
      },
      requestLlmNarration: llmGeneration.requestNarration,
      requestLlmSummary: llmGeneration.requestSummary,
    }),
    [
      dashboard.snapshot?.audio,
      dashboard.snapshot?.decision,
      events.loadMore,
      llmGeneration.requestNarration,
      llmGeneration.requestSummary,
      refreshAll,
      submitEffect,
    ],
  );

  const registryContext = useMemo<DashboardRegistryContext>(
    () => ({
      actions: registryActions,
      busyAction: effects.busyAction,
      eventLoadState: events.loadState,
      llm: llmGeneration.llm,
    }),
    [effects.busyAction, events.loadState, llmGeneration.llm, registryActions],
  );

  const startRequired = effects.startRequired;
  const promptVisible =
    !promptSuppressed &&
    dashboard.status === "ready" &&
    startRequired !== null &&
    snapshot?.audio?.effectId === startRequired.effectId &&
    snapshot.audio.status === "paused" &&
    snapshot.decision?.id === startRequired.decisionId &&
    snapshot.decision.status === "PROPOSED" &&
    snapshot.audio.canPlay;
  const isBlocking =
    dashboard.status === "loading" ||
    dashboard.status === "disconnected" ||
    dashboard.status === "server-error";

  return (
    <I18nProvider lang={lang}>
      <main className="muses-dashboard" id="main-content">
        <a className="muses-dashboard__skip-link" href="#observatory-content">
          {t("dashboard.skipLink")}
        </a>
        <header className="muses-dashboard__masthead">
          <div>
            <p className="muses-dashboard__eyebrow">{t("dashboard.eyebrow")}</p>
            <h1>{t("dashboard.title")}</h1>
            <p className="muses-dashboard__lede">{t("dashboard.lede")}</p>
            <p className="muses-dashboard__guide-link">
              <a href="/guide-beta.html">{t("dashboard.guideLink")}</a>
            </p>
          </div>
          <div
            className="muses-dashboard__local-badge"
            aria-label={t("dashboard.localBadgeAria")}
          >
            <span aria-hidden="true" />
            {t("dashboard.localBadge")}
          </div>
        </header>

        <DashboardToolbar
          liveRefresh={dashboard.liveRefresh}
          refreshIntervalMs={dashboard.refreshIntervalMs}
          isRefreshing={dashboard.isRefreshing}
          lastSuccessfulRefreshAt={dashboard.lastSuccessfulRefreshAt}
          onLiveRefreshChange={dashboard.setLiveRefresh}
          onRefreshIntervalChange={dashboard.setRefreshIntervalMs}
          onRefresh={refreshAll}
        />

        {dashboard.status === "stale" ? (
          <StaleBanner error={dashboard.error} onRetry={refreshAll} />
        ) : null}
        {effects.error === null ? null : (
          <InlineError
            message={formatDashboardError(t, effects.error)}
            onDismiss={effects.clearError}
          />
        )}

        <div id="observatory-content" tabIndex={-1}>
          {isBlocking ? (
            <DashboardBlockingState
              status={dashboard.status}
              error={dashboard.error}
              onRetry={refreshAll}
            />
          ) : dashboard.status === "empty" || snapshot === null ? (
            <DashboardEmptyState />
          ) : (
            <div className="muses-dashboard__layout">
              <section
                className="muses-dashboard__primary"
                aria-label={t("dashboard.primaryRegionAria")}
              >
                {primarySlots.length === 0 ? (
                  <p className="muses-dashboard__lede">
                    {t("dashboard.noComponents")}
                  </p>
                ) : (
                  primarySlots.map((slot) => (
                    <RegistrySlot
                      key={slot.key}
                      registry={props.registry}
                      block={slot.block}
                      context={registryContext}
                      title={slot.title}
                      className={
                        slot.block.type === "state.hero"
                          ? "muses-dashboard__slot--hero"
                          : undefined
                      }
                    />
                  ))
                )}
                {timelineSlot === undefined ? null : (
                  <div
                    className="muses-dashboard__timeline-region"
                    aria-labelledby="event-feed-title"
                  >
                    <div className="muses-dashboard__section-heading">
                      <div>
                        <p className="muses-dashboard__eyebrow">
                          {t("dashboard.eventStreamEyebrow")}
                        </p>
                        <h2 id="event-feed-title">
                          {t("dashboard.recentEvents")}
                        </h2>
                      </div>
                      <span aria-live="polite">
                        {t("dashboard.loadedCount", {
                          count: events.items.length,
                        })}
                      </span>
                    </div>
                    <RegistrySlot
                      registry={props.registry}
                      block={timelineSlot.block}
                      context={registryContext}
                      title={timelineSlot.title}
                    />
                    {events.error === null ? null : (
                      <InlineError
                        message={formatDashboardError(t, events.error)}
                      />
                    )}
                    <button
                      className="muses-dashboard__button muses-dashboard__button--load-more"
                      type="button"
                      onClick={() => {
                        setLoadingOlderEvents(true);
                        events.loadMore();
                      }}
                      disabled={
                        loadingOlderEvents ||
                        events.loadState === "loading" ||
                        !events.hasMore
                      }
                      aria-describedby="event-feed-title"
                    >
                      {loadingOlderEvents || events.loadState === "loading"
                        ? t("dashboard.loadingOlderEvents")
                        : events.hasMore
                          ? t("dashboard.loadOlderEvents")
                          : events.items.length > 0
                            ? t("dashboard.allEventsLoaded")
                            : t("dashboard.noEventsAvailable")}
                    </button>
                  </div>
                )}
              </section>

              <aside
                className="muses-dashboard__rail"
                aria-label={t("dashboard.railAria")}
              >
                {promptVisible ? (
                  <section
                    className="muses-dashboard__panel"
                    aria-label={t("dashboard.audioPromptAria")}
                  >
                    <h2>{t("dashboard.audioPromptTitle")}</h2>
                    <p>{t("dashboard.audioPromptBody")}</p>
                    <button
                      className="muses-dashboard__button"
                      type="button"
                      disabled={effects.busyAction !== null}
                      onClick={() => {
                        const target = effects.startRequired;
                        const snapshotId = dashboard.snapshot?.snapshotId;
                        if (
                          target === null ||
                          snapshotId === undefined ||
                          !isCurrentEffect(target.effectId)
                        ) {
                          return;
                        }
                        activePromptEffectIdRef.current = target.effectId;
                        void effects
                          .submit({
                            command: "play",
                            effectId: target.effectId,
                            profile: target.profile,
                            volume: target.targetGain,
                            expectedSnapshotId: snapshotId,
                          })
                          .finally(() => {
                            activePromptEffectIdRef.current = null;
                          });
                      }}
                    >
                      {t("dashboard.audioPromptStart")}
                    </button>
                    {effects.busyAction === "play" ? (
                      <button
                        className="muses-dashboard__button muses-dashboard__button--secondary"
                        type="button"
                        onClick={() => {
                          const target = effects.startRequired;
                          const snapshotId = dashboard.snapshot?.snapshotId;
                          if (target === null || snapshotId === undefined) {
                            return;
                          }
                          setPromptSuppressed(true);
                          void effects.submit({
                            command: "pause",
                            effectId: target.effectId,
                            expectedSnapshotId: snapshotId,
                          });
                        }}
                      >
                        {t("dashboard.audioPromptPause")}
                      </button>
                    ) : null}
                    <button
                      className="muses-dashboard__button muses-dashboard__button--secondary"
                      type="button"
                      onClick={() => setPromptSuppressed(true)}
                    >
                      {t("dashboard.audioPromptDismiss")}
                    </button>
                  </section>
                ) : null}
                {railSlots.map((slot) => (
                  <RegistrySlot
                    key={slot.key}
                    registry={props.registry}
                    block={slot.block}
                    context={registryContext}
                    title={slot.title}
                  />
                ))}
              </aside>
            </div>
          )}
        </div>
      </main>
    </I18nProvider>
  );
}
