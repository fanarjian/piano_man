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

// --- Instruments ------------------------------------------------------
//
// Each instrument builds its own little oscillator graph ("voice") for a
// note. A shared gain node ("ampGain") is layered on top to shape the
// attack/decay/release envelope, so the sustain phase is just "hold the
// gain flat" — the note keeps sounding for as long as the key is held,
// and only the release phase (triggered on key-up) fades it out.

type InstrumentId =
  | "piano"
  | "electricPiano"
  | "organ"
  | "synth"
  | "saxophone"
  | "strings";

type Voice = {
  output: AudioNode;
  oscillators: OscillatorNode[];
};

type InstrumentDef = {
  id: InstrumentId;
  label: string;
  attack: number;
  peak: number;
  sustain: number;
  decayTime: number;
  release: number;
  createVoice: (ctx: AudioContext, freq: number) => Voice;
};

function createOsc(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  detuneCents = 0
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  if (detuneCents) osc.detune.value = detuneCents;
  osc.start();
  return osc;
}

const INSTRUMENTS: InstrumentDef[] = [
  {
    id: "piano",
    label: "Piano",
    attack: 0.005,
    peak: 0.32,
    sustain: 0.16,
    decayTime: 0.35,
    release: 0.18,
    createVoice(ctx, freq) {
      const osc = createOsc(ctx, "triangle", freq);
      return { output: osc, oscillators: [osc] };
    },
  },
  {
    id: "electricPiano",
    label: "Electric Piano",
    attack: 0.004,
    peak: 0.3,
    sustain: 0.1,
    decayTime: 0.5,
    release: 0.3,
    createVoice(ctx, freq) {
      const fundamental = createOsc(ctx, "sine", freq);
      const overtone = createOsc(ctx, "sine", freq * 2);
      const mix = ctx.createGain();
      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.22;
      fundamental.connect(mix);
      overtone.connect(overtoneGain);
      overtoneGain.connect(mix);
      return { output: mix, oscillators: [fundamental, overtone] };
    },
  },
  {
    id: "organ",
    label: "Organ",
    attack: 0.01,
    peak: 0.26,
    sustain: 0.26,
    decayTime: 0.05,
    release: 0.05,
    createVoice(ctx, freq) {
      const mix = ctx.createGain();
      const harmonics = [1, 2, 3];
      const gains = [1, 0.55, 0.3];
      const oscillators = harmonics.map((h, i) => {
        const osc = createOsc(ctx, "sine", freq * h);
        const gain = ctx.createGain();
        gain.gain.value = gains[i];
        osc.connect(gain);
        gain.connect(mix);
        return osc;
      });
      return { output: mix, oscillators };
    },
  },
  {
    id: "synth",
    label: "Synth",
    attack: 0.008,
    peak: 0.28,
    sustain: 0.18,
    decayTime: 0.25,
    release: 0.15,
    createVoice(ctx, freq) {
      const oscA = createOsc(ctx, "sawtooth", freq, -6);
      const oscB = createOsc(ctx, "sawtooth", freq, 6);
      const mix = ctx.createGain();
      oscA.connect(mix);
      oscB.connect(mix);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.min(9000, freq * 10);
      filter.Q.value = 0.7;
      mix.connect(filter);
      return { output: filter, oscillators: [oscA, oscB] };
    },
  },
  {
    id: "saxophone",
    label: "Saxophone",
    attack: 0.06,
    peak: 0.3,
    sustain: 0.22,
    decayTime: 0.2,
    release: 0.2,
    createVoice(ctx, freq) {
      const osc = createOsc(ctx, "sawtooth", freq);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = Math.min(2400, freq * 3);
      filter.Q.value = 3;
      const lfo = createOsc(ctx, "sine", 5.5);
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.012;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(filter);
      return { output: filter, oscillators: [osc, lfo] };
    },
  },
  {
    id: "strings",
    label: "Strings",
    attack: 0.35,
    peak: 0.22,
    sustain: 0.2,
    decayTime: 0.3,
    release: 0.6,
    createVoice(ctx, freq) {
      const oscA = createOsc(ctx, "sawtooth", freq, -8);
      const oscB = createOsc(ctx, "sawtooth", freq, 8);
      const mix = ctx.createGain();
      oscA.connect(mix);
      oscB.connect(mix);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.min(6000, freq * 6);
      filter.Q.value = 0.5;
      mix.connect(filter);
      return { output: filter, oscillators: [oscA, oscB] };
    },
  },
];

const INSTRUMENTS_BY_ID = Object.fromEntries(
  INSTRUMENTS.map((def) => [def.id, def])
) as Record<InstrumentId, InstrumentDef>;

