import { resolve } from "node:path";

import { Value } from "@sinclair/typebox/value";
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";

import {
  openDatabase,
  runMigrations,
  systemClock,
  type OpenDatabaseResult,
} from "../db/index.js";
import { ContextEventService } from "../context/service.js";
import {
  createRetentionMaintenance,
  unsupportedPrivacyChanged,
  unsupportedPrivacyControls,
} from "../context/privacy.js";
import type { SettingsDocument } from "../settings/schema.js";
import { SettingsNotFoundError } from "../settings/errors.js";
import { SqliteContextEventStore } from "../context/sqlite-context-event-store.js";
import {
  createEffectRoutes,
  EffectLedgerService,
  SqliteEffectRepository,
} from "../effects/index.js";
import type { LlmEnvironment } from "../llm/capability.js";
import { LlmGatewayClient } from "../llm/gateway-client.js";
import { llmRoutes } from "../llm/routes.js";
import { LlmService } from "../llm/service.js";
import { createDecisionRoutes } from "../policy/routes.js";
import {
  DeterministicPolicyEngine,
  PolicyService,
  SqliteDecisionRepository,
} from "../policy/index.js";
import { settingsRoutesPlugin } from "../settings/index.js";
import { selfTrackCatalog } from "../library/tracks-store.js";
import { catalogFromLibraryBuckets } from "../journey/model.js";
import { buildJourneyModule } from "../journey/module.js";
import type { SqliteDatabasePort as JourneyDatabasePort } from "../journey/sqlite-journey-repository.js";
import { createSelfTrackPlanModule } from "../self-track/module.js";
import {
  createVibeSignalModule,
  isVibeSignalEnabled,
} from "../vibe-signal/module.js";
import { SettingsRepository } from "../settings/repository.js";
import { LanguageCodeSchema, type LanguageCode } from "../settings/schema.js";
import { beliefRoutes } from "../belief/routes.js";
import { contextRoutes } from "../context/routes.js";
import { createBootstrapRoutes } from "../observatory/routes.js";
import { AutomationOrchestrator } from "./automation.js";
import {
  createV07AccessPolicy,
  isTruthyFeatureFlag,
  isV07ApiPath,
  parseV07Users,
  type V07AccessPolicy,
} from "./feature-flags.js";
import { createV07FeaturesModule } from "../v07/features.js";
import { PerUserRuntimes, type ScopedBeliefView } from "./per-user-runtimes.js";
import type { SqliteDatabasePort as EffectDatabasePort } from "../effects/sqlite-effect-repository.js";
import type { SqliteDatabasePort as DecisionDatabasePort } from "../policy/sqlite-decision-repository.js";
import type { SqliteDatabasePort as ContextDatabasePort } from "../context/sqlite-context-event-store.js";
import type { SqliteStatementPort } from "../context/sqlite-context-event-store.js";
import type { BootstrapRoutesOptions } from "../observatory/routes.js";
import { AuthConfig } from "../auth/config.js";
import { createAuthModule } from "../auth/module.js";
import type { FoundationModule } from "./create-app.js";

/**
 * Default path for the local SQLite authority file. Lives next to the repo so a
 * developer can inspect it, but is gitignored (*.sqlite / *.db) and never
 * shipped.
 */
const DEFAULT_DATABASE_PATH = resolve(process.cwd(), ".muses/muses.sqlite");

/**
 * The single mutable handle to the opened database so it can be closed on
 * shutdown. Held outside the Fastify instance because the process shutdown
 * handler runs after listen() has torn down.
 */
let openedDatabase: OpenDatabaseResult | null = null;

interface UserSettingsRow {
  readonly settings_json: string;
}

/**
 * Resolves the narration language the given user explicitly configured in
 * their auth profile (users.settings_json, written by PUT /api/auth/me).
 * Reads the raw JSON rather than the PublicUser's parsed settings so "the
 * user never set a language" can fall back to the published global settings
 * document instead of silently selecting the schema default. The statement
 * is prepared lazily: with auth disabled the users table never exists and
 * the resolver is never called; a prepare failure pins null and the global
 * language keeps being used.
 */
