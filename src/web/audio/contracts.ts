import type { AudioProfileId } from "../../server/policy/contracts.js";

export type ManualAudioAction =
  "start" | "pause" | "mute" | "unmute" | "volume";

export interface AudioProfileOscillatorLayer {
  readonly waveform: OscillatorType;
  readonly frequencyHz: number;
  readonly gain: number;
  readonly detuneCents: number;
}

export type NoiseColor = "pink" | "brown";

export interface AudioProfileNoiseLayer {
  readonly color: NoiseColor;
  readonly gain: number;
  readonly filterType: BiquadFilterType;
  readonly filterFrequencyHz: number;
  readonly filterQ: number;
}

export interface AudioProfileDefinition {
  readonly id: AudioProfileId;
  readonly label: string;
  readonly defaultGain: number;
  readonly crossfadeMs: number;
  readonly oscillators: readonly AudioProfileOscillatorLayer[];
  readonly noise: AudioProfileNoiseLayer;
}

export interface AudioFacade {
  start(): Promise<void>;
  applyProfile(
    profile: AudioProfileDefinition,
    crossfadeMs: number,
  ): Promise<void>;
  rampMasterGain(targetGain: number, rampMs: number): Promise<void>;
  pause(rampMs: number): Promise<void>;
  dispose(): Promise<void>;
}

export interface AudioClock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export class BrowserAudioClock implements AudioClock {
  public now(): Date {
    return new Date();
  }

  public async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, milliseconds);
    });
  }
}

export interface ManualOverrideNotice {
  readonly action: ManualAudioAction;
  readonly occurredAt: string;
  readonly cooldownUntil: string;
}

export type ManualOverrideListener = (notice: ManualOverrideNotice) => void;
