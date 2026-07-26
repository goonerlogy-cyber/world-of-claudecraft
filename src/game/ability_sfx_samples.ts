// The ability sample seam: routing tables (release families, motif foley,
// spirit voices, per-ability overrides), per-take peak normalization, and the
// gallery's BEEF BUS per-voice chain (tanh saturation drive + low-shelf body +
// presence bite, drive-compensated). The procedural synth layer in
// src/game/sfx.ts plays every ability moment; a sampled pack, when one ships,
// layers on top of it with synthesis staying underneath as the
// sub-weight/crit-sting layer (the hybrid model approved in the gallery,
// arc_bolt_preview.js Sfx).
//
// NO SAMPLED PACK SHIPS TODAY. `load()` below is intentionally never called:
// the takes must first land as individually conformed MP3s through the
// scripts/sfx/ pipeline (docs/design/sound_effects.md; npm run sfx:check gates
// loudness, bitrate and true peak, and the SFX Studio owns preview/mastering).
// Until then `has()` is empty, every samplePlay falls through to synthesis, and
// nothing fetches. Re-enable by restoring the load() call in sfx.ts init().

/** Where a pack would ship from (vite public/ in dev, static hosting in prod:
 *  the same origin-relative path convention as every clip url in
 *  sfx_manifest.generated.ts). Unused until a conformed pack lands. */
export const ABILITY_SFX_PACK_URL = '/audio/sfx/ability_sfx_pack.json';

/** Release whoosh families: 12 palettes fold onto the 8 recorded rel_ ids
 *  (gallery RELEASE_FAM). */
export const RELEASE_FAMILY: Readonly<Record<string, string>> = {
  fire: 'fire',
  blood: 'fire',
  frost: 'frost',
  moon: 'frost',
  arcane: 'arcane',
  shadow: 'shadow',
  venom: 'shadow',
  holy: 'holy',
  gold: 'holy',
  nature: 'nature',
  storm: 'storm',
  physical: 'physical',
};

/** Set-piece motif foley ids (gallery MOTIF_SAMPLE); motifs without an entry
 *  simply keep their visual-only read. */
export const MOTIF_SAMPLE: Readonly<Record<string, string>> = {
  fissure: 'motif_fissure',
  gavel: 'motif_gavel',
  chains: 'motif_chains',
  vines: 'motif_vines',
  pillars: 'motif_pillars',
  crescents: 'motif_slashes',
  bladestorm: 'motif_slashes',
  implosion: 'motif_implosion',
  swarm: 'motif_swarm',
};

/** Spirit-call mix per creature model: [gain, soft]. The screechers sit back
 *  in the mix behind a top-shave lowpass; the growlers stay forward (gallery
 *  SPIRIT_VOICE). Models without an entry play forward at 0.8. The four-legged
 *  growlers sit forward and a touch hotter so the beast reads animalistic
 *  (the audio engine also doubles them an octave down for chest body). */
export const SPIRIT_VOICE: Readonly<Record<string, readonly [number, boolean]>> = {
  raptor: [0.5, true],
  hawk: [0.45, true],
  fox: [0.45, true],
  ghost: [0.55, true],
  sheep: [0.7, false],
  bear: [0.9, false],
  wolf: [0.85, false],
  bull: [0.9, false],
};

/** Models whose growl earns a chest-cavity octave-down double so the beast
 *  reads as a real animal, not a thin sampled bark (owner druid review:
 *  bear_form / feral_charge / tigers_fury wanted a beastlier voice). */
export const SPIRIT_GROWLERS: ReadonlySet<string> = new Set(['bear', 'wolf', 'bull']);

/** Per-ability audio identity overrides. Some abilities LOOK one element but
 *  should SOUND like another (a green nature bolt that whooshes like wind, not
 *  fire) - or their palette impact lands too soft / too hot for their read.
 *  This reroutes the sound WITHOUT touching the visual palette or color: the
 *  renderer keeps its authored look, the audio engine keys on the ability id.
 *  Only existing pack ids / procedural recipes are used here - anything that
 *  genuinely needs a new bespoke recording (an insect buzz, a real tornado,
 *  a water rush, a wolf howl, a bone crunch) stays a follow-up, never a
 *  mis-mapped placeholder. (Owner druid review round.) */
