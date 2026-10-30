import type { FastifyPluginAsync } from "fastify";
import { Type, type Static } from "@sinclair/typebox";

import { MusesHttpError } from "../foundation/errors.js";
import type { AuthService } from "./auth-service.js";
import { installAuthErrorHandling, requireAdmin } from "./http.js";
import type { AdminUserView } from "./types.js";

/**
 * /api/admin/* routes, a port of the mail2profile skill's admin_router.
 * Every endpoint requires an admin role (403 otherwise); deleting yourself
 * is rejected with 400 so an administrator cannot lock themselves out.
 *
 * Deviation: reportCount is always 0 — the skill's ResourceHooks
 * (count_user_resources / on_user_deleted) are not ported because Muses has
 * no per-user business resources to count or cascade.
 */

export interface AdminRoutesOptions {
  readonly service: AuthService;
  readonly prefix?: string;
}

const ListUsersQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);
type ListUsersQuery = Static<typeof ListUsersQuerySchema>;

const UpdateUserBodySchema = Type.Object(
  { isActive: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
type UpdateUserBody = Static<typeof UpdateUserBodySchema>;

interface UserParams {
  readonly userId: string;
}

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (
  fastify,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  const prefix = options.prefix ?? "/api/admin";
  installAuthErrorHandling(fastify);

  fastify.get<{ Querystring: ListUsersQuery }>(
    `${prefix}/users`,
    { schema: { querystring: ListUsersQuerySchema } },
    (request): { users: readonly AdminUserView[] } => {
      requireAdmin(request, options.service);
      const limit = request.query.limit ?? 100;
      return { users: options.service.listUsers(limit) };
    },
  );

  fastify.get<{ Params: UserParams }>(
    `${prefix}/users/:userId`,
    (request): { user: ReturnType<AuthService["getUserById"]> } => {
      requireAdmin(request, options.service);
      const user = options.service.getUserById(request.params.userId);
      if (user === null) {
        throw new MusesHttpError({
          code: "AUTH_USER_NOT_FOUND",
          message: "用户未找到",
          statusCode: 404,
        });
      }
      return { user };
    },
  );

  fastify.patch<{ Body: UpdateUserBody; Params: UserParams }>(
    `${prefix}/users/:userId`,
    { schema: { body: UpdateUserBodySchema } },
    (request) => {
      requireAdmin(request, options.service);
      if (request.body.isActive === undefined) {
        throw new MusesHttpError({
          code: "AUTH_NO_UPDATE_FIELDS",
          message: "未提供可更新字段",
          statusCode: 400,
        });
      }
      const user = options.service.setUserActive(
        request.params.userId,
        request.body.isActive,
      );
      if (user === null) {
        throw new MusesHttpError({
          code: "AUTH_USER_NOT_FOUND",
          message: "用户未找到",
          statusCode: 404,
        });
      }
      return { user };
    },
  );

  fastify.delete<{ Params: UserParams }>(
    `${prefix}/users/:userId`,
    (request) => {
      const admin = requireAdmin(request, options.service);
      if (request.params.userId === admin.id) {
        throw new MusesHttpError({
          code: "AUTH_SELF_DELETE",
          message: "不能删除当前登录的管理员账号",
          statusCode: 400,
        });
      }
      if (!options.service.deleteUser(request.params.userId)) {
        throw new MusesHttpError({
          code: "AUTH_USER_NOT_FOUND",
          message: "用户未找到",
          statusCode: 404,
        });
      }
      return { status: "deleted" };
    },
  );
};
