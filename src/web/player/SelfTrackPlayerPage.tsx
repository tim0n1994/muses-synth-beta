import { SelfTrackPlayer } from "./SelfTrackPlayer.js";
import { createServerPlanSource } from "./server-plan.js";

/**
 * Standalone page shell for the lazy route. Since the stage-3 integration
 * the plan comes from GET /api/v1/self-track/plan (same-origin, bearer via
 * the authorized fetch wrapper); while MUSES_V07 is off the endpoint 404s
 * and the player surfaces the error through its alert region.
 */
const planSource = createServerPlanSource();

export default function SelfTrackPlayerPage(): React.JSX.Element {
  return (
    <main>
      <SelfTrackPlayer planSource={planSource} />
    </main>
  );
}
