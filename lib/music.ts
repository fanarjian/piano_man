// Shared note-name / key-layout math used by both the keyboard and the
// song playback engine.

export const NOTE_NAMES = [
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
export const WHITE_NOTE_INDEXES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
// Each black key sits right after a specific white key within the octave.
export const BLACK_KEYS_AFTER_WHITE = [
  { noteIndex: 1, afterWhite: 0 }, // C#
  { noteIndex: 3, afterWhite: 1 }, // D#
  { noteIndex: 6, afterWhite: 3 }, // F#
  { noteIndex: 8, afterWhite: 4 }, // G#
  { noteIndex: 10, afterWhite: 5 }, // A#
];

export type PianoKey = {
  id: string;
  note: string;
  octave: number;
  midi: number;
};

export type BlackKey = PianoKey & { globalWhiteIndexBefore: number };

export function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Parses names like "C4", "F#3", "A#5" into a MIDI note number.
export function parseNoteName(name: string): number {
  const match = /^([A-G]#?)(\d)$/.exec(name);
  if (!match) throw new Error(`Invalid note name: ${name}`);
  const [, letter, octaveStr] = match;
  const noteIndex = NOTE_NAMES.indexOf(letter);
  const octave = parseInt(octaveStr, 10);
  return 12 * (octave + 1) + noteIndex;
}

export function computeOctaveCount(width: number, height: number) {
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

export function buildKeys(octaveCount: number) {
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