export const createUserLanguageResolver = (
  database: ContextDatabasePort,
): ((userId: string) => LanguageCode | undefined) => {
  let statement: SqliteStatementPort | null | undefined;
  return (userId: string): LanguageCode | undefined => {
    if (statement === undefined) {
      try {
        statement = database.prepare(
          "SELECT settings_json FROM users WHERE id = ?",
        );
      } catch {
        statement = null;
      }
    }
    if (statement === null || statement === undefined) {
      return undefined;
    }
    const row = statement.get(userId) as UserSettingsRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(row.settings_json);
      if (typeof parsed !== "object" || parsed === null) {
        return undefined;
      }
      const appearance = (parsed as { appearance?: unknown }).appearance;
      if (typeof appearance !== "object" || appearance === null) {
        return undefined;
      }
      const language = (appearance as { language?: unknown }).language;
      if (
        typeof language === "string" &&
        Value.Check(LanguageCodeSchema, language)
      ) {
        return language;
      }
    } catch {
      // Malformed profile JSON — narrate in the global language.
    }
    return undefined;
  };
};

export interface BuildRuntimeModulesOptions {
  /**
   * Parsed LLM environment (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL). Null or
   * omitted means the optional enhancement is unconfigured: the routes stay
   * registered (they answer 503 LLM_NOT_CONFIGURED) and every existing
   * behavior is untouched.
   */
  readonly llmEnv?: LlmEnvironment | null;
  /**
   * Auth module configuration. Undefined reads the environment via
   * AuthConfig.fromEnv() (MUSES_AUTH_ENABLED and friends); null forces the
   * module off regardless of the environment; an enabled instance appends
   * the auth module (bearer gate + /api/auth/* + /api/admin/*) sharing the
   * same SQLite database. Disabled means byte-for-byte the previous module
   * graph — the local mode regression guarantee.
   */
  readonly auth?: AuthConfig | null;
}