type ActiveNote = {
  ampGain: GainNode;
  oscillators: OscillatorNode[];
  release: number;
};

function HamburgerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="h-5 w-5"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

export default function Piano() {
  const [octaveCount, setOctaveCount] = useState<number | null>(null);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [instrumentId, setInstrumentId] = useState<InstrumentId>("piano");

  const menuRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNotesRef = useRef<Map<string, ActiveNote>>(new Map());

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

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

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
    const def = INSTRUMENTS_BY_ID[instrumentId];
    const now = ctx.currentTime;
    const freq = midiToFreq(key.midi);

    const voice = def.createVoice(ctx, freq);
    const ampGain = ctx.createGain();
    ampGain.gain.setValueAtTime(0.0001, now);
    ampGain.gain.exponentialRampToValueAtTime(def.peak, now + def.attack);
    // Ramp down to the sustain level and then hold — no further automation
    // is scheduled, so the note keeps sounding until releaseKey() fires.
    ampGain.gain.exponentialRampToValueAtTime(
      def.sustain,
      now + def.attack + def.decayTime
    );

    voice.output.connect(ampGain);
    ampGain.connect(ctx.destination);

    activeNotesRef.current.set(key.id, {
      ampGain,
      oscillators: voice.oscillators,
      release: def.release,
    });
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

    active.ampGain.gain.cancelScheduledValues(now);
    active.ampGain.gain.setValueAtTime(active.ampGain.gain.value, now);
    active.ampGain.gain.exponentialRampToValueAtTime(0.0001, now + active.release);
    active.oscillators.forEach((osc) => osc.stop(now + active.release + 0.02));

    activeNotesRef.current.delete(key.id);
  }

  function keyPointerHandlers(key: PianoKey) {
    return {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture is best-effort; ignore if unsupported.
        }
        pressKey(key);
      },
      onPointerUp: () => releaseKey(key),
      onPointerCancel: () => releaseKey(key),
      onLostPointerCapture: () => releaseKey(key),
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
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
      style={{ touchAction: "none", WebkitUserSelect: "none" }}
    >
      <div ref={menuRef} className="absolute top-2 left-2 z-30">
        <button
          type="button"
          aria-label="Settings"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-white/95 text-zinc-700 shadow ring-1 ring-zinc-300"
        >
          <HamburgerIcon />
        </button>

        {menuOpen && (
          <div className="mt-2 w-56 rounded-lg bg-white p-3 text-zinc-800 shadow-lg ring-1 ring-zinc-200">
            <label className="flex items-center justify-between gap-2 py-1 text-sm">
              <span>Note labels</span>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
            </label>

            <div className="mt-2 border-t border-zinc-200 pt-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Instrument
              </p>
              <div className="flex flex-col gap-1">
                {INSTRUMENTS.map((def) => (
                  <label
                    key={def.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="instrument"
                      checked={instrumentId === def.id}
                      onChange={() => setInstrumentId(def.id)}
                    />
                    {def.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {white.map((key, index) => {
        const isPressed = pressed.has(key.id);
        return (
          <button
            key={key.id}
            aria-label={`${key.note}${key.octave}`}
            {...keyPointerHandlers(key)}
            className={`absolute bottom-0 top-0 flex items-end justify-center border border-zinc-300 rounded-b-md pb-2 text-xs font-medium text-zinc-400 transition-colors ${
              isPressed ? "bg-zinc-200" : "bg-white"
            }`}
            style={{
              left: `${index * whiteKeyWidthPct}%`,
              width: `${whiteKeyWidthPct}%`,
              touchAction: "none",
              WebkitTouchCallout: "none",
            }}
          >
            {showLabels ? `${key.note}${key.octave}` : null}
          </button>
        );
      })}

      {black.map((key) => {
        const isPressed = pressed.has(key.id);
        return (
          <button
            key={key.id}
            aria-label={`${key.note}${key.octave}`}
            {...keyPointerHandlers(key)}
            className={`absolute top-0 z-10 flex items-end justify-center rounded-b-md pb-1 text-[10px] font-medium text-zinc-400 transition-colors ${
              isPressed ? "bg-zinc-700" : "bg-zinc-900"
            }`}
            style={{
              left: `${
                (key.globalWhiteIndexBefore + 1) * whiteKeyWidthPct -
                blackKeyWidthPct / 2
              }%`,
              width: `${blackKeyWidthPct}%`,
              height: "60%",
              touchAction: "none",
              WebkitTouchCallout: "none",
            }}
          >
            {showLabels ? key.note.replace("#", "♯") : null}
          </button>
        );
      })}
    </div>
  );
}
