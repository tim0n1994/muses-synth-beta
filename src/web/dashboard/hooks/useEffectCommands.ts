import { useCallback, useEffect, useRef, useState } from "react";

import type { AudioProfileId } from "../../../server/policy/contracts";
import type { AudioRuntime } from "../../audio/audio-runtime";
import type { Translator } from "../../i18n";
import { normalizeDashboardError } from "../api";
import type {
  DashboardApi,
  DashboardError,
  EffectCommand,
  PendingEffect,
} from "../types";

export interface EffectCommandsState {
  readonly busyAction: EffectCommand["command"] | null;
  readonly error: DashboardError | null;
  readonly startRequired: PendingEffect | null;
  readonly submit: (command: EffectCommand) => Promise<boolean>;
  readonly clearError: () => void;
}

const AUDIO_PROFILES: readonly AudioProfileId[] = [
  "diverge",
  "flow",
  "audit",
  "debug",
];

function toProfile(value: string | undefined): AudioProfileId | undefined {
  return AUDIO_PROFILES.find((candidate) => candidate === value);
}

/**
 * Drives the audio runtime from the dashboard transport and reports what
 * actually happened back to the server.
 *
 * Before v0.2.1 this posted a synthesised outcome for a sound nothing ever
 * produced. Every command now runs through the executor first: `applied`
 * reports a successful execution call, while `failed` reports an execution
 * error. Neither result verifies physical speaker output or human listening
 * acceptance; browser signal measurements are a separate evidence layer too.
 */
export function useEffectCommands(
  api: DashboardApi,
  runtime: AudioRuntime,
  pendingEffect: PendingEffect | null,
  onAccepted: () => void,
  isCurrentEffect: (effectId: string) => boolean,
  t: Translator,
): EffectCommandsState {
  const [busyAction, setBusyAction] = useState<EffectCommand["command"] | null>(
    null,
  );
  const [error, setError] = useState<DashboardError | null>(null);
  const [startRequired, setStartRequired] = useState<PendingEffect | null>(
    null,
  );
  const controllerRef = useRef<AbortController | null>(null);
  const automaticControllersRef = useRef<Set<AbortController>>(new Set());
  const activeCommandRef = useRef<EffectCommand["command"] | null>(null);
  const pendingPauseRef = useRef<EffectCommand | null>(null);
  const cancelledStartRef = useRef(false);
  const appliedEffectIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const automaticControllers = automaticControllersRef.current;
    return () => {
      controllerRef.current?.abort();
      for (const controller of automaticControllers) {
        controller.abort();
      }
    };
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  // The automatic path. An issued effect with no outcome is the policy
  // engine's proposal; the browser is the only place it can be executed, and
  // the executor itself declines when audio was never started or the user
  // paused it, so this cannot steal control from a manual override.
  useEffect(() => {
    if (pendingEffect === null) {
      return;
    }
    const { effectId } = pendingEffect;
    if (appliedEffectIds.current.has(effectId)) {
      return;
    }
    appliedEffectIds.current.add(effectId);
    const controller = new AbortController();
    automaticControllersRef.current.add(controller);
    void (async () => {
      try {
        const outcome = await runtime.applyIssuedEffect({
          effectId,
          decisionId: pendingEffect.decisionId,
          actionId: "audio.adjust",
          adjustment: {
            actionId: "audio.adjust",
            profile: toProfile(pendingEffect.profile) ?? "flow",
            targetGain: pendingEffect.targetGain,
            rampMs: pendingEffect.rampMs,
          },
          issuedAt: pendingEffect.issuedAt,
          status: "issued",
        });
        if (controller.signal.aborted || !isCurrentEffect(effectId)) {
          runtime.cancelPendingStart();
          return;
        }
        const result = await api.postEffectOutcome(outcome, controller.signal);
        if (outcome.status === "failed") {
          setError({
            kind: "unknown",
            message: outcome.detail ?? t("dashboard.errors.audioCommandFailed"),
            retryable: true,
          });
        }
        if (result.accepted && outcome.reason === "EXPLICIT_START_REQUIRED") {
          setStartRequired(pendingEffect);
        }
        onAccepted();
      } catch (caught: unknown) {
        const normalized = normalizeDashboardError(caught);
        if (normalized.kind !== "aborted") {
          // Retry on the next poll rather than wedging on one bad effect.
          appliedEffectIds.current.delete(effectId);
          setError(normalized);
        }
      } finally {
        automaticControllersRef.current.delete(controller);
      }
    })();
  }, [api, isCurrentEffect, onAccepted, pendingEffect, runtime, t]);

  const submit = useCallback(
    async (command: EffectCommand): Promise<boolean> => {
      if (controllerRef.current !== null) {
        if (
          command.command === "pause" &&
          activeCommandRef.current === "play"
        ) {
          cancelledStartRef.current = true;
          runtime.cancelPendingStart();
          pendingPauseRef.current = command;
        }
        return false;
      }
      const effectId = command.effectId ?? "";
      if (effectId.length === 0) {
        setError({
          kind: "http",
          message: t("dashboard.errors.manualNeedsEffect"),
          retryable: false,
        });
        return false;
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      activeCommandRef.current = command.command;
      cancelledStartRef.current = false;
      setBusyAction(command.command);
      setError(null);
      try {
        const outcome = await runtime.runManualCommand(command.command, {
          effectId,
          profile: toProfile(command.profile),
          volume: command.volume,
        });
        if (controller.signal.aborted) {
          runtime.cancelPendingStart();
          return false;
        }
        if (
          command.command === "play" &&
          (cancelledStartRef.current || !isCurrentEffect(effectId))
        ) {
          runtime.cancelPendingStart();
          return false;
        }
        const result = await api.postEffectOutcome(outcome, controller.signal);
        if (!result.accepted) {
          setError({
            kind: "http",
            message:
              result.reasonKey !== undefined
                ? t(result.reasonKey)
                : (result.reason ?? t("dashboard.errors.outcomeDeclined")),
            retryable: false,
          });
          return false;
        }
        if (outcome.status === "failed") {
          setError({
            kind: "unknown",
            message: outcome.detail ?? t("dashboard.errors.audioCommandFailed"),
            retryable: true,
          });
          return false;
        }
        if (command.command === "play" || command.command === "pause") {
          setStartRequired(null);
        }
        onAccepted();
        return true;
      } catch (caught: unknown) {
        const normalized = normalizeDashboardError(caught);
        if (normalized.kind !== "aborted") {
          setError(normalized);
        }
        return false;
      } finally {
        controllerRef.current = null;
        activeCommandRef.current = null;
        setBusyAction(null);
      }
    },
    [api, isCurrentEffect, onAccepted, runtime, t],
  );

  useEffect(() => {
    if (busyAction !== null || pendingPauseRef.current === null) {
      return;
    }
    const pendingPause = pendingPauseRef.current;
    pendingPauseRef.current = null;
    void submit(pendingPause);
  }, [busyAction, submit]);

  return { busyAction, error, startRequired, submit, clearError };
}
