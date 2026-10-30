import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmailSender, verificationSubject } from "./email-service.js";
import { enabledAuthConfig } from "./test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("console transport", () => {
  it("logs the verification email and reports success", async () => {
    const warnings: string[] = [];
    const sender = createEmailSender(enabledAuthConfig(), {
      warn: (message: string) => warnings.push(message),
      error: (message: string) => warnings.push(message),
    });

    const sent = await sender.sendVerificationEmail(
      "user@example.com",
      "654321",
      "register",
    );
    expect(sent).toBe(true);
    expect(warnings.join("\n")).toContain("EMAIL (console transport)");
    expect(warnings.join("\n")).toContain("To:      user@example.com");
    expect(warnings.join("\n")).toContain(
      `Subject: ${verificationSubject("Muses", "654321")}`,
    );
    expect(warnings.join("\n")).toContain("654321");
  });
});

describe("resend transport (native fetch)", () => {
  it("posts the branded message and returns true on success", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        capturedInit = init;
        return new Response(null, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const logs: string[] = [];
    const sender = createEmailSender(
      enabledAuthConfig({
        EMAIL_TRANSPORT: "resend",
        RESEND_API_KEY: "re_test_key",
        RESEND_FROM_EMAIL: "noreply@example.com",
        MUSES_AUTH_BRAND_NAME: "Muses Lab",
      }),
      {
        warn: (message: string) => logs.push(message),
        error: (message: string) => logs.push(message),
      },
    );

    const sent = await sender.sendVerificationEmail(
      "user@example.com",
      "654321",
      "reset",
    );
    expect(sent).toBe(true);
    const init = capturedInit;
    // AbortSignal instanceof is realm-fragile under jsdom; assert shape.
    expect(init?.signal).toBeDefined();
    expect(init?.signal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );

    expect(init?.headers).toMatchObject({
      authorization: "Bearer re_test_key",
      "content-type": "application/json",
    });
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as {
            from: string;
            html: string;
            subject: string;
            text: string;
            to: string[];
          })
        : undefined;
    expect(body?.from).toBe('"Muses Lab" <noreply@example.com>');
    expect(body?.to).toEqual(["user@example.com"]);
    expect(body?.subject).toBe(verificationSubject("Muses Lab", "654321"));
    expect(body?.html).toContain("654321");
    expect(body?.html).toContain("重置密码");
    expect(body?.text).toContain("654321");
  });

  it("returns false without calling fetch when the API key is missing", async () => {
    const fetchMock = vi.fn(
      async (
        _url: string | URL | Request,
        _init?: RequestInit,
      ): Promise<Response> => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const errors: string[] = [];
    const sender = createEmailSender(
      enabledAuthConfig({ EMAIL_TRANSPORT: "resend" }),
      {
        warn: () => undefined,
        error: (message: string) => errors.push(message),
      },
    );
    const sent = await sender.sendVerificationEmail(
      "user@example.com",
      "654321",
      "register",
    );
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("RESEND_API_KEY");
  });

  it("swallows upstream errors and network failures", async () => {
    const errors: string[] = [];
    const log = {
      warn: () => undefined,
      error: (message: string) => errors.push(message),
    };
    const config = enabledAuthConfig({
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_test_key",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          _url: string | URL | Request,
          _init?: RequestInit,
        ): Promise<Response> =>
          new Response("boom", { status: 500, statusText: "Server Error" }),
      ),
    );
    const failing = createEmailSender(config, log);
    expect(
      await failing.sendVerificationEmail("a@b.c", "111111", "register"),
    ).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          _url: string | URL | Request,
          _init?: RequestInit,
        ): Promise<Response> => {
          throw new Error("network down");
        },
      ),
    );
    const crashing = createEmailSender(config, log);
    expect(
      await crashing.sendVerificationEmail("a@b.c", "111111", "register"),
    ).toBe(false);
    expect(errors.join("\n")).toContain("Resend 发送失败");
    expect(errors.join("\n")).toContain("network down");
  });
});
