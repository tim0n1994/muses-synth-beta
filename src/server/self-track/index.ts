export {
  SelfTrackLibraryEmptyError,
  SelfTrackPlanService,
  type PulseAccess,
  type SelfTrackPlanServiceOptions,
} from "./plan-service.js";
export {
  buildPlaybackPlan,
  crossfadeMsOf,
  DEFAULT_CROSSFADE_MS,
  DEFAULT_PLAN_BUCKET,
  MAX_CROSSFADE_MS,
  planSeedFor,
  resolveTargetBucket,
  type LibraryTrackRow,
  type PlaybackPlanDto,
  type PlanStepDto,
  type PlanTrackDto,
} from "./plan.js";
export { selfTrackRoutes, type SelfTrackRoutesOptions } from "./routes.js";
export {
  createSelfTrackPlanModule,
  SELF_TRACK_MODULE_NAME,
  type SelfTrackModuleOptions,
} from "./module.js";
export {
  PlanErrorResponseSchema,
  PlanStepSchema,
  PlaybackPlanSchema,
  PlanTrackSchema,
} from "./schemas.js";
