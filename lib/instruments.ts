// Each instrument builds its own little oscillator graph ("voice") for a
// note. A shared gain node layered on top by the caller shapes the
// attack/decay/release envelope — the sustain phase just holds the gain
// flat, so the note keeps sounding for as long as the key is held.

export type InstrumentId =
  | "piano"
  | "electricPiano"
  | "organ"
  | "synth"
  | "saxophone"
  | "strings";

export type Voice = {
  output: AudioNode;
  oscillators: OscillatorNode[];
};

export type InstrumentDef = {
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

export const INSTRUMENTS: InstrumentDef[] = [
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

export const INSTRUMENTS_BY_ID = Object.fromEntries(
  INSTRUMENTS.map((def) => [def.id, def])
) as Record<InstrumentId, InstrumentDef>;
