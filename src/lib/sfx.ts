/**
 * Tiny synthesised UI sound layer (WebAudio, no assets).
 * Keeps interactions tactile: picking an accountant, scanning, saving.
 */

type Name =
  | "tap"
  | "select"
  | "confirm"
  | "swipe"
  | "shutter"
  | "error"
  /** small pop for chips, toggles and micro popups */
  | "pop"
  /** airy whoosh for sheets, drawers and page transitions */
  | "whoosh"
  /** soft reveal for cards / popovers appearing */
  | "reveal"
  /** route drawn on the map */
  | "route"
  /** switching between taxpayer / accountant worlds */
  | "mode"
  /** ambient bloom used by the intro */
  | "bloom"
  /** short tick for segmented controls / range pills */
  | "tick"
  /** rising chirp for opening a panel or profile */
  | "open"
  /** falling chirp for closing */
  | "close"
  /** warm success chord, richer than confirm */
  | "success"
  /** subtle hover accent */
  | "hover"
  /** data / chart interaction blip */
  | "chart"
  | "notification"
  | "message-notification"
  | "relationship-notification"
  | "appointment-notification"
  | "service-notification"
  | "document-notification"
  | "ai-notification";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Global loudness. The synthesised layer was far too quiet before. */
const MASTER = 3.4;
let muted = false;
if (typeof window !== "undefined") {
  try {
    const preferences = JSON.parse(window.localStorage.getItem("fisco.prefs") ?? "{}") as {
      sound?: unknown;
    };
    muted = preferences.sound === false;
  } catch {
    muted = false;
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const legacyWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AC = window.AudioContext ?? legacyWindow.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/* ---- autoplay unlock -------------------------------------------------- */
/* Browsers keep WebAudio suspended until a real gesture. We arm listeners on
   every plausible first interaction, and replay the sounds that were asked for
   while the context was still asleep so nothing feels silent. */
let armed = false;
/** Queued cues with the time they were requested — stale ones are dropped so
   nothing plays "late" long after the moment it belonged to. */
let pending: { name: Name; at: number }[] = [];
const STALE_MS = 700;
const unlockSubs = new Set<() => void>();

/** Run a callback the moment audio actually becomes audible. */
export function onAudioUnlock(fn: () => void) {
  if (unlocked()) {
    fn();
    return () => {};
  }
  unlockSubs.add(fn);
  return () => unlockSubs.delete(fn);
}

function unlocked() {
  return !!ctx && ctx.state === "running";
}

function flush() {
  const now = Date.now();
  const queued = pending.filter((p) => now - p.at < STALE_MS).slice(-2);
  pending = [];
  queued.forEach((p) => sfx(p.name));
  const subs = [...unlockSubs];
  unlockSubs.clear();
  subs.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}

function arm() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const events = ["pointerdown", "keydown"] as const;
  const onGesture = () => {
    const c = audio();
    if (!c) return;
    const done = () => {
      if (!unlocked()) return;
      events.forEach((e) => window.removeEventListener(e, onGesture));
      flush();
    };
    if (c.state === "suspended") void c.resume().then(done);
    else done();
  };
  events.forEach((e) => window.addEventListener(e, onGesture, { passive: true }));
}

if (typeof window !== "undefined") arm();

export function setMuted(v: boolean) {
  muted = v;
}

export function isMuted() {
  return muted;
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g).connect(master ?? c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

function noise(c: AudioContext, dur: number, gain: number) {
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const src = c.createBufferSource();
  const g = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2400;
  g.gain.value = gain;
  src.buffer = buf;
  src
    .connect(filter)
    .connect(g)
    .connect(master ?? c.destination);
  src.start();
}

/** Filtered noise sweep — airy "whoosh" used for motion and transitions. */
function sweep(c: AudioContext, dur: number, gain: number, fromHz: number, toHz: number) {
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(fromHz, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(toHz, c.currentTime + dur);
  const g = c.createGain();
  g.gain.value = gain;
  src
    .connect(filter)
    .connect(g)
    .connect(master ?? c.destination);
  src.start();
}

/** Hover cues fire on every pointer move across a list — throttle them so the
    audio graph never becomes a source of jank. */
let lastHover = 0;

export function sfx(name: Name) {
  if (muted) return;
  if (name === "hover") {
    const now = Date.now();
    if (now - lastHover < 120) return;
    lastHover = now;
  }
  arm();
  if (!unlocked()) {
    pending.push({ name, at: Date.now() });
    if (pending.length > 6) pending.shift();
    return;
  }
  const c = audio();
  if (!c) return;
  try {
    switch (name) {
      case "tap":
        tone(c, 620, 0, 0.05, 0.05, "triangle");
        break;
      case "select":
        tone(c, 528, 0, 0.09, 0.07, "sine");
        tone(c, 792, 0.05, 0.12, 0.045, "sine");
        break;
      case "confirm":
        tone(c, 523.25, 0, 0.1, 0.07);
        tone(c, 659.25, 0.07, 0.12, 0.06);
        tone(c, 987.77, 0.15, 0.2, 0.05);
        break;
      case "swipe":
        tone(c, 300, 0, 0.14, 0.035, "sawtooth");
        break;
      case "shutter":
        noise(c, 0.12, 0.09);
        tone(c, 180, 0.01, 0.06, 0.05, "square");
        break;
      case "error":
        tone(c, 220, 0, 0.16, 0.06, "square");
        break;
      case "pop":
        tone(c, 880, 0, 0.06, 0.045, "sine");
        tone(c, 1320, 0.03, 0.07, 0.025, "sine");
        break;
      case "whoosh":
        sweep(c, 0.26, 0.045, 900, 4200);
        break;
      case "reveal":
        sweep(c, 0.22, 0.02, 500, 2600);
        tone(c, 660, 0.04, 0.16, 0.035, "sine");
        tone(c, 990, 0.1, 0.2, 0.022, "sine");
        break;
      case "route":
        tone(c, 392, 0, 0.12, 0.05, "triangle");
        tone(c, 587.33, 0.09, 0.14, 0.04, "triangle");
        tone(c, 783.99, 0.19, 0.24, 0.03, "sine");
        break;
      case "mode":
        sweep(c, 0.3, 0.03, 700, 3600);
        tone(c, 440, 0.02, 0.16, 0.05, "sine");
        tone(c, 659.25, 0.12, 0.18, 0.045, "sine");
        tone(c, 880, 0.24, 0.3, 0.035, "sine");
        break;
      case "tick":
        tone(c, 1180, 0, 0.045, 0.05, "sine");
        break;
      case "hover":
        tone(c, 1560, 0, 0.035, 0.022, "sine");
        break;
      case "chart":
        tone(c, 740, 0, 0.06, 0.04, "triangle");
        tone(c, 1108, 0.035, 0.08, 0.024, "sine");
        break;
      case "notification":
        tone(c, 784, 0, 0.11, 0.045, "sine");
        tone(c, 1046.5, 0.09, 0.18, 0.035, "sine");
        break;
      case "message-notification":
        tone(c, 659.25, 0, 0.07, 0.05, "triangle");
        tone(c, 880, 0.06, 0.13, 0.04, "sine");
        break;
      case "relationship-notification":
        tone(c, 523.25, 0, 0.1, 0.05, "sine");
        tone(c, 659.25, 0.08, 0.1, 0.045, "sine");
        tone(c, 783.99, 0.16, 0.16, 0.035, "sine");
        break;
      case "appointment-notification":
        tone(c, 783.99, 0, 0.09, 0.045, "triangle");
        tone(c, 587.33, 0.08, 0.12, 0.04, "triangle");
        break;
      case "service-notification":
        tone(c, 440, 0, 0.1, 0.045, "sine");
        tone(c, 554.37, 0.09, 0.12, 0.04, "sine");
        break;
      case "document-notification":
        tone(c, 987.77, 0, 0.08, 0.045, "triangle");
        tone(c, 1174.66, 0.07, 0.14, 0.035, "sine");
        break;
      case "ai-notification":
        tone(c, 392, 0, 0.1, 0.04, "sine");
        tone(c, 659.25, 0.1, 0.1, 0.04, "sine");
        tone(c, 1046.5, 0.2, 0.18, 0.03, "sine");
        break;
      case "open":
        sweep(c, 0.24, 0.03, 400, 3000);
        tone(c, 523.25, 0.02, 0.14, 0.05, "sine");
        tone(c, 783.99, 0.1, 0.2, 0.038, "sine");
        break;
      case "close":
        sweep(c, 0.22, 0.028, 2800, 500);
        tone(c, 660, 0.02, 0.12, 0.04, "sine");
        tone(c, 440, 0.09, 0.18, 0.032, "sine");
        break;
      case "success":
        tone(c, 523.25, 0, 0.16, 0.07);
        tone(c, 659.25, 0.08, 0.18, 0.06);
        tone(c, 783.99, 0.16, 0.22, 0.055);
        tone(c, 1046.5, 0.26, 0.34, 0.045);
        break;
      case "bloom":
        tone(c, 261.63, 0, 0.9, 0.035, "sine");
        tone(c, 392, 0.18, 0.85, 0.028, "sine");
        tone(c, 523.25, 0.36, 0.8, 0.022, "sine");
        tone(c, 783.99, 0.6, 0.7, 0.016, "sine");
        break;
    }
  } catch {
    /* audio is a nice-to-have */
  }
}
