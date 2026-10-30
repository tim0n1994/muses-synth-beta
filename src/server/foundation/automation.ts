import type { BeliefSnapshot } from "../belief/model.js";
import { beliefStateToProfile, toPolicyBelief } from "../belief/profile-map.js";
import type { PolicyService } from "../policy/service.js";
import type { Decision } from "../policy/contracts.js";
import type { EffectLedgerService } from "../effects/index.js";
import type { SettingsRepository } from "../settings/repository.js";
import type { PolicySettings } from "../policy/contracts.js";
import { settingsToPolicySettings } from "../belief/profile-map.js";

/**
 * The automation seam between belief projection and policy execution. After the
 * belief service projects a fresh snapshot, this orchestrator evaluates the
 * deterministic policy against the published settings and stores the resulting
 * decision (and its issued effect when the decision is an audio adjustment).
 *
 * This is the only place in v0.1 that acts automatically. Manual input still
 * wins because the policy engine honors manual cooldowns, quiet hours, and the
 * automation toggle, and NO_ACTION / UNKNOWN are passed through untouched.
 */
export class AutomationOrchestrator {
  public constructor(
    private readonly policyService: PolicyService,
    private readonly effectLedger: EffectLedgerService,
    private readonly settingsRepository: SettingsRepository,
  ) {}

  /**
   * Returns the stored decision (which may be NO_ACTION) so callers can report
   * it without a second repository read.
   *
   * The userId scopes the whole evaluation to one user's stream: the last
   * decision, the manual-override cooldown, the stored decision, and any
   * issued effect all belong to that user. Omitted or null evaluates the
   * legacy global stream (auth-disabled local mode).
   */
  public evaluateAfterBelief(
    snapshot: BeliefSnapshot,
    userId?: string | null,
  ): {
    readonly decision: Decision;
    readonly effectIssued: boolean;
  } {
    const document = this.settingsRepository.getCurrentRelease().document;
    const policySettings: PolicySettings = settingsToPolicySettings(document);

    const policyBelief = toPolicyBelief(snapshot);

    // The policy context tracks the current audio profile so the engine can
    // emit PROFILE_UNCHANGED instead of a redundant change. We infer it from
    // the last stored decision when present.
    const lastDecision = this.policyService.getCurrent(userId);
    const lastProfile =
      lastDecision !== null && lastDecision.effect !== null
        ? lastDecision.effect.profile
        : null;

    const decision = this.policyService.evaluateAndStore(
      {
        belief: {
          beliefId: policyBelief.beliefId,
          state: policyBelief.state,
          confidence: policyBelief.confidence,
          observedAt: policyBelief.observedAt,
          factors: [...policyBelief.factors],
        },
        settings: policySettings,
        context: {
          currentProfile: lastProfile,
          // The browser reports manual transport actions as effect outcomes with
          // a reserved reason; without this the engine's MANUAL_COOLDOWN branch
          // is unreachable and PRD-v0.1 scenario 6 cannot pass.
          lastManualOverrideAt:
            this.effectLedger.getLastManualOverrideAt(userId),
        },
      },
      userId,
    );

    let effectIssued = false;
    if (decision.kind !== "NO_ACTION" && decision.effect !== null) {
      const request = this.effectLedger.issueFromDecision(decision, userId);
      effectIssued = request !== null;
    }

    void beliefStateToProfile;
    return { decision, effectIssued };
  }
}
