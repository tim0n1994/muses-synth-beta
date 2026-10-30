import { AudioRuntime } from "../../audio/audio-runtime.js";
import type { EffectRequest } from "../../../server/effects/contracts.js";

// The dashboard's default runtime, with no recording, library or account.
// Only transition/race tests opt out of the default 120s manual cooldown.
const runtime = new AudioRuntime(
  new URLSearchParams(location.search).has("noCooldown")
    ? { manualCooldownMs: 0 }
    : {},
);
const result = document.createElement("pre");
result.id = "receipt";
const snapshot = document.createElement("pre");
snapshot.id = "snapshot";
const publish = (value: unknown) => {
  result.textContent = JSON.stringify(value);
  snapshot.textContent = JSON.stringify(runtime.snapshot());
};
const issued = (): EffectRequest => ({
  effectId: "fixture-auto",
  decisionId: "fixture-decision",
  actionId: "audio.adjust",
  adjustment: {
    actionId: "audio.adjust",
    profile: "audit",
    targetGain: 0.14,
    rampMs: 1000,
  },
  issuedAt: new Date().toISOString(),
  status: "issued",
});
for (const command of [
  "play",
  "pause",
  "transition",
  "volume",
  "dispose",
] as const) {
  const button = document.createElement("button");
  button.textContent = command;
  button.onclick = () => {
    result.textContent = "pending";
    // Invoke directly in the handler to preserve native user activation.
    const operation =
      command === "dispose"
        ? runtime.dispose().then(() => ({ status: "disposed" }))
        : command === "transition"
          ? runtime.applyIssuedEffect(issued())
          : runtime.runManualCommand(
              command === "volume" ? "set-volume" : command,
              {
                effectId: "fixture-manual",
                volume: 0.18,
              },
            );
    void operation.then(publish);
  };
  document.body.append(button);
}
document.body.append(result, snapshot);
publish(null);
