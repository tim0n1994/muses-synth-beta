/** Test-only observation at the real destination, after master gain. */
export interface SynthProbe {
  outputs: Array<{
    analyser: AnalyserNode;
    context: AudioContext;
    master: GainNode;
  }>;
  oscillators: Array<{ node: OscillatorNode; stopped: boolean }>;
  mediaSources: number;
  sources: Array<{ stopRequested: boolean; ended: boolean }>;
}
export function installSynthProbe(): void {
  const probe: SynthProbe = {
    outputs: [],
    oscillators: [],
    mediaSources: 0,
    sources: [],
  };
  (window as unknown as { __musesProbe: SynthProbe }).__musesProbe = probe;
  // Native methods must retain the calling node; Reflect.apply below supplies it.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (
    destination: AudioNode | AudioParam,
    output?: number,
    input?: number,
  ): AudioNode & void {
    if (destination === this.context.destination && this instanceof GainNode) {
      const context = this.context as AudioContext;
      const analyser = context.createAnalyser();
      Reflect.apply(connect, this, [analyser, output ?? 0, 0]);
      Reflect.apply(connect, analyser, [context.destination, 0, input ?? 0]);
      probe.outputs.push({ analyser, context, master: this });
      return destination as AudioNode & void;
    }
    return Reflect.apply(
      connect,
      this,
      destination instanceof AudioParam
        ? [destination, output ?? 0]
        : [destination, output ?? 0, input ?? 0],
    ) as AudioNode & void;
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const createOscillator = AudioContext.prototype.createOscillator;
  const observeSource = (node: AudioScheduledSourceNode) => {
    const entry = { stopRequested: false, ended: false };
    const stop = node.stop.bind(node);
    node.stop = (when?: number) => {
      entry.stopRequested = true;
      stop(when);
    };
    node.addEventListener("ended", () => {
      entry.ended = true;
    });
    probe.sources.push(entry);
  };
  AudioContext.prototype.createOscillator = function () {
    const node = createOscillator.call(this);
    observeSource(node);
    const entry = { node, stopped: false };
    node.addEventListener("ended", () => {
      entry.stopped = true;
    });
    probe.oscillators.push(entry);
    return node;
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const createBufferSource = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    const node = createBufferSource.call(this);
    observeSource(node);
    return node;
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const createMedia = AudioContext.prototype.createMediaElementSource;
  AudioContext.prototype.createMediaElementSource = function (element) {
    probe.mediaSources += 1;
    return createMedia.call(this, element);
  };
}
export function readSynthProbe() {
  const probe = (window as unknown as { __musesProbe: SynthProbe })
    .__musesProbe;
  return {
    outputs: probe.outputs.map(({ analyser, context, master }) => {
      const pcm = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(pcm);
      return {
        state: context.state,
        time: context.currentTime,
        gain: master.gain.value,
        peak: Math.max(...pcm.map(Math.abs)),
        rms: Math.sqrt(
          pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length,
        ),
      };
    }),
    oscillators: probe.oscillators.map(({ node, stopped }) => ({
      frequency: node.frequency.value,
      stopped,
    })),
    mediaSources: probe.mediaSources,
    sources: probe.sources,
    mediaElements: document.querySelectorAll("audio,video").length,
  };
}
