import type { Decision, PolicyInput } from "./contracts.js";
import type { DeterministicPolicyEngine } from "./engine.js";
import type { DecisionRepository } from "./repository.js";

export class PolicyService {
  public constructor(
    private readonly engine: DeterministicPolicyEngine,
    private readonly repository: DecisionRepository,
  ) {}

  /**
   * Evaluates and stores the decision, attributed to the given user stream.
   * Omitted or null writes to the legacy global stream (auth-disabled local
   * mode, the pre-v0.6 behavior).
   */
  public evaluateAndStore(
    input: PolicyInput,
    userId?: string | null,
  ): Decision {
    const decision = this.engine.evaluate(input);
    this.repository.save(decision, userId);
    return decision;
  }

  /**
   * The most recent decision for a stream. `undefined` reads unfiltered,
   * `null` the legacy global stream, a user id that user's decisions.
   */
  public getCurrent(userId?: string | null): Decision | null {
    return this.repository.getCurrent(userId);
  }
}
