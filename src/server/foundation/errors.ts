import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

export interface ErrorIssue {
  readonly message: string;
  readonly path: string;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly issues?: readonly ErrorIssue[];
    readonly message: string;
    readonly requestId: string;
  };
}

export class MusesHttpError extends Error {
  readonly code: string;
  readonly expose: boolean;
  readonly issues: readonly ErrorIssue[] | undefined;
  readonly statusCode: number;

  constructor(options: {
    code: string;
    expose?: boolean;
    issues?: readonly ErrorIssue[];
    message: string;
    statusCode: number;
  }) {
    super(options.message);
    this.name = "MusesHttpError";
    this.code = options.code;
    this.expose = options.expose ?? options.statusCode < 500;
    this.issues = options.issues;
    this.statusCode = options.statusCode;
  }
}

interface FastifyValidationIssue {
  readonly instancePath?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

function isValidationError(error: FastifyError): error is FastifyError & {
  validation: readonly FastifyValidationIssue[];
} {
  return Array.isArray(error.validation);
}

function validationIssues(
  error: FastifyError,
): readonly ErrorIssue[] | undefined {
  if (!isValidationError(error)) {
    return undefined;
  }

  return error.validation.map((issue) => ({
    message: issue.message ?? "Value is invalid",
    path:
      issue.instancePath === "" || issue.instancePath === undefined
        ? "/"
        : issue.instancePath,
  }));
}

function normalizeFastifyError(error: FastifyError): MusesHttpError {
  if (error instanceof MusesHttpError) {
    return error;
  }

  if (isValidationError(error)) {
    const issues = validationIssues(error);
    return new MusesHttpError({
      code: "VALIDATION_FAILED",
      ...(issues === undefined ? {} : { issues }),
      message: "Request validation failed",
      statusCode: 400,
    });
  }

  if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return new MusesHttpError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json",
      statusCode: 415,
    });
  }

  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return new MusesHttpError({
      code: "BODY_TOO_LARGE",
      message: "Request body exceeds the configured limit",
      statusCode: 413,
    });
  }

  if (
    error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
    error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
  ) {
    return new MusesHttpError({
      code: "INVALID_JSON",
      message: "Request body must be valid JSON",
      statusCode: 400,
    });
  }

  return new MusesHttpError({
    code: "INTERNAL_ERROR",
    expose: false,
    message: error.message,
    statusCode: typeof error.statusCode === "number" ? error.statusCode : 500,
  });
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: MusesHttpError,
  production: boolean,
): FastifyReply {
  const publicMessage =
    error.expose && (!production || error.statusCode < 500)
      ? error.message
      : "An unexpected error occurred";

  const envelope: ErrorEnvelope = {
    error: {
      code: error.code,
      ...(error.issues === undefined ? {} : { issues: error.issues }),
      message: publicMessage,
      requestId: request.id,
    },
  };

  return reply.status(error.statusCode).send(envelope);
}

export function installErrorHandling(
  app: FastifyInstance,
  production: boolean,
): void {
  app.setErrorHandler((rawError, request, reply) => {
    const error =
      rawError instanceof Error
        ? (rawError as FastifyError)
        : new MusesHttpError({
            code: "INTERNAL_ERROR",
            message: "Unknown error",
            statusCode: 500,
          });
    const normalized = normalizeFastifyError(error);

    if (normalized.statusCode >= 500) {
      request.log.error(
        { code: normalized.code, err: error, requestId: request.id },
        "Request failed",
      );
    } else {
      request.log.warn(
        {
          code: normalized.code,
          requestId: request.id,
          statusCode: normalized.statusCode,
        },
        "Request rejected",
      );
    }

    return sendError(reply, request, normalized, production);
  });
}

export function installNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return sendError(
      reply,
      request,
      new MusesHttpError({
        code: "NOT_FOUND",
        message: "Route not found",
        statusCode: 404,
      }),
      false,
    );
  });
}