/**
 * Builds the full production dependency graph on top of one SQLite database:
 * context store -> belief reader -> belief service, and effect/policy/settings
 * repositories, each owning their tables. Returns the FoundationModule list
 * createApp expects plus a close() hook for graceful shutdown.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- graph construction is synchronous; callers may await this for future DB-backed deps.
export async function buildRuntimeModules(
  options: BuildRuntimeModulesOptions = {},
): Promise<{
  readonly modules: readonly FoundationModule[];
  /** Per-user shard registry; exposed for cache-metrics assertions and ops. */
  readonly perUserRuntimes: PerUserRuntimes;
  /**
   * The v0.7 per-user access policy (MUSES_V07_USERS x the auth decision).
   * createApp hands it to the SPA-shell layer so the client hint and the
   * bearer-gate concealment judge the same allowlist.
   */
  readonly v07Access: V07AccessPolicy;
  readonly close: () => Promise<void>;
}> {
  const databasePath = process.env.MUSES_DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  openedDatabase = openDatabase(databasePath);

  runMigrations(openedDatabase.connection, { purpose: "application-startup" });

  // better-sqlite3's Database.prepare() returns a per-statement inferred
  // Statement<BindParameters> tuple, which structurally satisfies each repo's
  // own SqliteDatabasePort at runtime but not under the strict tuple types; cast
  // once at the boundary rather than weakening the port signatures.
  const contextDb = openedDatabase.connection as unknown as ContextDatabasePort;
  const effectDb = openedDatabase.connection as unknown as EffectDatabasePort;
  const decisionDb =
    openedDatabase.connection as unknown as DecisionDatabasePort;

  const contextStore = new SqliteContextEventStore(contextDb);
  const effectRepository = new SqliteEffectRepository(effectDb);
  const effectLedger = new EffectLedgerService(effectRepository);
  const decisionRepository = new SqliteDecisionRepository(decisionDb);
  const policyEngine = new DeterministicPolicyEngine();
  const policyService = new PolicyService(policyEngine, decisionRepository);
  const settingsRepository = SettingsRepository.initialize(
    openedDatabase.connection,
  );
  const contextService = new ContextEventService(contextStore, {
    getRetentionHours: () =>
      settingsRepository.getCurrentRelease().document.privacy
        .rawEventRetentionHours,
  });

  // v0.6 personal space: per-user shards over the shared event store. Each
  // request-scoped read resolves through getFor(request.user?.id ?? null),
  // so auth-enabled hosts isolate belief/decision/effect state per account
  // while auth-disabled local mode keeps using the legacy global (null)
  // stream — the same rows v0.5 read. The shard cache keeps the dashboard
  // bootstrap O(log N): MAX(server_sequence) per user on the hot path.
  //
  // The Fastify logger does not exist yet while this graph is built, so a
  // runtime event raised outside any request handler — a belief replay that
  // had to degrade to the stream's most recent window — is logged through a
  // reference the belief module binds when it registers, which is before any
  // request (or ingest callback) can trigger a replay.
  let runtimeLog: FastifyBaseLogger | undefined;
  const retentionMaintenance = createRetentionMaintenance(
    contextService,
    (error) => {
      runtimeLog?.error(
        { err: error },
        "Context retention cleanup failed; retrying next minute",
      );
    },
  );
  // R2 memory work (2026-10-21): per-shard hydrated replay windows, byte-
  // budgeted and LRU-evicted (see PerUserRuntimes). The env knob is ops'
  // kill switch: 0 restores the pre-R2 full-window read on every projection.
  // Parsed here (not config.ts) to sit beside the other graph-affecting
  // flags this composition root reads from process.env.
  const beliefWindowCacheBytes = parseWindowCacheBytes(
    process.env.MUSES_BELIEF_WINDOW_CACHE_BYTES,
  );
  const perUserRuntimes = new PerUserRuntimes({
    store: contextStore,
    onReplayTruncated: (userId, truncation) => {
      runtimeLog?.warn(
        { userId, ...truncation },
        "Belief replay exceeded maxEvents; degraded to the most recent window",
      );
    },
    ...(beliefWindowCacheBytes === undefined
      ? {}
      : { windowCacheBytes: beliefWindowCacheBytes }),
  });

  // Optional LLM narration layer. Everything downstream of a null
  // llmEnv degrades to "unconfigured": the service derives capability from
  // settings + env, the routes answer 503, and bootstrap reports
  // available=false. The published settings document is read live so a
  // publish flips the capability on the next dashboard refresh.
  const llmEnv = options.llmEnv ?? null;
  const llmClient =
    llmEnv === null
      ? null
      : new LlmGatewayClient({
          baseUrl: llmEnv.baseUrl,
          apiKey: llmEnv.apiKey,
        });
  const llmService = new LlmService({
    env: llmEnv,
    client: llmClient,
    getSettings: () => settingsRepository.getCurrentRelease().document,
    getBelief: (userId) =>
      perUserRuntimes.getFor(userId ?? null).belief.current(),
    getEventCounts: (since, until, userId) =>
      contextService.counts(since, until, userId ?? null),
  });

  // The automation seam: after a context event is ingested, re-project belief
  // and let the deterministic policy engine evaluate it against the published
  // settings — both scoped to the user stream the event landed in. This is
  // the only automatic action path; manual input and the engine's own
  // safeguards (cooldown, quiet hours, automation toggle, NO_ACTION/UNKNOWN)
  // still win.
  const automation = new AutomationOrchestrator(
    policyService,
    effectLedger,
    settingsRepository,
  );

  const runAutomation = async (userId: string | null): Promise<void> => {
    try {
      // Drop the cached projection first: the ingest that triggered this
      // callback just moved the user's MAX(server_sequence).
      perUserRuntimes.invalidate(userId);
      const snapshot = await perUserRuntimes.getFor(userId).belief.current();
      automation.evaluateAfterBelief(snapshot, userId);
    } catch (error) {
      // Automation is best-effort: a failed projection must never reject the
      // context ingest that triggered it. The failure is observable via the
      // decision/effect routes returning the last known state.
      void error;
    }
  };

  // The auth decision is resolved here (not at registration time below)
  // because the v0.7 access policy depends on it: with auth enabled the
  // allowlist is the law; without auth there is no account to list.
  const authConfig =
    options.auth === undefined ? AuthConfig.fromEnv() : options.auth;
  const authEnabled = authConfig !== null && authConfig.enabled;

  // v0.7 batch 1 (MUSES_V07, V11): Vibe Signal pulse + self-track playback
  // plan. Both factories return null while the switch is off, so nothing in
  // this block is constructed and the module graph stays byte-for-byte the
  // v0.6 graph — the same regression guarantee the auth module gives local
  // mode. The pulse ingest hook chains after the v0.6 automation callback so
  // an event both re-projects belief and invalidates the cached pulse
  // (event -> plan refresh inside the 60s budget).
  const v07Enabled = isVibeSignalEnabled({
    MUSES_V07: process.env.MUSES_V07,
  });
  const vibeSignal = createVibeSignalModule({
    database: contextDb,
    store: contextStore,
    enabled: v07Enabled,
    persistReadings: true,
  });
  const selfTrackPlan = createSelfTrackPlanModule({
    database: openedDatabase.connection,
    pulseFor:
      vibeSignal === null
        ? null
        : (userId) => vibeSignal.runtimes.getFor(userId).pulse,
    enabled: v07Enabled,
  });

  // v0.7 batch 2 (MUSES_V07 && MUSES_V07_REPLAY): journey + replay behind
  // the double switch. The kill-switch contract: either flag off means zero
  // registration, so a batch-2 incident is one env var away from v0.6
  // behavior. The catalog read only happens while the flags are on, so a
  // flag-off process never touches library_tracks. The gate deliberately
  // reuses the batch-1 boolean computed above rather than re-parsing the
  // environment: the layering invariant (batch 2 ⊆ batch 1) must not depend
  // on two parsers agreeing.
  const v07ReplayEnabled =
    v07Enabled && isTruthyFeatureFlag(process.env.MUSES_V07_REPLAY);
  // catalogFromLibraryBuckets (journey/model.ts) remaps the V2 library
  // bucket keys (self_slow_low, ...) onto the planner's journey keys
  // (self:low:low, ...) — without this adaptation no key ever matched and
  // every segment rendered at trackId "unassigned" (Round-2 defect #1).
  const journeyCatalog = v07ReplayEnabled
    ? catalogFromLibraryBuckets(selfTrackCatalog(openedDatabase.connection))
    : null;
  const journey =
    journeyCatalog === null
      ? null
      : buildJourneyModule(process.env, {
          database: openedDatabase.connection as unknown as JourneyDatabasePort,
          eventSource: contextStore,
          ...(Object.keys(journeyCatalog).length === 0
            ? {}
            : { catalog: journeyCatalog }),
        });

  // v0.7 per-user release (Round-2 repair order): the switches say WHAT is
  // deployed, MUSES_V07_USERS says WHO may use it. Both batches share one
  // allowlist. The /api/v1/features twin of the SPA-shell hint is a v0.7
  // route itself (registered only while batch 1 is on, concealed like the
  // rest) and reports the same two booleans the modules above were
  // registered from — never a re-parse of the environment.
  const v07Access = createV07AccessPolicy({
    users: parseV07Users({ MUSES_V07_USERS: process.env.MUSES_V07_USERS }),
    authEnabled,
  });
  const v07Features = v07Enabled
    ? createV07FeaturesModule({
        selfTrack: v07Enabled,
        replay: v07ReplayEnabled,
      })
    : null;

  const runPostIngest = async (userId: string | null): Promise<void> => {
    await runAutomation(userId);
    if (vibeSignal !== null) {
      await vibeSignal.onIngested(userId);
    }
  };

  const modules: FoundationModule[] = [
    {
      name: "context",
      plugin: async (fastify) => {
        fastify.addHook("onReady", () => retentionMaintenance.start());
        fastify.addHook("onClose", () => retentionMaintenance.stop());
        fastify.get("/api/v1/context/privacy", () => ({
          rawEventRetentionHours:
            settingsRepository.getCurrentRelease().document.privacy
              .rawEventRetentionHours,
          appliesTo: "new-events-only",
          settingsScope:
            "global; admin-only retention changes when authenticated",
          zeroRetention: "ingestion-disabled",
          cleanup: {
            intervalSeconds: 60,
            batchLimit: 500,
            scope: "retention-managed-events-only",
            legacyHistory: "preserved",
          },
          expiredRawRead: {
            includeExpired: "may-return-expired-rows-before-cleanup",
            historicalAsOf: "may-return-now-expired-rows-before-cleanup",
            defaultCurrentQuery: "hides-expired-rows",
            retentionIsAccessControl: false,
          },
          unsupportedControls: unsupportedPrivacyControls,
          unsupportedControlUpdates: "rejected",
        }));
        fastify.log.warn(
          { unsupportedControls: unsupportedPrivacyControls },
          "Signals and additional privacy controls are not enforced; changes are disabled",
        );
        await fastify.register(
          contextRoutesFactory(contextService, runPostIngest),
        );
      },
    },
    {
      name: "belief",
      plugin: beliefRoutesFactory(
        (userId: string | null) => perUserRuntimes.getFor(userId).belief,
        (log) => {
          runtimeLog = log;
        },
      ),
    },
    {
      name: "effects",
      plugin: createEffectRoutes({ ledger: effectLedger }),
    },
    {
      name: "policy",
      plugin: createDecisionRoutes({ repository: decisionRepository }),
    },
    {
      name: "settings",
      plugin: settingsRoutesPluginFactory(settingsRepository),
    },
    {
      name: "llm",
      plugin: llmRoutesFactory(
        llmService,
        createUserLanguageResolver(contextDb),
      ),
    },
    {
      name: "bootstrap",
      plugin: bootstrapRoutesFactory({
        getBelief: (userId) => perUserRuntimes.getFor(userId).belief.current(),
        getDecision: (userId) => policyService.getCurrent(userId),
        getEffect: (userId) => effectLedger.getCurrent(userId),
        getSettings: () => settingsRepository.getCurrentRelease().document,
        getLlm: () => llmService.capability(),
      }),
    },
  ];

  // v0.7 feature modules, registered only while their switches are on
  // (V10/V11). Order: self-track plan and vibe signal are batch 1;
  // journey/replay is batch 2 behind the double switch.
  if (selfTrackPlan !== null) {
    modules.push(selfTrackPlan);
  }
  if (vibeSignal !== null) {
    modules.push({ name: "vibe-signal", plugin: vibeSignal.routes });
  }
  if (journey !== null) {
    modules.push(journey);
  }
  if (v07Features !== null) {
    modules.push(v07Features);
  }

  // Optional auth module (MUSES_AUTH_ENABLED=true). Registered last: its
  // bearer gate hook attaches at app scope (skip-override) and therefore
  // covers every sibling route regardless of registration order, running
  // after the foundation origin hook. When disabled, nothing is registered
  // and the module graph is identical to the pre-auth server.
  if (authConfig !== null && authConfig.enabled) {
    modules.push({
      name: "auth",
      plugin: createAuthModule({
        config: authConfig,
        database: openedDatabase.connection,
        // Round-2 per-user release gate: while batch 1 is on, every v0.7
        // API path is concealed (routing 404) from callers outside
        // MUSES_V07_USERS — anonymous, bad token, or any other account.
        ...(v07Enabled
          ? {
              concealment: {
                isConcealedPath: isV07ApiPath,
                allowsCaller: (user: { readonly id: string }) =>
                  v07Access.allows(user.id),
              },
            }
          : {}),
      }),
    });
  }

  return {
    modules,
    // Exposed for ops/tests: cache hit-rate counters and per-user shard LRU.
    perUserRuntimes,
    v07Access,
    close: async () => {
      await retentionMaintenance.stop();
      openedDatabase?.close();
      openedDatabase = null;
    },
  };
}

