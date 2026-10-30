import { describe, expect, it } from "vitest";

import contractsSource from "./contracts.ts?raw";
import equalPowerSource from "./equal-power.ts?raw";
import planSource from "./plan.ts?raw";
import engineSource from "./crossfade-engine.ts?raw";
import deckAdapterSource from "./deck-adapter.ts?raw";
import stubPlanSource from "./stub-plan.ts?raw";
import serverPlanSource from "./server-plan.ts?raw";
import copySource from "./copy.ts?raw";
import playerComponentSource from "./SelfTrackPlayer.tsx?raw";
import playerPageSource from "./SelfTrackPlayerPage.tsx?raw";
import routeSource from "./route.tsx?raw";

/**
 * Client-side evidence for the "static files + HTTP Range, zero transcode"
 * budget: the player module must consume audio exclusively through media
 * element `src` assignment (the browser then issues Range requests against
 * the static library), never through buffer decoding, resynthesis, or a
 * transcoding API endpoint. The module surface is enumerated via ?raw
 * imports; adding a source file means adding it here.
 */
const SOURCES: Readonly<Record<string, string>> = {
  "contracts.ts": contractsSource,
  "equal-power.ts": equalPowerSource,
  "plan.ts": planSource,
  "crossfade-engine.ts": engineSource,
  "deck-adapter.ts": deckAdapterSource,
  "stub-plan.ts": stubPlanSource,
  "server-plan.ts": serverPlanSource,
  "copy.ts": copySource,
  "SelfTrackPlayer.tsx": playerComponentSource,
  "SelfTrackPlayerPage.tsx": playerPageSource,
  "route.tsx": routeSource,
};

describe("self-track player consumes static library files only", () => {
  it("enumerates the whole module surface", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(3);
  });

  it("never decodes audio buffers or resynthesizes sound", () => {
    for (const [file, src] of Object.entries(SOURCES)) {
      expect(src, file).not.toContain("decodeAudioData");
      expect(src, file).not.toContain("AudioBufferSourceNode");
      expect(src, file).not.toContain("OfflineAudioContext");
    }
  });

  it("calls no transcoding or streaming API for audio", () => {
    for (const [file, src] of Object.entries(SOURCES)) {
      expect(src, file).not.toMatch(/fetch\([^)]*\/api\//);
      expect(src, file).not.toContain("/transcode");
      expect(src, file).not.toContain("/stream");
      expect(src, file).not.toContain("MediaRecorder");
    }
  });

  it("routes audio through exactly one media-element bridge (deck adapter)", () => {
    const adapters = Object.entries(SOURCES).filter(([, src]) =>
      src.includes("createMediaElementSource"),
    );
    expect(adapters.map(([file]) => file)).toEqual(["deck-adapter.ts"]);
    // The adapter assigns element src — the native Range path.
    expect(adapters[0]![1]).toMatch(/\.src\s*=/);
    expect(adapters[0]![1]).not.toContain("decodeAudioData");
  });
});
