import {
  BrowserAudioClock,
  type AudioClock,
  type AudioFacade,
  type AudioProfileDefinition,
  type NoiseColor,
} from "./contracts.js";

interface ProfileGraph {
  readonly bus: GainNode;
  readonly sources: readonly AudioScheduledSourceNode[];
  readonly nodes: readonly AudioNode[];
}

export interface AudioContextFactory {
  create(): AudioContext;
}

export class BrowserAudioContextFactory implements AudioContextFactory {
  public create(): AudioContext {
    const Constructor = globalThis.AudioContext;
    if (Constructor === undefined) {
      throw new Error("Web Audio API is unavailable in this browser.");
    }
    return new Constructor({ latencyHint: "interactive" });
  }
}

export class WebAudioFacade implements AudioFacade {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private activeGraph: ProfileGraph | null = null;
  private readonly graphs = new Set<ProfileGraph>();
  private transportRevision = 0;
  private pendingSuspend: Promise<void> | null = null;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  public constructor(
    private readonly contextFactory: AudioContextFactory = new BrowserAudioContextFactory(),
    private readonly clock: AudioClock = new BrowserAudioClock(),
  ) {}

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("Audio facade is disposed.");
    }
    const revision = ++this.transportRevision;
    if (this.context === null) {
      this.context = this.contextFactory.create();
      this.master = this.context.createGain();
      this.master.gain.setValueAtTime(0, this.context.currentTime);
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "closed") {
      throw new Error("AudioContext is closed and cannot be restarted.");
    }
    const context = this.context;
    // Submit resume inside the user gesture even when a native suspend has
    // not yet updated state. A revision alone cannot retract a submitted suspend.
    const activation = context.resume();
    const suspension = this.pendingSuspend;
    await activation;
    await suspension;
    this.assertCurrentStart(context, revision);
    if (context.state !== "running") {
      await context.resume();
      this.assertCurrentStart(context, revision);
    }
  }

  public async applyProfile(
    profile: AudioProfileDefinition,
    crossfadeMs: number,
  ): Promise<void> {
    const context = this.requireRunningContext();
    const master = this.requireMaster();
    const nextGraph = createProfileGraph(context, master, profile);
    this.graphs.add(nextGraph);
    const now = context.currentTime;
    const durationSeconds = crossfadeMs / 1000;

    nextGraph.bus.gain.setValueAtTime(0, now);
    nextGraph.bus.gain.linearRampToValueAtTime(1, now + durationSeconds);

    const previousGraph = this.activeGraph;
    if (previousGraph !== null) {
      const previousValue = previousGraph.bus.gain.value;
      previousGraph.bus.gain.cancelScheduledValues(now);
      previousGraph.bus.gain.setValueAtTime(previousValue, now);
      previousGraph.bus.gain.linearRampToValueAtTime(0, now + durationSeconds);
    }

    this.activeGraph = nextGraph;
    await this.clock.sleep(crossfadeMs);

    if (previousGraph !== null) {
      this.releaseGraph(previousGraph);
    }
  }

  public async rampMasterGain(
    targetGain: number,
    rampMs: number,
  ): Promise<void> {
    const context = this.requireRunningContext();
    const master = this.requireMaster();
    const now = context.currentTime;
    const currentValue = master.gain.value;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(currentValue, now);
    master.gain.linearRampToValueAtTime(targetGain, now + rampMs / 1000);
    await this.clock.sleep(rampMs);
  }

  public async pause(rampMs: number): Promise<void> {
    const revision = ++this.transportRevision;
    const context = this.context;
    if (this.context === null || this.master === null) {
      return;
    }
    if (this.context.state === "closed") {
      return;
    }
    if (context?.state === "running") {
      await this.rampMasterGain(0, rampMs);
      if (this.disposed || revision !== this.transportRevision) return;
      // A wall-clock timer can finish before the audio thread applies its ramp.
      this.master.gain.cancelScheduledValues(context.currentTime);
      this.master.gain.value = 0;
      const suspension = context.suspend();
      this.pendingSuspend = suspension;
      try {
        await suspension;
      } finally {
        if (this.pendingSuspend === suspension) this.pendingSuspend = null;
      }
    }
  }

  public dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal;
    this.disposed = true;
    this.transportRevision += 1;
    for (const graph of this.graphs) this.releaseGraph(graph);
    this.activeGraph = null;
    this.master?.disconnect();
    this.master = null;
    const context = this.context;
    this.context = null;
    this.disposal =
      context !== null && context.state !== "closed"
        ? context.close()
        : Promise.resolve();
    return this.disposal;
  }

  private releaseGraph(graph: ProfileGraph): void {
    if (this.graphs.delete(graph)) stopGraph(graph);
  }

  private assertCurrentStart(context: AudioContext, revision: number): void {
    if (
      this.disposed ||
      this.context !== context ||
      revision !== this.transportRevision
    ) {
      throw new Error("Audio start was cancelled or disposed.");
    }
  }

  private requireRunningContext(): AudioContext {
    if (this.context === null || this.context.state !== "running") {
      throw new Error(
        "Explicit audio start is required before applying a profile.",
      );
    }
    return this.context;
  }

  private requireMaster(): GainNode {
    if (this.master === null) {
      throw new Error("Audio master node is unavailable.");
    }
    return this.master;
  }
}

function createProfileGraph(
  context: AudioContext,
  destination: AudioNode,
  profile: AudioProfileDefinition,
): ProfileGraph {
  const bus = context.createGain();
  bus.gain.setValueAtTime(0, context.currentTime);
  bus.connect(destination);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [bus];

  for (const layer of profile.oscillators) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = layer.waveform;
    oscillator.frequency.setValueAtTime(layer.frequencyHz, context.currentTime);
    oscillator.detune.setValueAtTime(layer.detuneCents, context.currentTime);
    gain.gain.setValueAtTime(layer.gain, context.currentTime);
    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start();
    sources.push(oscillator);
    nodes.push(oscillator, gain);
  }

  const noiseSource = context.createBufferSource();
  const noiseGain = context.createGain();
  const filter = context.createBiquadFilter();
  noiseSource.buffer = createNoiseBuffer(
    context,
    profile.noise.color,
    profile.id,
  );
  noiseSource.loop = true;
  noiseGain.gain.setValueAtTime(profile.noise.gain, context.currentTime);
  filter.type = profile.noise.filterType;
  filter.frequency.setValueAtTime(
    profile.noise.filterFrequencyHz,
    context.currentTime,
  );
  filter.Q.setValueAtTime(profile.noise.filterQ, context.currentTime);
  noiseSource.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(bus);
  noiseSource.start();
  sources.push(noiseSource);
  nodes.push(noiseSource, filter, noiseGain);

  return { bus, sources, nodes };
}

function createNoiseBuffer(
  context: AudioContext,
  color: NoiseColor,
  seedText: string,
): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * 2));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(hashSeed(seedText));

  if (color === "brown") {
    let previous = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = random() * 2 - 1;
      previous = (previous + 0.02 * white) / 1.02;
      data[index] = previous * 3.2;
    }
    return buffer;
  }

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

function stopGraph(graph: ProfileGraph): void {
  for (const source of graph.sources) {
    try {
      source.stop();
    } catch {
      // A source can already be stopped while disposing after a browser failure.
    }
  }
  for (const node of graph.nodes) {
    node.disconnect();
  }
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed === 0 ? 0x6d2b79f5 : initialSeed;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
