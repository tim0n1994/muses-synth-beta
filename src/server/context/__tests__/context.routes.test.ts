import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextClock } from "../model.js";
import { contextRoutes } from "../routes.js";
import { ContextEventService } from "../service.js";
import { InMemoryContextEventStore } from "./support/in-memory-context-event-store.js";

const clock: ContextClock = {
  now: () => new Date("2026-07-30T00:00:00.000Z"),
};

const applications: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

describe("context routes", () => {
  it("discloses the existing expired-raw query boundary while preventing response caching", async () => {
    const application = Fastify({ logger: false });
    applications.push(application);
    const start = Date.parse("2026-07-30T00:00:00.000Z");
    let now = start;
    const service = new ContextEventService(new InMemoryContextEventStore(), {
      clock: { now: () => new Date(now) },
    });
    await application.register(contextRoutes, { service });
    const inserted = await application.inject({
      method: "POST",
      url: "/api/v1/context/events",
      payload: {
        specversion: "1.0",
        id: "expired",
        source: "urn:test:http-privacy",
        type: "muses.editor.activity",
        ttlseconds: 1,
        data: { action: "edit", private: "synthetic-expired-payload" },
      },
    });
    expect(inserted.statusCode).toBe(202);
    expect(inserted.headers["cache-control"]).toBe("no-store");
    now += 1000;
    const normal = await application.inject("/api/v1/context/events");
    const include = await application.inject(
      "/api/v1/context/events?includeExpired=true",
    );
    const historical = await application.inject(
      `/api/v1/context/events?asOf=${encodeURIComponent(new Date(start).toISOString())}`,
    );
    const page = (response: typeof normal) =>
      response.json<{ items: Array<{ data: { private: string } }> }>();
    expect(normal.statusCode).toBe(200);
    expect(page(normal).items).toEqual([]);
    expect(include.statusCode).toBe(200);
    expect(page(include).items[0]?.data.private).toBe(
      "synthetic-expired-payload",
    );
    expect(historical.statusCode).toBe(200);
    expect(page(historical).items[0]?.data.private).toBe(
      "synthetic-expired-payload",
    );
    for (const response of [normal, include, historical])
      expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("accepts a valid structured CloudEvent and returns the same row on duplicate", async () => {
    const application = Fastify({ logger: false });
    applications.push(application);
    const service = new ContextEventService(new InMemoryContextEventStore(), {
      clock,
    });
    await application.register(contextRoutes, { service });

    const payload = {
      specversion: "1.0",
      id: "evt-1",
      source: "urn:muses:test",
      type: "muses.editor.activity",
      time: "2026-07-30T00:00:00.000Z",
      datacontenttype: "application/json",
      data: { action: "edit" },
    };
    const inserted = await application.inject({
      method: "POST",
      url: "/api/v1/context/events",
      payload,
    });
    const duplicate = await application.inject({
      method: "POST",
      url: "/api/v1/context/events",
      payload,
    });

    expect(inserted.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      duplicate: true,
      event: { serverSequence: 1 },
    });
  });

  it("rejects malformed known event data", async () => {
    const application = Fastify({ logger: false });
    applications.push(application);
    const service = new ContextEventService(new InMemoryContextEventStore(), {
      clock,
    });
    await application.register(contextRoutes, { service });

    const response = await application.inject({
      method: "POST",
      url: "/api/v1/context/events",
      payload: {
        specversion: "1.0",
        id: "evt-1",
        source: "urn:muses:test",
        type: "muses.test.run.completed",
        data: { status: "maybe" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "CONTEXT_INVALID_EVENT" },
    });
  });
});
