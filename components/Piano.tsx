"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// Note indexes (0-11) that render as white vs. black keys.
const WHITE_NOTE_INDEXES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
// Each black key sits right after a specific white key within the octave.
const BLACK_KEYS_AFTER_WHITE = [
  { noteIndex: 1, afterWhite: 0 }, // C#
  { noteIndex: 3, afterWhite: 1 }, // D#
  { noteIndex: 6, afterWhite: 3 }, // F#
  { noteIndex: 8, afterWhite: 4 }, // G#
  { noteIndex: 10, afterWhite: 5 }, // A#
];

type PianoKey = {
  id: string;
  note: string;
  octave: number;
  midi: number;
};

type BlackKey = PianoKey & { globalWhiteIndexBefore: number };

function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function computeOctaveCount(width: number, height: number) {
  const isPortrait = height >= width;
  const isCoarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;
  // Phones report a coarse (touch) pointer and stay under ~900px on their
  // longest side even in landscape; tablets/desktops fall through below.
  const isPhone = isCoarsePointer && Math.max(width, height) < 900;

  if (isPhone) {
    return isPortrait ? 1 : 2;
  }

  if (width >= 1600) return 5;
  if (width >= 1200) return 4;
  return 3;
}

function buildKeys(octaveCount: number) {
  const startOctave = Math.max(1, 4 - Math.floor((octaveCount - 1) / 2));
  const white: PianoKey[] = [];
  const black: BlackKey[] = [];

  for (let o = 0; o < octaveCount; o++) {
    const octave = startOctave + o;

    WHITE_NOTE_INDEXES.forEach((noteIndex) => {
      white.push({
        id: `${octave}-${noteIndex}`,
        note: NOTE_NAMES[noteIndex],
        octave,
        midi: 12 * (octave + 1) + noteIndex,
      });
    });

    BLACK_KEYS_AFTER_WHITE.forEach(({ noteIndex, afterWhite }) => {
      black.push({
        id: `${octave}-${noteIndex}`,
        note: NOTE_NAMES[noteIndex],
        octave,
        midi: 12 * (octave + 1) + noteIndex,
        globalWhiteIndexBefore: o * 7 + afterWhite,
      });
    });
  }

  // Trailing high C so the range ends cleanly on the tonic.
  const lastOctave = startOctave + octaveCount;
  white.push({
    id: `${lastOctave}-0`,
    note: "C",
    octave: lastOctave,
    midi: 12 * (lastOctave + 1),
  });

  return { white, black };
}

export default function Piano() {
  const [octaveCount, setOctaveCount] = useState<number | null>(null);
  const [pressed, setPressed] = useState<Set<string>>(new Set());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNotesRef = useRef<
    Map<string, { osc: OscillatorNode; gain: GainNode }>
  >(new Map());

  useEffect(() => {
    const update = () =>
      setOctaveCount(computeOctaveCount(window.innerWidth, window.innerHeight));

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const { white, black } = useMemo(
    () => buildKeys(octaveCount ?? 3),
    [octaveCount]
  );

  function getAudioContext() {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  function pressKey(key: PianoKey) {
    if (activeNotesRef.current.has(key.id)) return;

    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(key.midi);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);

    activeNotesRef.current.set(key.id, { osc, gain });
    setPressed((prev) => new Set(prev).add(key.id));
  }

  function releaseKey(key: PianoKey) {
    const active = activeNotesRef.current.get(key.id);
    setPressed((prev) => {
      if (!prev.has(key.id)) return prev;
      const next = new Set(prev);
      next.delete(key.id);
      return next;
    });

    if (!active) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(active.gain.gain.value, now);
    active.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    active.osc.stop(now + 0.16);

    activeNotesRef.current.delete(key.id);
  }

  const totalWhite = white.length;
  const whiteKeyWidthPct = 100 / totalWhite;
  const blackKeyWidthPct = whiteKeyWidthPct * 0.62;

  if (octaveCount === null) {
    return <div className="h-full w-full" />;
  }

  return (
    <div
      className="relative h-full w-full select-none"
      style={{ touchAction: "none" }}
    >
      {white.map((key) => {
        const isPressed = pressed.has(key.id);
        return (
          <button
            key={key.id}
            aria-label={`${key.note}${key.octave}`}
            onPointerDown={(e) => {
              e.preventDefault();
              pressKey(key);
            }}
            onPointerUp={() => releaseKey(key)}
            onPointerLeave={() => releaseKey(key)}
            onPointerCancel={() => releaseKey(key)}
            className={`absolute bottom-0 top-0 border border-zinc-300 rounded-b-md transition-colors ${
              isPressed ? "bg-zinc-200" : "bg-white"
            }`}
            style={{
              left: `${white.indexOf(key) * whiteKeyWidthPct}%`,
              width: `${whiteKeyWidthPct}%`,
            }}
          />
        );
      })}

      {black.map((key) => {
        const isPressed = pressed.has(key.id);
        return (
          <button
            key={key.id}
            aria-label={`${key.note}${key.octave}`}
            onPointerDown={(e) => {
              e.preventDefault();
              pressKey(key);
            }}
            onPointerUp={() => releaseKey(key)}
            onPointerLeave={() => releaseKey(key)}
            onPointerCancel={() => releaseKey(key)}
            className={`absolute top-0 z-10 rounded-b-md transition-colors ${
              isPressed ? "bg-zinc-700" : "bg-zinc-900"
            }`}
            style={{
              left: `${
                (key.globalWhiteIndexBefore + 1) * whiteKeyWidthPct -
                blackKeyWidthPct / 2
              }%`,
              width: `${blackKeyWidthPct}%`,
              height: "60%",
            }}
          />
        );
      })}
    </div>
  );
}
