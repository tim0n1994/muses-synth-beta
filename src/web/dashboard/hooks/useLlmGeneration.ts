import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import type { Translator } from "../../i18n";
import type { DashboardApi, LlmTextResult } from "../types";
import type { RegistryLlmGeneration } from "../../registry/types";

/**
 * The optional LLM generation layer for the dashboard shell.
 *
 * Two `useMutation`s (never `useQuery` — generations are user-triggered and
 * cost gateway quota; nothing may poll them). The global QueryClient default
 * `mutations.retry: false` (src/web/foundation/query-client.ts) is
 * deliberately not overridden: the server-side client already performs the
 * single sanctioned retry, so another one here would stack retries on top.
 * No LLM state ever touches localStorage.
 */

const ERROR_MESSAGE_LIMIT = 280;

const IDLE: RegistryLlmGeneration = {
  status: "idle",
  text: null,
  model: null,
  error: null,
  generatedAt: null,
};

const LOADING: RegistryLlmGeneration = {
  status: "loading",
  text: null,
  model: null,
  error: null,
  generatedAt: null,
};

function errorState(error: unknown, t: Translator): RegistryLlmGeneration {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : t("dashboard.errors.generationFailed");
  const clamped =
    message.length > ERROR_MESSAGE_LIMIT
      ? `${message.slice(0, ERROR_MESSAGE_LIMIT - 3)}...`
      : message;
  return {
    status: "error",
    text: null,
    model: null,
    error: clamped,
    generatedAt: null,
  };
}

function doneState(result: LlmTextResult): RegistryLlmGeneration {
  return {
    status: "done",
    text: result.text,
    model: result.model,
    error: null,
    generatedAt: result.generatedAt,
  };
}

interface GenerationRequest {
  readonly controller: AbortController;
  readonly windowMinutes?: number | undefined;
}

export interface UseLlmGenerationResult {
  readonly llm: {
    readonly narration: RegistryLlmGeneration;
    readonly summary: RegistryLlmGeneration;
  };
  readonly requestNarration: () => void;
  readonly requestSummary: (windowMinutes?: number) => void;
}

export function useLlmGeneration(
  api: DashboardApi,
  t: Translator,
): UseLlmGenerationResult {
  const [narration, setNarration] = useState<RegistryLlmGeneration>(IDLE);
  const [summary, setSummary] = useState<RegistryLlmGeneration>(IDLE);
  const narrationControllerRef = useRef<AbortController | null>(null);
  const summaryControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // Aborting on unmount is enough: there is no cache to invalidate and
      // no poller to stop — generations exist only while a user waits.
      narrationControllerRef.current?.abort();
      summaryControllerRef.current?.abort();
    },
    [],
  );

  const narrationMutation = useMutation({
    mutationFn: ({ controller }: GenerationRequest) =>
      api.postLlmNarration(controller.signal),
    onMutate: () => {
      setNarration(LOADING);
    },
    onError: (error: unknown, variables: GenerationRequest) => {
      // A superseded request (the user clicked again) must not overwrite the
      // newer generation's state with this one's abort error.
      if (narrationControllerRef.current !== variables.controller) {
        return;
      }
      setNarration(errorState(error, t));
    },
    onSuccess: (result: LlmTextResult, variables: GenerationRequest) => {
      if (narrationControllerRef.current !== variables.controller) {
        return;
      }
      setNarration(doneState(result));
    },
  });

  const summaryMutation = useMutation({
    mutationFn: ({ controller, windowMinutes = 60 }: GenerationRequest) =>
      api.postLlmSummary(windowMinutes, controller.signal),
    onMutate: () => {
      setSummary(LOADING);
    },
    onError: (error: unknown, variables: GenerationRequest) => {
      if (summaryControllerRef.current !== variables.controller) {
        return;
      }
      setSummary(errorState(error, t));
    },
    onSuccess: (result: LlmTextResult, variables: GenerationRequest) => {
      if (summaryControllerRef.current !== variables.controller) {
        return;
      }
      setSummary(doneState(result));
    },
  });

  const narrationMutate = narrationMutation.mutate;
  const summaryMutate = summaryMutation.mutate;

  const requestNarration = useCallback((): void => {
    narrationControllerRef.current?.abort();
    const controller = new AbortController();
    narrationControllerRef.current = controller;
    narrationMutate({ controller });
  }, [narrationMutate]);

  const requestSummary = useCallback(
    (windowMinutes: number = 60): void => {
      summaryControllerRef.current?.abort();
      const controller = new AbortController();
      summaryControllerRef.current = controller;
      summaryMutate({ controller, windowMinutes });
    },
    [summaryMutate],
  );

  const llm = useMemo(() => ({ narration, summary }), [narration, summary]);

  return { llm, requestNarration, requestSummary };
}
