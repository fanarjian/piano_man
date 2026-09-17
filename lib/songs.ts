import { parseNoteName } from "./music";

// A tiny curated library of public-domain melodies (right-hand only).
// `note: null` is a rest. `beats` is duration in quarter-note beats.
export type SongNote = { note: string | null; beats: number };
export type Song = {
  id: string;
  title: string;
  composer?: string;
  bpm: number;
  notes: SongNote[];
};

function n(note: string, beats = 1): SongNote {
  return { note, beats };
}

export const SONGS: Song[] = [
  {
    id: "twinkle",
    title: "Twinkle Twinkle Little Star",
    composer: "Traditional",
    bpm: 100,
    notes: [
      n("C4"), n("C4"), n("G4"), n("G4"), n("A4"), n("A4"), n("G4", 2),
      n("F4"), n("F4"), n("E4"), n("E4"), n("D4"), n("D4"), n("C4", 2),
      n("G4"), n("G4"), n("F4"), n("F4"), n("E4"), n("E4"), n("D4", 2),
      n("G4"), n("G4"), n("F4"), n("F4"), n("E4"), n("E4"), n("D4", 2),
      n("C4"), n("C4"), n("G4"), n("G4"), n("A4"), n("A4"), n("G4", 2),
      n("F4"), n("F4"), n("E4"), n("E4"), n("D4"), n("D4"), n("C4", 2),
    ],
  },
  {
    id: "mary-lamb",
    title: "Mary Had a Little Lamb",
    composer: "Traditional",
    bpm: 110,
    notes: [
      n("E4"), n("D4"), n("C4"), n("D4"), n("E4"), n("E4"), n("E4", 2),
      n("D4"), n("D4"), n("D4", 2),
      n("E4"), n("G4"), n("G4", 2),
      n("E4"), n("D4"), n("C4"), n("D4"), n("E4"), n("E4"), n("E4"), n("E4"),
      n("D4"), n("D4"), n("E4"), n("D4"), n("C4", 4),
    ],
  },
  {
    id: "ode-to-joy",
    title: "Ode to Joy",
    composer: "Beethoven",
    bpm: 120,
    notes: [
      n("E4"), n("E4"), n("F4"), n("G4"), n("G4"), n("F4"), n("E4"), n("D4"),
      n("C4"), n("C4"), n("D4"), n("E4"), n("E4", 1.5), n("D4", 0.5), n("D4", 2),
      n("E4"), n("E4"), n("F4"), n("G4"), n("G4"), n("F4"), n("E4"), n("D4"),
      n("C4"), n("C4"), n("D4"), n("E4"), n("D4", 1.5), n("C4", 0.5), n("C4", 2),
    ],
  },
  {
    id: "hot-cross-buns",
    title: "Hot Cross Buns",
    composer: "Traditional",
    bpm: 100,
    notes: [
      n("E4"), n("D4"), n("C4", 2),
      n("E4"), n("D4"), n("C4", 2),
      n("C4", 0.5), n("C4", 0.5), n("C4", 0.5), n("C4", 0.5),
      n("D4", 0.5), n("D4", 0.5), n("D4", 0.5), n("D4", 0.5),
      n("E4"), n("D4"), n("C4", 2),
    ],
  },
  {
    id: "row-row-row",
    title: "Row, Row, Row Your Boat",
    composer: "Traditional",
    bpm: 100,
    notes: [
      n("C4"), n("C4"), n("C4", 0.67), n("D4", 0.33), n("E4", 2),
      n("E4", 0.67), n("D4", 0.33), n("E4", 0.67), n("F4", 0.33), n("G4", 4),
      n("C5", 0.33), n("C5", 0.33), n("C5", 0.33),
      n("G4", 0.33), n("G4", 0.33), n("G4", 0.33),
      n("E4", 0.33), n("E4", 0.33), n("E4", 0.33),
      n("C4", 0.33), n("C4", 0.33), n("C4", 0.33),
      n("G4"), n("F4"), n("E4"), n("D4"), n("C4", 4),
    ],
  },
  {
    id: "jingle-bells",
    title: "Jingle Bells (chorus)",
    composer: "James Lord Pierpont",
    bpm: 120,
    notes: [
      n("E4"), n("E4"), n("E4", 2),
      n("E4"), n("E4"), n("E4", 2),
      n("E4"), n("G4"), n("C4"), n("D4"), n("E4", 4),
      n("F4"), n("F4"), n("F4"), n("F4"),
      n("F4"), n("E4"), n("E4"), n("E4"), n("E4"),
      n("D4"), n("D4"), n("E4"), n("D4", 2), n("G4", 2),
      n("E4"), n("E4"), n("E4", 2),
      n("E4"), n("E4"), n("E4", 2),
      n("E4"), n("G4"), n("C4"), n("D4"), n("E4", 4),
      n("F4"), n("F4"), n("F4"), n("F4"),
      n("F4"), n("E4"), n("E4"), n("E4"), n("G4"),
      n("G4"), n("F4"), n("D4"), n("C4", 4),
    ],
  },
];

export const SONGS_BY_ID = Object.fromEntries(
  SONGS.map((song) => [song.id, song])
) as Record<string, Song>;

export type TimelineEvent = {
  index: number;
  midi: number;
  startSec: number;
  durationSec: number;
};

export function buildTimeline(song: Song) {
  const secondsPerBeat = 60 / song.bpm;
  let beatCursor = 0;
  const events: TimelineEvent[] = [];

  song.notes.forEach((note, index) => {
    if (note.note) {
      events.push({
        index,
        midi: parseNoteName(note.note),
        startSec: beatCursor * secondsPerBeat,
        durationSec: note.beats * secondsPerBeat,
      });
    }
    beatCursor += note.beats;
  });

  return { events, totalSec: beatCursor * secondsPerBeat };
}
