import type { AuthConfig } from "./config.js";
import type { AuthPurpose } from "./types.js";

/**
 * Pluggable verification email sender, ported from the mail2profile skill's
 * email_service.py.
 *
 * Deviations from the skill:
 *   - Only the console and resend transports are implemented (no smtp):
 *     Muses only needs local development and Resend.
 *   - Resend is called with native fetch (Node 22 undici) instead of
 *     httpx/the Resend SDK — zero new dependencies.
 *   - The template's validity hint is derived from CODE_TTL_SECONDS instead
 *     of the skill's hardcoded "10 分钟".
 * Brand name and sender address come from AuthConfig; nothing is hardcoded.
 *
 * Contract rule: a failed send is logged and swallowed (returns false). The
 * verification code is already persisted, so the user can retry or switch to
 * console mode — delivery failures must never block the auth flow.
 */

export interface EmailLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface VerificationEmailSender {
  sendVerificationEmail(
    toEmail: string,
    code: string,
    purpose: AuthPurpose,
  ): Promise<boolean>;
}

export function verificationSubject(brandName: string, code: string): string {
  return `【${brandName}】你的验证码：${code}`;
}

function purposeLabel(purpose: AuthPurpose): string {
  return purpose === "register" ? "注册账号" : "重置密码";
}

function validityHint(codeTtlSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(codeTtlSeconds / 60));
  return `验证码 ${minutes} 分钟内有效。如果不是你本人操作，请忽略此邮件。`;
}

export function verificationHtml(input: {
  brandName: string;
  code: string;
  purpose: AuthPurpose;
  codeTtlSeconds: number;
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
             max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h2 style="margin:0 0 16px;font-size:18px;">${input.brandName} 验证码</h2>
  <p style="margin:0 0 8px;color:#555;font-size:14px;">
    你正在进行<strong>${purposeLabel(input.purpose)}</strong>操作，验证码为：
  </p>
  <div style="margin:16px 0;padding:16px 20px;background:#f5f5f5;border-radius:8px;text-align:center;">
    <span style="font-size:32px;font-weight:600;letter-spacing:8px;font-family:monospace;">${input.code}</span>
  </div>
  <p style="margin:0 0 4px;color:#888;font-size:12px;">${validityHint(input.codeTtlSeconds)}</p>
  <p style="margin:16px 0 0;color:#bbb;font-size:11px;">— ${input.brandName}</p>
</body>
</html>`;
}

export function verificationText(input: {
  brandName: string;
  code: string;
  purpose: AuthPurpose;
  codeTtlSeconds: number;
}): string {
  return [
    `${input.brandName} 验证码`,
    "",
    `你正在进行「${purposeLabel(input.purpose)}」操作。`,
    `验证码：${input.code}`,
    "",
    validityHint(input.codeTtlSeconds),
    "",
  ].join("\n");
}

function createConsoleSender(
  config: AuthConfig,
  log: EmailLogger,
): VerificationEmailSender {
  return {
    // Synchronous transport: log the full message and report success.
    sendVerificationEmail(
      toEmail: string,
      code: string,
      purpose: AuthPurpose,
    ): Promise<boolean> {
      const text = verificationText({
        brandName: config.brandName,
        code,
        purpose,
        codeTtlSeconds: config.codeTtlSeconds,
      });
      log.warn("============================================================");
      log.warn("EMAIL (console transport)");
      log.warn(`To:      ${toEmail}`);
      log.warn(`Subject: ${verificationSubject(config.brandName, code)}`);
      log.warn(`Text:    ${text.replaceAll("\n", " | ")}`);
      log.warn("============================================================");
      return Promise.resolve(true);
    },
  };
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15_000;

function createResendSender(
  config: AuthConfig,
  log: EmailLogger,
): VerificationEmailSender {
  return {
    async sendVerificationEmail(
      toEmail: string,
      code: string,
      purpose: AuthPurpose,
    ): Promise<boolean> {
      if (config.resendApiKey === "") {
        log.error("RESEND_API_KEY 未配置，无法通过 Resend 发送邮件");
        return false;
      }
      try {
        const response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.resendApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: `"${config.brandName}" <${config.resendFromEmail}>`,
            to: [toEmail],
            subject: verificationSubject(config.brandName, code),
            html: verificationHtml({
              brandName: config.brandName,
              code,
              purpose,
              codeTtlSeconds: config.codeTtlSeconds,
            }),
            text: verificationText({
              brandName: config.brandName,
              code,
              purpose,
              codeTtlSeconds: config.codeTtlSeconds,
            }),
          }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 200);
          log.error(
            `Resend 发送失败 (${response.status}): ${detail} to=${toEmail}`,
          );
          return false;
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`验证码邮件发送失败 to=${toEmail}: ${message}`);
        return false;
      }
    },
  };
}

export function createEmailSender(
  config: AuthConfig,
  log: EmailLogger,
): VerificationEmailSender {
  if (config.emailTransport === "resend") {
    return createResendSender(config, log);
  }
  return createConsoleSender(config, log);
}