export interface AbilityAudioOverride {
  /** Reroute the release whoosh to this palette's rel_ family (RELEASE_FAMILY
   *  key). The green wrath bolt whooshes like storm-wind, not a fire crackle. */
  release?: string;
  /** Force this impact pack id instead of the palette's imp_ identity. */
  impact?: string;
  /** Scale the impact weight up (>1, a heavier landing) or down (<1, tone a
   *  slam down) relative to the spec power. */
  impactPower?: number;
}

export const ABILITY_AUDIO_OVERRIDES: Readonly<Record<string, AbilityAudioOverride>> = {
  // A wind bolt, not a fire spell: the green coil stays, the whoosh goes windy.
  wrath: { release: 'storm' },
  // Interim cold-water rush until a true water-rush sample exists (follow-up):
  // frost reads as rushing cold air/water, never fire.
  typhoon: { release: 'frost' },
  // The stellar finisher was landing underwhelming - let the moon impact hit
  // with real weight.
  starfire: { impactPower: 1.9 },
  // A blunt interrupt should THUMP: drive the physical body/sub harder.
  skull_bash: { impactPower: 1.7 },
  // The paw slam was over the top - pull the landing back down.
  maul: { impactPower: 0.68 },
};

/** Per-take peak normalization at decode (gallery loadPack): pull every take
 *  to a consistent 0.8 peak so the category mix stays predictable, capped so
 *  a near-silent render can never be boosted into noise. */
export function normalizeTakeGain(peak: number): number {
  return peak > 0.01 ? Math.min(2.5, 0.8 / peak) : 1;
}

// Cached soft-saturation transfer curves (gallery _beefCurve): crunch without
// fizz. Keyed on the quantized drive amount so the handful of distinct beef
// levels share Float32Arrays across every voice, zero steady-state allocs.
const beefCurves = new Map<number, Float32Array<ArrayBuffer>>();

export function beefCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(amount * 20);
  let curve = beefCurves.get(key);
  if (!curve) {
    const k = 1 + amount * 6;
    const norm = Math.tanh(k);
    curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = i / 511.5 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    beefCurves.set(key, curve);
  }
  return curve;
}

/** The BEEF BUS per-voice chain (gallery sample()): WaveShaper saturation ->
 *  low-shelf 170 Hz body -> presence peak 2.7 kHz (or, for `soft` voices, a
 *  4.2 kHz top-shave lowpass instead of the bite) -> dest. Returns the chain
 *  input. The caller applies the 1/(1 + beef * 0.5) drive compensation. */
export function buildBeefChain(
  ctx: BaseAudioContext,
  dest: AudioNode,
  beef: number,
  soft: boolean,
): AudioNode {
  const shaper = ctx.createWaveShaper();
  shaper.curve = beefCurve(beef);
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'lowshelf';
  shelf.frequency.value = 170;
  shelf.gain.value = 3 + beef * 5;
  let tail: AudioNode = shelf;
  if (soft) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = 0.6;
    shelf.connect(lp);
    tail = lp;
  } else {
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2700;
    presence.Q.value = 0.9;
    presence.gain.value = 1.5 + beef * 3;
    shelf.connect(presence);
    tail = presence;
  }
  shaper.connect(shelf);
  tail.connect(dest);
  return shaper;
}

/** Screech-control chain for soft voices without beef: shave the piercing top
 *  instead of boosting it (gallery sample() soft path). */
export function buildSoftChain(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  lp.Q.value = 0.6;
  lp.connect(dest);
  return lp;
}

export type AbilityPackState = 'idle' | 'loading' | 'loaded' | 'unavailable';

interface SampleSet {
  bufs: AudioBuffer[];
  gains: number[];
  next: number;
}

