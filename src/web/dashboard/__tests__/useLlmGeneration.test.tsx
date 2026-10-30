// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../../foundation/query-client";
import { createTranslator } from "../../i18n";
import { DashboardApiError } from "../api";
import { useLlmGeneration } from "../hooks/useLlmGeneration";
import type { DashboardApi, LlmTextResult } from "../types";

const narrationResult: LlmTextResult = {
  text: "Focused editor work.",
  model: "auto",
  generatedAt: "2026-10-19T10:05:00.000Z",
};

function createApi(overrides: Partial<DashboardApi> = {}): DashboardApi & {
  calls: { narration: AbortSignal[]; summary: [number, AbortSignal][] };
} {
  const calls = {
    narration: [] as AbortSignal[],
    summary: [] as [number, AbortSignal][],
  };
  return {
    calls,
    getSnapshot: vi.fn(),
    getEvents: vi.fn(),
    postEffectOutcome: vi.fn(),
    postLlmNarration: vi.fn((signal: AbortSignal) => {
      calls.narration.push(signal);
      return Promise.resolve(narrationResult);
    }),
    postLlmSummary: vi.fn((windowMinutes: number, signal: AbortSignal) => {
      calls.summary.push([windowMinutes, signal]);
      return Promise.resolve({
        ...narrationResult,
        text: "An hour of steady work.",
      });
    }),
    ...overrides,
  };
}

function renderHookWithClient(api: DashboardApi) {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    (clientArg: DashboardApi) =>
      useLlmGeneration(clientArg, createTranslator("en")),
    {
      wrapper,
      initialProps: api,
    },
  );
}

describe("useLlmGeneration", () => {
  it("starts idle and completes a narration with the parsed result", async () => {
    const api = createApi();
    const { result } = renderHookWithClient(api);

    expect(result.current.llm).toMatchObject({
      narration: { status: "idle" },
      summary: { status: "idle" },
    });

    act(() => result.current.requestNarration());
    expect(result.current.llm.narration.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.llm.narration.status).toBe("done");
    });
    expect(result.current.llm.narration.text).toBe("Focused editor work.");
    expect(result.current.llm.narration.model).toBe("auto");
    expect(api.calls.narration).toHaveLength(1);
    expect(api.calls.narration[0]).toBeInstanceOf(AbortSignal);
  });

  it("forwards the summary window, defaulting to sixty minutes", async () => {
    const api = createApi();
    const { result } = renderHookWithClient(api);

    act(() => result.current.requestSummary(90));
    await waitFor(() => {
      expect(result.current.llm.summary.status).toBe("done");
    });

    act(() => result.current.requestSummary());
    await waitFor(() => {
      expect(api.calls.summary).toHaveLength(2);
    });
    expect(api.calls.summary.map(([minutes]) => minutes)).toEqual([90, 60]);
  });

  it("surfaces a clamped error message and never retries", async () => {
    let attempts = 0;
    const api = createApi({
      postLlmNarration: vi.fn(() => {
        attempts += 1;
        return Promise.reject(
          new DashboardApiError({
            kind: "http",
            message: `${"e".repeat(400)}`,
            statusCode: 503,
            retryable: true,
          }),
        );
      }),
    });
    const { result } = renderHookWithClient(api);

    act(() => result.current.requestNarration());
    await waitFor(() => {
      expect(result.current.llm.narration.status).toBe("error");
    });

    expect(result.current.llm.narration.error).toHaveLength(280);
    // The global mutations.retry: false default must hold — one attempt,
    // even for a retryable-looking 503 (the server already retried once).
    expect(attempts).toBe(1);
  });
});