/**
 * MUSES_BELIEF_WINDOW_CACHE_BYTES: byte budget for the per-shard hydrated
 * replay windows (R2 memory work). Undefined/empty keeps the 32 MiB default,
 * 0 disables the windows entirely, and anything that is not a non-negative
 * integer refuses to boot — an ops typo must not silently pick a default.
 */
function parseWindowCacheBytes(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "MUSES_BELIEF_WINDOW_CACHE_BYTES must be a non-negative integer number of bytes (0 disables the hydrated replay-window cache).",
    );
  }
  return value;
}

// The route plugins take options; Fastify's register() accepts the plugin plus
// an options bag, so we wrap each into a zero-arg FastifyPluginAsync here.
function contextRoutesFactory(
  service: ContextEventService,
  onIngested: (userId: string | null) => Promise<void>,
): FastifyPluginAsync {
  return async (fastify) => {
    await fastify.register(contextRoutes, { service, onIngested });
  };
}

function beliefRoutesFactory(
  forUser: (userId: string | null) => ScopedBeliefView,
  bindRuntimeLog: (log: FastifyBaseLogger) => void,
): FastifyPluginAsync {
  return async (fastify) => {
    // Plugins share the root logger, so this is the same pino instance (and
    // destination — stdout/journal in production) the request logs use.
    bindRuntimeLog(fastify.log);
    await fastify.register(beliefRoutes, { forUser });
  };
}

