/**
 * Fisco sound engine — synthesized in the browser with the Web Audio API,
 * so every cue is generated live (no audio files to load).
 */

type Ctx = AudioContext & { __fiscoMaster?: GainNode };

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let muted = false;
let lastTick = 0;

const STORAGE_KEY = "fisco.muted";

export function isMuted() {
  return muted;
}

export function loadMutePreference() {
  if (typeof window === "undefined") return false;
  muted = window.localStorage.getItem(STORAGE_KEY) === "1";
  if (master) master.gain.value = muted ? 0 : 0.9;
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }
  if (master) master.gain.value = next ? 0 : 0.9;
}

function audio(): Ctx | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor() as Ctx;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    // Glue compressor + short stereo echo for a richer, "produced" sound.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.14;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    master.connect(comp);
    master.connect(echo);
    echo.connect(fb);
    fb.connect(echo);
    echo.connect(wet);
    wet.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state !== "running") void ctx.resume();
  return ctx;
}

/** Must run inside a user gesture. Plays a silent buffer to unlock iOS/Safari. */
export function unlockAudio() {
  const ac = audio();
  if (!ac) return;
  const b = ac.createBuffer(1, 1, 22050);
  const s = ac.createBufferSource();
  s.buffer = b;
  s.connect(ac.destination);
  s.start(0);
}

let introPlayed = false;
/** Plays the PS5-style intro once, on the first interaction (browsers block sound before that). */
export function installIntroSound() {
  if (typeof window === "undefined") return () => {};
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const handler = () => {
    events.forEach((e) => window.removeEventListener(e, handler, true));
    unlockAudio();
    if (introPlayed) return;
    introPlayed = true;
    const ac = audio();
    const go = () => sfx.intro();
    if (ac && ac.state !== "running") void ac.resume().then(go);
    else go();
  };
  events.forEach((e) => window.addEventListener(e, handler, { capture: true, passive: true }));
  return () => events.forEach((e) => window.removeEventListener(e, handler, true));
}

type ToneOptions = {
  freq: number;
  to?: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  attack?: number;
  pan?: number;
};

function tone({
  freq,
  to,
  duration = 0.22,
  type = "sine",
  gain = 0.16,
  delay = 0,
  attack = 0.012,
  pan = 0,
}: ToneOptions) {
  const ac = audio();
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const panner = ac.createStereoPanner ? ac.createStereoPanner() : null;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(g);
  if (panner) {
    panner.pan.value = pan;
    g.connect(panner);
    panner.connect(master);
  } else {
    g.connect(master);
  }
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function noise(duration = 0.5, gain = 0.05, delay = 0, filterFreq = 900) {
  const ac = audio();
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + delay;
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFreq * 0.4, t0);
  filter.frequency.exponentialRampToValueAtTime(filterFreq * 3, t0 + duration);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
}

export const sfx = {
  /** Cinematic swoosh + shimmering chord, like a console home screen. */
  intro() {
    noise(1.1, 0.09, 0, 500);
    tone({ freq: 80, to: 160, duration: 1.2, type: "sine", gain: 0.14, attack: 0.25 });
    [261.63, 392, 523.25, 659.25].forEach((f, i) =>
      tone({
        freq: f,
        duration: 2.2,
        type: "sine",
        gain: 0.05,
        delay: 0.35 + i * 0.09,
        attack: 0.3,
        pan: (i - 1.5) * 0.3,
      }),
    );
    tone({ freq: 1567.98, duration: 1.6, type: "triangle", gain: 0.03, delay: 0.8, attack: 0.4 });
  },
  swoosh() {
    noise(0.45, 0.07, 0, 1200);
  },
  /** Cinematic console-style power-up. */
  boot() {
    noise(2.2, 0.05, 0, 700);
    tone({ freq: 110, to: 440, duration: 2.1, type: "sawtooth", gain: 0.05, attack: 0.9 });
    tone({ freq: 220, to: 880, duration: 1.9, type: "sine", gain: 0.07, attack: 0.8, pan: -0.4 });
    tone({
      freq: 329.63,
      to: 1318.5,
      duration: 1.7,
      type: "sine",
      gain: 0.05,
      attack: 0.9,
      pan: 0.4,
    });
    [0, 0.12, 0.24].forEach((d, i) => {
      tone({
        freq: 523.25 * (1 + i * 0.26),
        duration: 1.4,
        type: "triangle",
        gain: 0.09,
        delay: 1.5 + d,
      });
    });
    tone({ freq: 1567.98, duration: 2.4, type: "sine", gain: 0.05, delay: 1.7, attack: 0.5 });
  },
  hover() {
    tone({ freq: 1180, duration: 0.05, type: "sine", gain: 0.03 });
  },
  click() {
    tone({ freq: 720, to: 1320, duration: 0.09, type: "triangle", gain: 0.08 });
  },
  send() {
    tone({ freq: 520, to: 1040, duration: 0.18, type: "sine", gain: 0.11 });
    tone({ freq: 780, to: 1560, duration: 0.2, type: "triangle", gain: 0.05, delay: 0.04 });
  },
  thinking() {
    tone({ freq: 330, to: 495, duration: 0.7, type: "sine", gain: 0.05, attack: 0.15 });
    tone({
      freq: 495,
      to: 660,
      duration: 0.7,
      type: "sine",
      gain: 0.03,
      delay: 0.18,
      attack: 0.15,
      pan: 0.3,
    });
  },
  /** Soft key tick while Fisco types — rate limited. */
  tick() {
    const now = Date.now();
    if (now - lastTick < 42) return;
    lastTick = now;
    tone({
      freq: 1800 + Math.random() * 400,
      duration: 0.025,
      type: "sine",
      gain: 0.02,
      pan: Math.random() * 0.6 - 0.3,
    });
  },
  receive() {
    tone({ freq: 880, duration: 0.16, type: "sine", gain: 0.08 });
    tone({ freq: 1318.5, duration: 0.3, type: "sine", gain: 0.06, delay: 0.09 });
  },
  newThread() {
    tone({ freq: 440, to: 1320, duration: 0.3, type: "triangle", gain: 0.08 });
    noise(0.3, 0.02, 0, 1600);
  },
  delete() {
    tone({ freq: 420, to: 160, duration: 0.25, type: "sawtooth", gain: 0.06 });
  },
  error() {
    tone({ freq: 220, duration: 0.18, type: "square", gain: 0.07 });
    tone({ freq: 165, duration: 0.3, type: "square", gain: 0.06, delay: 0.14 });
  },
};
