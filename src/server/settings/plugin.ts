import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { Type, type Static } from "@sinclair/typebox";

import {
  SettingsConflictError,
  SettingsIntegrityError,
  SettingsNotFoundError,
  SettingsValidationError,
} from "./errors.js";
import type {
  SettingsDraft,
  SettingsHistoryEntry,
  SettingsPreview,
  SettingsRelease,
  SettingsRepository,
} from "./repository.js";
import { SettingsDocumentSchema } from "./schema.js";

const ErrorResponseSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

const DraftSchema = Type.Object(
  {
    id: Type.Literal("primary"),
    baseReleaseId: Type.Union([Type.String(), Type.Null()]),
    revision: Type.Integer({ minimum: 1 }),
    schemaVersion: Type.Integer({ minimum: 1 }),
    document: SettingsDocumentSchema,
    checksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);

const ReleaseSchema = Type.Object(
  {
    id: Type.String(),
    releaseNumber: Type.Integer({ minimum: 1 }),
    parentReleaseId: Type.Union([Type.String(), Type.Null()]),
    rollbackOfReleaseId: Type.Union([Type.String(), Type.Null()]),
    sourceDraftRevision: Type.Integer({ minimum: 1 }),
    schemaVersion: Type.Integer({ minimum: 1 }),
    document: SettingsDocumentSchema,
    checksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    actor: Type.String(),
    reason: Type.String(),
    publishedAt: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

const HistorySchema = Type.Object(
  {
    id: Type.String(),
    action: Type.Union([
      Type.Literal("SEED"),
      Type.Literal("DRAFT_UPDATED"),
      Type.Literal("PUBLISHED"),
      Type.Literal("ROLLED_BACK"),
    ]),
    draftRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    releaseId: Type.Union([Type.String(), Type.Null()]),
    targetReleaseId: Type.Union([Type.String(), Type.Null()]),
    checksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    actor: Type.String(),
    reason: Type.String(),
    metadata: Type.Record(Type.String(), Type.Unknown()),
    occurredAt: Type.String(),
  },
  { additionalProperties: false },
);

const UpdateDraftBodySchema = Type.Object(
  {
    actor: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 }),
    expectedRevision: Type.Integer({ minimum: 1 }),
    document: SettingsDocumentSchema,
  },
  { additionalProperties: false },
);
type UpdateDraftBody = Static<typeof UpdateDraftBodySchema>;

const PreviewBodySchema = Type.Object(
  {
    document: SettingsDocumentSchema,
    againstReleaseId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
  },
  { additionalProperties: false },
);
type PreviewBody = Static<typeof PreviewBodySchema>;

const PublishBodySchema = Type.Object(
  {
    actor: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 }),
    expectedDraftRevision: Type.Integer({ minimum: 1 }),
    expectedDraftChecksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
type PublishBody = Static<typeof PublishBodySchema>;

const RollbackBodySchema = Type.Object(
  {
    actor: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 }),
    expectedCurrentReleaseId: Type.String({ minLength: 1, maxLength: 128 }),
    expectedDraftRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
type RollbackBody = Static<typeof RollbackBodySchema>;

const ReleaseParamsSchema = Type.Object(
  { releaseId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);
type ReleaseParams = Static<typeof ReleaseParamsSchema>;

const LimitQuerySchema = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) },
  { additionalProperties: false },
);
type LimitQuery = Static<typeof LimitQuerySchema>;

const PreviewResponseSchema = Type.Object(
  {
    valid: Type.Literal(true),
    checksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    againstReleaseId: Type.String(),
    againstChecksum: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    changedPaths: Type.Array(Type.String()),
    changed: Type.Boolean(),
    document: SettingsDocumentSchema,
  },
  { additionalProperties: false },
);

export interface SettingsPluginOptions {
  readonly repository: SettingsRepository;
}

interface ErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

function sendDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SettingsValidationError) {
    const body: ErrorResponse = {
      code: "SETTINGS_VALIDATION_FAILED",
      message: error.message,
      details: { issues: error.issues },
    };
    return reply.code(422).send(body);
  }
  if (error instanceof SettingsConflictError) {
    const body: ErrorResponse = {
      code: "SETTINGS_CONFLICT",
      message: error.message,
      details: {
        field: error.field,
        expected: error.expected,
        actual: error.actual,
      },
    };
    return reply.code(409).send(body);
  }
  if (error instanceof SettingsNotFoundError) {
    const body: ErrorResponse = {
      code: "SETTINGS_NOT_FOUND",
      message: error.message,
      details: { resource: error.resource, id: error.id },
    };
    return reply.code(404).send(body);
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    const body: ErrorResponse = {
      code: "INVALID_REQUEST",
      message: error.message,
    };
    return reply.code(400).send(body);
  }
  if (error instanceof SettingsIntegrityError) {
    const body: ErrorResponse = {
      code: "SETTINGS_STORAGE_INTEGRITY_ERROR",
      message: "Settings storage integrity check failed",
    };
    return reply.code(500).send(body);
  }
  throw error;
}