function llmRoutesFactory(
  service: LlmService,
  resolveUserLanguage: (userId: string) => LanguageCode | undefined,
): FastifyPluginAsync {
  return async (fastify) => {
    await fastify.register(llmRoutes, { service, resolveUserLanguage });
  };
}

function bootstrapRoutesFactory(
  options: Omit<BootstrapRoutesOptions, "basePath">,
): FastifyPluginAsync {
  return async (fastify) => {
    await fastify.register(createBootstrapRoutes, options);
  };
}

function settingsRoutesPluginFactory(
  repository: SettingsRepository,
): FastifyPluginAsync {
  return async (fastify) => {
    // The settings plugin mounts /settings/* internally; it expects the caller
    // to supply the /api prefix, matching the plugin contract test.
    fastify.addHook("preHandler", (request, reply, done) => {
      try {
        const url = request.routeOptions.url;
        let next: SettingsDocument | undefined;
        if (request.method === "PUT" && url === "/api/settings/draft") {
          next = (request.body as { document: SettingsDocument }).document;
        } else if (
          request.method === "POST" &&
          url === "/api/settings/publish"
        ) {
          next = repository.getDraft().document;
        } else if (request.method === "POST" && url?.endsWith("/rollback")) {
          try {
            next = repository.getRelease(
              (request.params as { releaseId: string }).releaseId,
            ).document;
          } catch (error) {
            // Let the settings handler retain its normal structured 404.
            if (!(error instanceof SettingsNotFoundError)) throw error;
          }
        }
        if (
          next !== undefined &&
          next.privacy.rawEventRetentionHours !==
            repository.getCurrentRelease().document.privacy
              .rawEventRetentionHours &&
          request.user !== undefined &&
          request.user.role !== "admin"
        ) {
          void reply.code(403).send({
            code: "SETTINGS_RETENTION_ADMIN_REQUIRED",
            message:
              "Raw event retention is global; only an administrator may change it.",
          });
          return;
        }
        if (
          next !== undefined &&
          unsupportedPrivacyChanged(
            repository.getCurrentRelease().document,
            next,
          )
        ) {
          void reply.code(409).send({
            code: "SETTINGS_PRIVACY_UNSUPPORTED",
            message:
              "Signals and additional privacy controls are not enforced; updates to these fields are disabled. See /api/v1/context/privacy.",
            details: { unsupportedControls: unsupportedPrivacyControls },
          });
          return;
        }
        done();
      } catch (error) {
        done(
          error instanceof Error
            ? error
            : new Error("Privacy settings validation failed."),
        );
      }
    });
    await fastify.register(settingsRoutesPlugin, {
      repository,
      prefix: "/api",
    });
  };
}

void systemClock;
