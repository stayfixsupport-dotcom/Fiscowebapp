import { useEffect, useRef, useState } from "react";
import { translateUi } from "@/lib/i18n";
import { UI_PREFS_KEY } from "@/lib/ui-prefs";
import { loaderSfx, whenAudioReady } from "./fisco-loader-sound";

import img1 from "@/assets/load-1.jpg";
import img2 from "@/assets/load-2.jpg";
import img3 from "@/assets/load-3.jpg";
import img4 from "@/assets/load-4.jpg";

const SHAPES = [
  { src: img1, glow: "oklch(0.8 0.15 85)", label: "Documents" },
  { src: img2, glow: "oklch(0.9 0 0)", label: "Purchases" },
  { src: img3, glow: "oklch(0.72 0.19 48)", label: "Accountants" },
  { src: img4, glow: "oklch(0.75 0.13 250)", label: "Ready" },
];

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index]!;
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current;
  }
  return shuffled.slice(0, count);
}

function initialSequence(bootOnly: boolean) {
  if (bootOnly || typeof document === "undefined") return [];
  const firstIndex = Number(document.documentElement.dataset.fiscoLoaderShape);
  if (!Number.isInteger(firstIndex) || firstIndex < 0 || firstIndex >= SHAPES.length) {
    return pickRandom(SHAPES, 4);
  }
  return [
    SHAPES[firstIndex]!,
    ...pickRandom(
      SHAPES.filter((_, index) => index !== firstIndex),
      SHAPES.length - 1,
    ),
  ];
}

export function FiscoLoader({
  onDone,
  interval = 1200,
  mode = "intro",
  canFinish = true,
  bootOnly = false,
  maxDuration = 4200,
}: {
  onDone?: () => void;
  interval?: number;
  mode?: "intro" | "loading";
  canFinish?: boolean;
  bootOnly?: boolean;
  maxDuration?: number;
}) {
  const [language, setLanguage] = useState("English");

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(UI_PREFS_KEY) ?? "{}") as {
        language?: unknown;
      };
      if (typeof stored.language === "string") setLanguage(stored.language);
    } catch {
      setLanguage("English");
    }
  }, []);
  const t = (message: string) => translateUi(message, language);
  const [index, setIndex] = useState(0);
  const [sequence] = useState(() => initialSequence(bootOnly));
  const [sequenceStarted, setSequenceStarted] = useState(false);
  const [sequenceFinished, setSequenceFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const completionStarted = useRef(false);

  useEffect(() => {
    if (bootOnly) return;
    let active = true;
    let introPlayed = false;
    let sequenceTimers: number[] = [];
    const playIntro = () => {
      if (introPlayed) return;
      introPlayed = true;
      loaderSfx.intro();
    };
    const startSequence = () => {
      if (!active) return;
      setSequenceStarted(true);
      sequenceTimers = [1, 2, 3].map((stage) =>
        window.setTimeout(() => {
          if (!active) return;
          setIndex(stage);
          if (stage === 3) setSequenceFinished(true);
        }, interval * stage),
      );
    };
    const removeAudioListener = whenAudioReady(playIntro);
    startSequence();

    return () => {
      active = false;
      sequenceTimers.forEach(window.clearTimeout);
      removeAudioListener();
    };
  }, [bootOnly, interval, sequence]);

  useEffect(() => {
    if (index === 0) return;
    loaderSfx.morph();
  }, [index]);

  useEffect(() => {
    if (!sequenceFinished || completionStarted.current) return;

    if (canFinish) {
      completionStarted.current = true;
      const fadeTimer = window.setTimeout(() => {
        setLeaving(true);
        loaderSfx.done();
      }, 550);
      const doneTimer = window.setTimeout(() => onDone?.(), 1100);
      return () => {
        window.clearTimeout(fadeTimer);
        window.clearTimeout(doneTimer);
      };
    }

    const fallbackTimer = window.setTimeout(
      () => {
        if (completionStarted.current) return;
        completionStarted.current = true;
        setLeaving(true);
        loaderSfx.done();
        window.setTimeout(() => onDone?.(), 650);
      },
      Math.max(1800, maxDuration),
    );

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [sequenceFinished, canFinish, maxDuration, onDone]);

  const shape = sequence[index] ?? SHAPES[0]!;

  return (
    <div
      role="status"
      aria-label={t(mode === "loading" ? "Loading Fisco" : "Fisco introduction")}
      className={`fl-root ${leaving ? "fl-leave" : ""} ${bootOnly ? "fl-boot-only" : ""} ${!sequenceStarted ? "fl-preparing" : ""}`}
    >
      <div
        className="fl-glow"
        style={
          sequence.length
            ? { background: `radial-gradient(closest-side, ${shape.glow}, transparent)` }
            : undefined
        }
      />
      <div className="fl-grain" />

      <div className="fl-stage">
        <div className="fl-ring fl-ring-a">
          <span />
        </div>
        <div className="fl-ring fl-ring-b">
          <span />
        </div>
        {(bootOnly ? SHAPES : sequence).map((item, itemIndex) => (
          <img
            key={item.src}
            src={item.src.split("?")[0]}
            alt=""
            width={1024}
            height={1024}
            data-shape-index={itemIndex}
            className={`fl-shape ${sequenceStarted && itemIndex === index ? "is-on" : ""}`}
          />
        ))}
      </div>

      <div className="fl-copy">
        <div className="fl-brand">FISCO</div>
        <div className="fl-label">{mode === "loading" ? t("Loading") : t(shape.label)}</div>
      </div>
    </div>
  );
}
