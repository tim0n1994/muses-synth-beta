import type { AudioProfileId } from "../../server/policy/contracts.js";
import type { AudioProfileDefinition } from "./contracts.js";

export const AUDIO_PROFILES: Readonly<
  Record<AudioProfileId, AudioProfileDefinition>
> = Object.freeze({
  diverge: Object.freeze({
    id: "diverge",
    label: "Diverge",
    defaultGain: 0.16,
    crossfadeMs: 1400,
    oscillators: Object.freeze([
      Object.freeze({
        waveform: "sine",
        frequencyHz: 110,
        gain: 0.022,
        detuneCents: -6,
      }),
      Object.freeze({
        waveform: "triangle",
        frequencyHz: 220,
        gain: 0.012,
        detuneCents: 7,
      }),
    ]),
    noise: Object.freeze({
      color: "pink",
      gain: 0.035,
      filterType: "lowpass",
      filterFrequencyHz: 2400,
      filterQ: 0.55,
    }),
  }),
  flow: Object.freeze({
    id: "flow",
    label: "Flow",
    defaultGain: 0.18,
    crossfadeMs: 1200,
    oscillators: Object.freeze([
      Object.freeze({
        waveform: "sine",
        frequencyHz: 98,
        gain: 0.025,
        detuneCents: 0,
      }),
      Object.freeze({
        waveform: "sine",
        frequencyHz: 196,
        gain: 0.01,
        detuneCents: 3,
      }),
    ]),
    noise: Object.freeze({
      color: "brown",
      gain: 0.04,
      filterType: "lowpass",
      filterFrequencyHz: 1100,
      filterQ: 0.65,
    }),
  }),
  audit: Object.freeze({
    id: "audit",
    label: "Audit",
    defaultGain: 0.14,
    crossfadeMs: 1000,
    oscillators: Object.freeze([
      Object.freeze({
        waveform: "sine",
        frequencyHz: 130.81,
        gain: 0.018,
        detuneCents: 0,
      }),
      Object.freeze({
        waveform: "triangle",
        frequencyHz: 261.63,
        gain: 0.008,
        detuneCents: -2,
      }),
    ]),
    noise: Object.freeze({
      color: "pink",
      gain: 0.025,
      filterType: "bandpass",
      filterFrequencyHz: 1700,
      filterQ: 0.45,
    }),
  }),
  debug: Object.freeze({
    id: "debug",
    label: "Debug",
    defaultGain: 0.15,
    crossfadeMs: 900,
    oscillators: Object.freeze([
      Object.freeze({
        waveform: "triangle",
        frequencyHz: 82.41,
        gain: 0.022,
        detuneCents: 0,
      }),
      Object.freeze({
        waveform: "sine",
        frequencyHz: 164.81,
        gain: 0.01,
        detuneCents: 4,
      }),
    ]),
    noise: Object.freeze({
      color: "brown",
      gain: 0.03,
      filterType: "lowpass",
      filterFrequencyHz: 760,
      filterQ: 0.7,
    }),
  }),
});

export function getAudioProfile(
  profileId: AudioProfileId,
): AudioProfileDefinition {
  return AUDIO_PROFILES[profileId];
}