function base64Bytes(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

// Positional ability cues are point sources: fold stereo decodes to mono so
// the PannerNode builds the spatial image from one retained channel (same
// policy as retainDecodedBuffer in sfx.ts for spatial catalog clips).
function foldToMono(ctx: BaseAudioContext, decoded: AudioBuffer): AudioBuffer {
  if (!(decoded.numberOfChannels > 1)) return decoded;
  const mono = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
  const output = mono.getChannelData(0);
  const scale = 1 / decoded.numberOfChannels;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const input = decoded.getChannelData(channel);
    for (let frame = 0; frame < decoded.length; frame++) output[frame] += input[frame] * scale;
  }
  return mono;
}

// Strided peak scan (gallery loadPack samples every 7th frame): plenty for a
// normalization estimate at a fraction of the walk.
function peakOf(buf: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i += 7) peak = Math.max(peak, Math.abs(data[i]));
  }
  return peak;
}

export class AbilitySfxSamples {
  private samples = new Map<string, SampleSet>();
  private stateValue: AbilityPackState = 'idle';
  private servedCount = 0;

  get state(): AbilityPackState {
    return this.stateValue;
  }

  get loaded(): boolean {
    return this.stateValue === 'loaded';
  }

  soundCount(): number {
    return this.samples.size;
  }

  /** Total takes handed out to voices, the dev probe's "a cast actually
   *  routed to a sampled voice" signal. */
  served(): number {
    return this.servedCount;
  }

  has(id: string): boolean {
    return this.samples.has(id);
  }

  /** Strict round-robin take selection (gallery sample()): consecutive plays
   *  of a multi-take id never repeat the same take. Starting offsets are
   *  randomized at load so two clients don't march in lockstep. */
  pick(id: string): { buf: AudioBuffer; gain: number } | null {
    const entry = this.samples.get(id);
    if (!entry) return null;
    const k = entry.next++ % entry.bufs.length;
    this.servedCount++;
    return { buf: entry.bufs[k], gain: entry.gains[k] };
  }

  /** Direct sample-set install; the seam tests (and any pre-decoded host) use
   *  instead of the fetch+decode path. */
  install(id: string, bufs: AudioBuffer[], gains: number[]): void {
    if (bufs.length === 0) return;
    this.samples.set(id, { bufs, gains, next: Math.floor(Math.random() * bufs.length) });
    this.stateValue = 'loaded';
  }

  /** Fetch + decode the pack. Lazy and non-blocking: takes decode serially
   *  with a macrotask yield between ids so the ~118-take pack never stalls
   *  the main thread; until this resolves the procedural layer carries every
   *  ability moment. Idempotent, repeat calls are no-ops. */
  async load(ctx: BaseAudioContext): Promise<void> {
    if (this.stateValue !== 'idle') return;
    if (typeof fetch !== 'function' || typeof atob !== 'function') {
      this.stateValue = 'unavailable';
      return;
    }
    this.stateValue = 'loading';
    try {
      const res = await fetch(ABILITY_SFX_PACK_URL, { credentials: 'same-origin' });
      if (!res.ok) {
        this.stateValue = 'unavailable';
        return;
      }
      const raw = (await res.json()) as Record<string, unknown>;
      for (const [id, takes] of Object.entries(raw)) {
        if (!Array.isArray(takes)) continue;
        const bufs: AudioBuffer[] = [];
        const gains: number[] = [];
        for (const b64 of takes) {
          if (typeof b64 !== 'string') continue;
          try {
            const decoded = await ctx.decodeAudioData(base64Bytes(b64));
            const buf = foldToMono(ctx, decoded);
            gains.push(normalizeTakeGain(peakOf(buf)));
            bufs.push(buf);
          } catch {
            /* corrupt take: drop it, keep the rest */
          }
        }
        if (bufs.length > 0) {
          this.samples.set(id, { bufs, gains, next: Math.floor(Math.random() * bufs.length) });
        }
        // yield between ids: decode work happens off-thread but the b64 ->
        // bytes walk and buffer folds are main-thread, spread them out
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.stateValue = this.samples.size > 0 ? 'loaded' : 'unavailable';
    } catch {
      this.stateValue = 'unavailable';
    }
  }
}

export const abilitySfxSamples = new AbilitySfxSamples();