const errorResponses = {
  400: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  422: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

export const settingsRoutesPlugin: FastifyPluginAsync<
  SettingsPluginOptions
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
> = async (fastify, options): Promise<void> => {
  const repository = options.repository;

  fastify.setErrorHandler((rawError: unknown, _request, reply): void => {
    if (
      rawError &&
      typeof rawError === "object" &&
      "validation" in rawError &&
      (rawError as { validation?: unknown }).validation !== undefined
    ) {
      const body: ErrorResponse = {
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        details: { issues: rawError.validation },
      };
      void reply.code(400).send(body);
      return;
    }
    throw rawError;
  });

  fastify.get(
    "/settings",
    {
      schema: {
        response: {
          200: Type.Object(
            { draft: DraftSchema, currentRelease: ReleaseSchema },
            { additionalProperties: false },
          ),
          ...errorResponses,
        },
      },
    },
    async (
      _request,
      reply,
    ): Promise<
      { draft: SettingsDraft; currentRelease: SettingsRelease } | FastifyReply
    > => {
      try {
        return {
          draft: repository.getDraft(),
          currentRelease: repository.getCurrentRelease(),
        };
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.get(
    "/settings/draft",
    { schema: { response: { 200: DraftSchema, ...errorResponses } } },
    async (_request, reply): Promise<SettingsDraft | FastifyReply> => {
      try {
        return repository.getDraft();
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.put<{ Body: UpdateDraftBody }>(
    "/settings/draft",
    {
      schema: {
        body: UpdateDraftBodySchema,
        response: { 200: DraftSchema, ...errorResponses },
      },
    },
    async (request, reply): Promise<SettingsDraft | FastifyReply> => {
      try {
        return repository.updateDraft({
          ...request.body,
          correlationId: request.id,
        });
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.post<{ Body: PreviewBody }>(
    "/settings/preview",
    {
      schema: {
        body: PreviewBodySchema,
        response: { 200: PreviewResponseSchema, ...errorResponses },
      },
    },
    async (request, reply): Promise<SettingsPreview | FastifyReply> => {
      try {
        return repository.preview(request.body);
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.post<{ Body: PublishBody }>(
    "/settings/publish",
    {
      schema: {
        body: PublishBodySchema,
        response: {
          201: Type.Object(
            { release: ReleaseSchema, draft: DraftSchema },
            { additionalProperties: false },
          ),
          ...errorResponses,
        },
      },
    },
    async (request, reply): Promise<FastifyReply> => {
      try {
        const result = repository.publishDraft({
          ...request.body,
          correlationId: request.id,
        });
        return reply.code(201).send(result);
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.get<{ Querystring: LimitQuery }>(
    "/settings/releases",
    {
      schema: {
        querystring: LimitQuerySchema,
        response: { 200: Type.Array(ReleaseSchema), ...errorResponses },
      },
    },
    async (
      request,
      reply,
    ): Promise<readonly SettingsRelease[] | FastifyReply> => {
      try {
        return repository.listReleases(request.query.limit ?? 50);
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.get<{ Params: ReleaseParams }>(
    "/settings/releases/:releaseId",
    {
      schema: {
        params: ReleaseParamsSchema,
        response: { 200: ReleaseSchema, ...errorResponses },
      },
    },
    async (request, reply): Promise<SettingsRelease | FastifyReply> => {
      try {
        return repository.getRelease(request.params.releaseId);
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.get<{ Querystring: LimitQuery }>(
    "/settings/history",
    {
      schema: {
        querystring: LimitQuerySchema,
        response: { 200: Type.Array(HistorySchema), ...errorResponses },
      },
    },
    async (
      request,
      reply,
    ): Promise<readonly SettingsHistoryEntry[] | FastifyReply> => {
      try {
        return repository.listHistory(request.query.limit ?? 100);
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );

  fastify.post<{ Params: ReleaseParams; Body: RollbackBody }>(
    "/settings/releases/:releaseId/rollback",
    {
      schema: {
        params: ReleaseParamsSchema,
        body: RollbackBodySchema,
        response: {
          201: Type.Object(
            { release: ReleaseSchema, draft: DraftSchema },
            { additionalProperties: false },
          ),
          ...errorResponses,
        },
      },
    },
    async (request, reply): Promise<FastifyReply> => {
      try {
        const result = repository.rollback({
          targetReleaseId: request.params.releaseId,
          ...request.body,
          correlationId: request.id,
        });
        return reply.code(201).send(result);
      } catch (error: unknown) {
        return sendDomainError(reply, error);
      }
    },
  );
};
