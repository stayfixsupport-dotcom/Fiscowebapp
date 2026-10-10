let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor).connect(ctx.destination);
  }
  return ctx;
}

function tone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.2,
  delay = 0,
  target?: number,
) {
  const context = audio();
  if (!context || !master || context.state !== "running") return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (target) oscillator.frequency.exponentialRampToValueAtTime(target, start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

function whoosh(duration = 0.7, volume = 0.18, delay = 0) {
  const context = audio();
  if (!context || !master || context.state !== "running") return;
  const start = context.currentTime + delay;
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(300, start);
  filter.frequency.exponentialRampToValueAtTime(3000, start + duration * 0.6);
  filter.frequency.exponentialRampToValueAtTime(600, start + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + duration * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(start);
}

export const loaderSfx = {
  intro() {
    whoosh(1.1, 0.2);
    tone(80, 1.4, "sine", 0.25, 0, 160);
    [261.63, 392, 523.25, 659.25].forEach((frequency, index) =>
      tone(frequency, 1.6, "sine", 0.08, 0.15 + index * 0.08),
    );
    tone(1568, 0.8, "triangle", 0.04, 0.6);
  },
  morph() {
    whoosh(0.6, 0.12);
    tone(520, 0.35, "sine", 0.07, 0.05, 780);
  },
  tip() {
    tone(1320, 0.18, "sine", 0.05);
    tone(1760, 0.22, "sine", 0.04, 0.07);
  },
  done() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
      tone(frequency, 0.9, "sine", 0.09, index * 0.07),
    );
    whoosh(0.9, 0.16, 0.2);
  },
};

export function whenAudioReady(callback: () => void) {
  const context = audio();
  if (!context) {
    callback();
    return () => {};
  }
  if (context.state === "running") {
    callback();
    return () => {};
  }

  let disposed = false;
  let completed = false;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const removeListeners = () => {
    events.forEach((eventName) => window.removeEventListener(eventName, onGesture, true));
    context.removeEventListener("statechange", notifyWhenReady);
  };
  const notifyWhenReady = () => {
    if (disposed || completed || context.state !== "running") return;
    completed = true;
    removeListeners();
    callback();
  };
  const onGesture = () => {
    removeListeners();
    void context.resume().then(notifyWhenReady).catch(() => undefined);
  };
  context.addEventListener("statechange", notifyWhenReady);
  events.forEach((eventName) =>
    window.addEventListener(eventName, onGesture, { capture: true, passive: true }),
  );
  if (window.navigator.userActivation?.hasBeenActive) {
    void context.resume().then(notifyWhenReady);
  }
  return () => {
    disposed = true;
    removeListeners();
  };
}

