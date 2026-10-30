import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { Type, type Static } from "@sinclair/typebox";

import { MusesHttpError } from "../foundation/errors.js";
import type { AuthService } from "./auth-service.js";
import type { AuthConfig } from "./config.js";
import { installAuthErrorHandling, requireUser } from "./http.js";
import {
  CONTRACT_RATE_LIMITS,
  RateLimiter,
  clientRateKey,
  type RateLimitRule,
} from "./ratelimit.js";
import type { PublicUser } from "./types.js";

/**
 * /api/auth/* routes, a port of the mail2profile skill's FastAPI router.
 * Endpoint contract (body shapes, status codes, rate limits) is preserved
 * verbatim: send-code 5/60s, register 5/60s, login 10/60s, reset-password
 * 5/60s — all per client IP. Responses use the Muses error envelope.
 */

export interface AuthRoutesOptions {
  readonly service: AuthService;
  readonly config: AuthConfig;
  readonly limiter?: RateLimiter;
  readonly prefix?: string;
}

const SendCodeBodySchema = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 320 }),
    purpose: Type.Optional(
      Type.Union([Type.Literal("register"), Type.Literal("reset")]),
    ),
  },
  { additionalProperties: false },
);
type SendCodeBody = Static<typeof SendCodeBodySchema>;

const RegisterBodySchema = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 320 }),
    code: Type.String({ minLength: 4, maxLength: 8 }),
    password: Type.String({ minLength: 6, maxLength: 128 }),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
type RegisterBody = Static<typeof RegisterBodySchema>;

const LoginBodySchema = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
type LoginBody = Static<typeof LoginBodySchema>;

const ResetPasswordBodySchema = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 320 }),
    code: Type.String({ minLength: 4, maxLength: 8 }),
    newPassword: Type.String({ minLength: 6, maxLength: 128 }),
  },
  { additionalProperties: false },
);
type ResetPasswordBody = Static<typeof ResetPasswordBodySchema>;

const UpdateMeBodySchema = Type.Object(
  {
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);
type UpdateMeBody = Static<typeof UpdateMeBodySchema>;

const ChangePasswordBodySchema = Type.Object(
  {
    oldPassword: Type.String({ minLength: 1, maxLength: 128 }),
    newPassword: Type.String({ minLength: 6, maxLength: 128 }),
  },
  { additionalProperties: false },
);
type ChangePasswordBody = Static<typeof ChangePasswordBodySchema>;

interface SendCodeResponse {
  status: string;
  devCode?: string;
}

/**
 * Fastify's request-hook runner only advances when a hook returns a promise
 * OR invokes its done() callback — a plain synchronous function would
 * deadlock the request. So these preHandlers are callback-style hooks.
 */
function rateLimitPreHandler(
  limiter: RateLimiter,
  name: string,
  rule: RateLimitRule,
): preHandlerHookHandler {
  return (request, _reply, done) => {
    if (
      !limiter.hit(
        `${name}:${clientRateKey(request)}`,
        rule.limit,
        rule.windowSeconds,
      )
    ) {
      done(
        new MusesHttpError({
          code: "AUTH_RATE_LIMITED",
          message: `请求过于频繁，请 ${rule.windowSeconds} 秒后重试`,
          statusCode: 429,
        }),
      );
      return;
    }
    done();
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const MAX_PROFILE_SETTINGS_BYTES = 16 * 1024;

  const prefix = options.prefix ?? "/api/auth";
  const limiter = options.limiter ?? new RateLimiter();
  installAuthErrorHandling(fastify);

  fastify.post<{ Body: SendCodeBody }>(
    `${prefix}/send-code`,
    {
      schema: { body: SendCodeBodySchema },
      preHandler: rateLimitPreHandler(
        limiter,
        "send-code",
        CONTRACT_RATE_LIMITS.sendCode,
      ),
    },
    async (request, reply) => {
      const purpose = request.body.purpose ?? "register";
      const code = await options.service.createAndSendCode(
        request.body.email,
        purpose,
      );
      const response: SendCodeResponse = { status: "sent" };
      // Production never echoes the code; dev+console does, for local flows.
      if (options.config.devCodeEchoEnabled) {
        response.devCode = code;
      }
      return reply.send(response);
    },
  );

  fastify.post<{ Body: RegisterBody }>(
    `${prefix}/register`,
    {
      schema: { body: RegisterBodySchema },
      preHandler: rateLimitPreHandler(
        limiter,
        "register",
        CONTRACT_RATE_LIMITS.register,
      ),
    },
    (request) => {
      const session = options.service.registerUserVerified(
        request.body.email,
        request.body.code,
        request.body.password,
        request.body.displayName,
      );
      return { user: session.user, token: session.token };
    },
  );

  fastify.post<{ Body: LoginBody }>(
    `${prefix}/login`,
    {
      schema: { body: LoginBodySchema },
      preHandler: rateLimitPreHandler(
        limiter,
        "login",
        CONTRACT_RATE_LIMITS.login,
      ),
    },
    (request) => {
      const session = options.service.loginUser(
        request.body.email,
        request.body.password,
      );
      return { user: session.user, token: session.token };
    },
  );

  fastify.post<{ Body: ResetPasswordBody }>(
    `${prefix}/reset-password`,
    {
      schema: { body: ResetPasswordBodySchema },
      preHandler: rateLimitPreHandler(
        limiter,
        "reset-password",
        CONTRACT_RATE_LIMITS.resetPassword,
      ),
    },
    (request) => {
      options.service.resetPasswordVerified(
        request.body.email,
        request.body.code,
        request.body.newPassword,
      );
      return { status: "ok" };
    },
  );

  fastify.get(`${prefix}/me`, (request): { user: PublicUser } => {
    return { user: requireUser(request, options.service) };
  });

  fastify.put<{ Body: UpdateMeBody }>(
    `${prefix}/me`,
    { schema: { body: UpdateMeBodySchema } },
    (request): { user: PublicUser } => {
      const user = requireUser(request, options.service);
      const settings = request.body.settings ?? null;
      if (
        settings !== null &&
        JSON.stringify(settings).length > MAX_PROFILE_SETTINGS_BYTES
      ) {
        throw new MusesHttpError({
          code: "AUTH_SETTINGS_TOO_LARGE",
          message: "Profile settings exceed the 16 KiB limit",
          statusCode: 400,
        });
      }
      const updated = options.service.updateProfile(
        user.id,
        request.body.displayName ?? null,
        settings,
      );
      return { user: updated };
    },
  );

  fastify.put<{ Body: ChangePasswordBody }>(
    `${prefix}/me/password`,
    { schema: { body: ChangePasswordBodySchema } },
    (request) => {
      const user = requireUser(request, options.service);
      options.service.changePassword(
        user.id,
        request.body.oldPassword,
        request.body.newPassword,
      );
      return { status: "ok" };
    },
  );
};
