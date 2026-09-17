"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type PianoKey,
  buildKeys,
  computeOctaveCount,
  midiToFreq,
} from "@/lib/music";
import { INSTRUMENTS, INSTRUMENTS_BY_ID, type InstrumentId } from "@/lib/instruments";
import { SONGS, SONGS_BY_ID, buildTimeline, type TimelineEvent } from "@/lib/songs";

type ActiveNote = {
  ampGain: GainNode;
  oscillators: OscillatorNode[];
  release: number;
};

type HighwayNote = TimelineEvent & {
  leftPct: number;
  widthPct: number;
  isBlack: boolean;
};

// How many seconds of upcoming notes are visible in the highway at once.
// Faster songs pack notes closer together here, which is what visually
// communicates tempo.
const LOOKAHEAD_SECONDS = 2.5;
// Pause before playback starts, so the player can get their hands in
// position before the first note arrives.
const LEAD_IN_MS = 3000;

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

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export default function Piano() {
  const [octaveCount, setOctaveCount] = useState<number | null>(null);
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [instrumentId, setInstrumentId] = useState<InstrumentId>("piano");
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [isSongPlaying, setIsSongPlaying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [songActiveMidis, setSongActiveMidis] = useState<Set<number>>(new Set());
  const [highwayNotes, setHighwayNotes] = useState<HighwayNote[] | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const highwayRef = useRef<HTMLDivElement>(null);
  const noteBarRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNotesRef = useRef<Map<string, ActiveNote>>(new Map());
  const instrumentIdRef = useRef(instrumentId);
  const songTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const playbackStartRef = useRef(0);
  const playingRef = useRef(false);
  // Ref mirror of `highwayNotes` state so the rAF loop always reads the
  // latest value without needing to be re-created every render.
  const highwayNotesRef = useRef<HighwayNote[] | null>(null);
  highwayNotesRef.current = highwayNotes;

  useEffect(() => {
    instrumentIdRef.current = instrumentId;
  }, [instrumentId]);

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

  // Stop any song playback on unmount.
  useEffect(() => {
    return () => {
      songTimeoutsRef.current.forEach(clearTimeout);
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const layout = useMemo(() => {
    const { white, black } = buildKeys(octaveCount ?? 3);
    const whiteKeyWidthPct = 100 / white.length;
    const blackKeyWidthPct = whiteKeyWidthPct * 0.62;
    const keyLookup = new Map<
      number,
      { leftPct: number; widthPct: number; isBlack: boolean }
    >();

    white.forEach((key, index) => {
      keyLookup.set(key.midi, {
        leftPct: index * whiteKeyWidthPct,
        widthPct: whiteKeyWidthPct,
        isBlack: false,
      });
    });
    black.forEach((key) => {
      keyLookup.set(key.midi, {
        leftPct:
          (key.globalWhiteIndexBefore + 1) * whiteKeyWidthPct -
          blackKeyWidthPct / 2,
        widthPct: blackKeyWidthPct,
        isBlack: true,
      });
    });

    return { white, black, whiteKeyWidthPct, blackKeyWidthPct, keyLookup };
  }, [octaveCount]);

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

  // --- Core audio (shared by manual key presses and song playback) -----

  function startNote(id: string, midi: number) {
    if (activeNotesRef.current.has(id)) return;

    const ctx = getAudioContext();
    const def = INSTRUMENTS_BY_ID[instrumentIdRef.current];
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);

    const voice = def.createVoice(ctx, freq);
    const ampGain = ctx.createGain();
    ampGain.gain.setValueAtTime(0.0001, now);
    ampGain.gain.exponentialRampToValueAtTime(def.peak, now + def.attack);
    // Ramp down to the sustain level and then hold — no further automation
    // is scheduled, so the note keeps sounding until stopNote() fires.
    ampGain.gain.exponentialRampToValueAtTime(
      def.sustain,
      now + def.attack + def.decayTime
    );

    voice.output.connect(ampGain);
    ampGain.connect(ctx.destination);

    activeNotesRef.current.set(id, {
      ampGain,
      oscillators: voice.oscillators,
      release: def.release,
    });
  }

  function stopNote(id: string) {
    const active = activeNotesRef.current.get(id);
    if (!active) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    active.ampGain.gain.cancelScheduledValues(now);
    active.ampGain.gain.setValueAtTime(active.ampGain.gain.value, now);
    active.ampGain.gain.exponentialRampToValueAtTime(0.0001, now + active.release);
    active.oscillators.forEach((osc) => osc.stop(now + active.release + 0.02));

    activeNotesRef.current.delete(id);
  }

  // --- Manual key press/release (pointer-driven) ------------------------

  function pressKey(key: PianoKey) {
    startNote(key.id, key.midi);
    setPressed((prev) => new Set(prev).add(key.id));
  }

  function releaseKey(key: PianoKey) {
    stopNote(key.id);
    setPressed((prev) => {
      if (!prev.has(key.id)) return prev;
      const next = new Set(prev);
      next.delete(key.id);
      return next;
    });
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

  // --- Song playback ------------------------------------------------------

  function stopSongPlayback() {
    songTimeoutsRef.current.forEach(clearTimeout);
    songTimeoutsRef.current = [];
    playingRef.current = false;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    setSongActiveMidis(new Set());
    setHighwayNotes(null);
    setIsSongPlaying(false);
    setCountdown(null);
  }

  // Practice mode: the highway and key highlights show what to play and
  // when, but nothing sounds until the player presses the key themselves —
  // startNote()/stopNote() are never called for song events.
  function startSongPlayback(songId: string) {
    const song = SONGS_BY_ID[songId];
    if (!song) return;
    stopSongPlayback();

    const { events, totalSec } = buildTimeline(song);
    const highway: HighwayNote[] = [];

    events.forEach((event) => {
      const position = layout.keyLookup.get(event.midi);
      if (position) {
        highway.push({ ...event, ...position });
      }

      const timeoutOn = setTimeout(() => {
        setSongActiveMidis((prev) => new Set(prev).add(event.midi));
      }, LEAD_IN_MS + event.startSec * 1000);

      // A small gap before the note ends keeps repeated notes distinct.
      const timeoutOff = setTimeout(() => {
        setSongActiveMidis((prev) => {
          const next = new Set(prev);
          next.delete(event.midi);
          return next;
        });
      }, LEAD_IN_MS + (event.startSec + event.durationSec * 0.92) * 1000);

      songTimeoutsRef.current.push(timeoutOn, timeoutOff);
    });

    songTimeoutsRef.current.push(
      setTimeout(() => stopSongPlayback(), LEAD_IN_MS + totalSec * 1000 + 300)
    );

    // Lead-in countdown, purely for the on-screen "get ready" display.
    setCountdown(Math.ceil(LEAD_IN_MS / 1000));
    for (let secondsLeft = Math.ceil(LEAD_IN_MS / 1000) - 1; secondsLeft > 0; secondsLeft--) {
      songTimeoutsRef.current.push(
        setTimeout(
          () => setCountdown(secondsLeft),
          LEAD_IN_MS - secondsLeft * 1000
        )
      );
    }
    songTimeoutsRef.current.push(setTimeout(() => setCountdown(null), LEAD_IN_MS));

    setHighwayNotes(highway);
    setIsSongPlaying(true);
    playingRef.current = true;
    // The song's t=0 is LEAD_IN_MS in the future; the highway loop below
    // naturally handles the countdown since elapsedSec starts out negative.
    playbackStartRef.current = performance.now() + LEAD_IN_MS;
    rafIdRef.current = requestAnimationFrame(tickHighway);
  }

  function tickHighway() {
    if (!playingRef.current) return;
    const container = highwayRef.current;
    if (container) {
      const containerHeight = container.clientHeight;
      const pxPerSecond = containerHeight / LOOKAHEAD_SECONDS;
      const elapsedSec = (performance.now() - playbackStartRef.current) / 1000;

      noteBarRefs.current.forEach((el, index) => {
        const event = highwayNotesRef.current?.find((e) => e.index === index);
        if (!event) return;
        const timeUntilStart = event.startSec - elapsedSec;
        const bottomPx = containerHeight - timeUntilStart * pxPerSecond;
        const heightPx = Math.max(4, event.durationSec * pxPerSecond - 2);
        const topPx = bottomPx - heightPx;

        el.style.transform = `translateY(${topPx}px)`;
        el.style.height = `${heightPx}px`;
        el.style.opacity =
          bottomPx < -20 || topPx > containerHeight + 20 ? "0" : "1";
      });
    }
    rafIdRef.current = requestAnimationFrame(tickHighway);
  }

  function handleSelectSong(id: string | null) {
    stopSongPlayback();
    setSelectedSongId(id);
  }

  const selectedSong = selectedSongId ? SONGS_BY_ID[selectedSongId] : null;
  const { white, black, whiteKeyWidthPct, blackKeyWidthPct } = layout;

  if (octaveCount === null) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="relative flex h-full w-full flex-col select-none">
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
          <div className="mt-2 w-64 rounded-lg bg-white p-3 text-zinc-800 shadow-lg ring-1 ring-zinc-200">
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
                  <label key={def.id} className="flex items-center gap-2 text-sm">
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

            <div className="mt-2 border-t border-zinc-200 pt-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Song
              </p>
              <select
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                value={selectedSongId ?? ""}
                onChange={(e) => handleSelectSong(e.target.value || null)}
              >
                <option value="">Free play (no song)</option>
                {SONGS.map((song) => (
                  <option key={song.id} value={song.id}>
                    {song.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {selectedSong && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
          <span className="hidden rounded bg-white/90 px-2 py-1 text-xs font-medium text-zinc-700 shadow ring-1 ring-zinc-300 sm:inline-block">
            {selectedSong.title} · ♩={selectedSong.bpm}
          </span>
          <button
            type="button"
            aria-label={isSongPlaying ? "Stop" : "Play"}
            onClick={() =>
              isSongPlaying ? stopSongPlayback() : startSongPlayback(selectedSong.id)
            }
            className="flex h-9 w-9 items-center justify-center rounded-md bg-white/95 text-zinc-700 shadow ring-1 ring-zinc-300"
          >
            {isSongPlaying ? <StopIcon /> : <PlayIcon />}
          </button>
        </div>
      )}

      {selectedSong && (
        <div
          ref={highwayRef}
          className="relative w-full flex-none overflow-hidden bg-zinc-900"
          style={{ height: "min(28vh, 200px)" }}
        >
          {highwayNotes?.map((note) => (
            <div
              key={note.index}
              ref={(el) => {
                if (el) noteBarRefs.current.set(note.index, el);
                else noteBarRefs.current.delete(note.index);
              }}
              className={`absolute top-0 rounded-sm ${
                note.isBlack ? "bg-amber-400" : "bg-sky-400"
              }`}
              style={{
                left: `${note.leftPct + note.widthPct * 0.1}%`,
                width: `${note.widthPct * 0.8}%`,
                opacity: 0,
              }}
            />
          ))}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/70" />

          {countdown !== null && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-zinc-900/80 text-white">
              <span className="text-4xl font-bold tabular-nums">{countdown}</span>
              <span className="text-xs uppercase tracking-wide text-zinc-300">
                Get ready
              </span>
            </div>
          )}
        </div>
      )}

      <div className="relative w-full flex-1">
        {white.map((key, index) => {
          const isGuided = songActiveMidis.has(key.midi);
          const isUserPressed = pressed.has(key.id);
          const color = isGuided && isUserPressed
            ? "bg-emerald-300"
            : isGuided
            ? "bg-sky-200"
            : isUserPressed
            ? "bg-zinc-200"
            : "bg-white";
          return (
            <button
              key={key.id}
              aria-label={`${key.note}${key.octave}`}
              {...keyPointerHandlers(key)}
              className={`absolute bottom-0 top-0 flex items-end justify-center border border-zinc-300 rounded-b-md pb-2 text-xs font-medium text-zinc-400 transition-colors ${color}`}
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
          const isGuided = songActiveMidis.has(key.midi);
          const isUserPressed = pressed.has(key.id);
          const color = isGuided && isUserPressed
            ? "bg-emerald-600"
            : isGuided
            ? "bg-sky-600"
            : isUserPressed
            ? "bg-zinc-700"
            : "bg-zinc-900";
          return (
            <button
              key={key.id}
              aria-label={`${key.note}${key.octave}`}
              {...keyPointerHandlers(key)}
              className={`absolute top-0 z-10 flex items-end justify-center rounded-b-md pb-1 text-[10px] font-medium text-zinc-400 transition-colors ${color}`}
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
    </div>
  );
}
