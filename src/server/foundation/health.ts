import type { FastifyPluginAsync } from "fastify";

export interface HealthResponse {
  readonly service: "muses";
  readonly status: "ok";
  readonly uptimeSeconds: number;
  readonly version: string;
}

export interface HealthRouteOptions {
  readonly version: string;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  options,
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify identifies async plugins at runtime.
) => {
  app.get("/api/health", (_request, reply): HealthResponse => {
    reply.header("cache-control", "no-store");
    return {
      service: "muses",
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      version: options.version,
    };
  });
};
