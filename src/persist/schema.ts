import {
  ATTACHMENT_IDS,
  DIFFICULTY_IDS,
  GADGET_IDS,
  MAP_IDS,
  PERK_IDS,
  PRIMARY_WEAPON_IDS,
  type AttachmentId,
  type DifficultyId,
  type GadgetId,
  type MapId,
  type PerkId,
  type PrimaryWeaponId,
} from '../content/ids';

// index.html:359-375 (slider ranges) and index.html:565 (defaults)
export const DPI_VALUES = [400, 800, 1600, 3200] as const;
export type Dpi = (typeof DPI_VALUES)[number];

export const QUALITY_IDS = ['high', 'low'] as const;
export type Quality = (typeof QUALITY_IDS)[number];

export const CROSSHAIR_STYLES = ['cross', 'dot', 'circle', 'tee'] as const;
export type CrosshairStyle = (typeof CROSSHAIR_STYLES)[number];

export const CROSSHAIR_COLOURS = ['default', 'green', 'cyan', 'magenta', 'amber'] as const;
export type CrosshairColour = (typeof CROSSHAIR_COLOURS)[number];

// Frame rate cap for the match. 0 means uncapped (the display's refresh rate).
export const FPS_CAPS = [0, 30, 60, 120] as const;
export type FpsCap = (typeof FPS_CAPS)[number];

export interface Settings {
  sens: number;
  adsMul: number;
  dpi: Dpi;
  fov: number;
  invertY: boolean;
  volume: number;
  // Mute silences the master bus without changing the stored volume (spec §1.6).
  muted: boolean;
  quality: Quality;
  showFps: boolean;
  shake: boolean;
  colorblind: boolean;
  crosshair: CrosshairStyle;
  crosshairColour: CrosshairColour;
  damageNumbers: boolean;
  reducedMotion: boolean;
  fpsCap: FpsCap;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  sens: 1.0,
  adsMul: 0.7,
  dpi: 800,
  fov: 75,
  invertY: false,
  volume: 0.8,
  muted: false,
  quality: 'high',
  showFps: false,
  shake: true,
  colorblind: false,
  crosshair: 'cross',
  crosshairColour: 'default',
  damageNumbers: true,
  reducedMotion: false,
  fpsCap: 0,
};

// index.html:567 (loadout defaults) and index.html:569-575 (gadget trimming)
export interface Loadout {
  primary: PrimaryWeaponId;
  attachment: AttachmentId;
  perk: PerkId;
  gadgets: [GadgetId, GadgetId];
  map: MapId;
  difficulty: DifficultyId;
}

export const DEFAULT_LOADOUT: Readonly<Loadout> = {
  primary: 'vx',
  attachment: 'reflex',
  perk: 'lightweight',
  gadgets: ['frag', 'smoke'],
  map: 'compound',
  difficulty: 'veteran',
};

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {};
}

function oneOf<T extends string | number>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((item) => item === value);
}

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

// Per-field validators: each returns the accepted value, or undefined when the field must fall back to its default.
export function validateSens(value: unknown): number | undefined {
  return clampNumber(value, 0.1, 3);
}

export function validateAdsMul(value: unknown): number | undefined {
  return clampNumber(value, 0.2, 1.2);
}

export function validateDpi(value: unknown): Dpi | undefined {
  return oneOf(DPI_VALUES, value);
}

export function validateFov(value: unknown): number | undefined {
  return clampNumber(value, 60, 110);
}

export function validateVolume(value: unknown): number | undefined {
  return clampNumber(value, 0, 1);
}

export function validateBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function validateQuality(value: unknown): Quality | undefined {
  return oneOf(QUALITY_IDS, value);
}

export function validateCrosshair(value: unknown): CrosshairStyle | undefined {
  return oneOf(CROSSHAIR_STYLES, value);
}

export function validateCrosshairColour(value: unknown): CrosshairColour | undefined {
  return oneOf(CROSSHAIR_COLOURS, value);
}

export function validateFpsCap(value: unknown): FpsCap | undefined {
  return oneOf(FPS_CAPS, value);
}

export function validatePrimary(value: unknown): PrimaryWeaponId | undefined {
  return oneOf(PRIMARY_WEAPON_IDS, value);
}

export function validateAttachment(value: unknown): AttachmentId | undefined {
  return oneOf(ATTACHMENT_IDS, value);
}

export function validatePerk(value: unknown): PerkId | undefined {
  return oneOf(PERK_IDS, value);
}

export function validateMap(value: unknown): MapId | undefined {
  return oneOf(MAP_IDS, value);
}

export function validateDifficulty(value: unknown): DifficultyId | undefined {
  return oneOf(DIFFICULTY_IDS, value);
}

// Legacy behaviour: drop unknown IDs, keep the first two, then fill the free slots from GADGET_IDS in order.
// Duplicates are dropped as well. Undefined when the value is not an array or holds no known gadget.
export function validateGadgets(value: unknown): [GadgetId, GadgetId] | undefined {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const picked: GadgetId[] = [];
  for (const item of list) {
    const id = oneOf(GADGET_IDS, item);
    if (id !== undefined && !picked.includes(id)) picked.push(id);
  }
  if (picked.length === 0) return undefined;
  const slots = picked.slice(0, 2);
  for (const id of GADGET_IDS) {
    if (slots.length >= 2) break;
    if (!slots.includes(id)) slots.push(id);
  }
  const [first, second] = slots;
  return first !== undefined && second !== undefined ? [first, second] : undefined;
}

export function sanitizeSettings(raw: unknown): Settings {
  const r = asRecord(raw);
  return {
    sens: validateSens(r.sens) ?? DEFAULT_SETTINGS.sens,
    adsMul: validateAdsMul(r.adsMul) ?? DEFAULT_SETTINGS.adsMul,
    dpi: validateDpi(r.dpi) ?? DEFAULT_SETTINGS.dpi,
    fov: validateFov(r.fov) ?? DEFAULT_SETTINGS.fov,
    invertY: validateBoolean(r.invertY) ?? DEFAULT_SETTINGS.invertY,
    volume: validateVolume(r.volume) ?? DEFAULT_SETTINGS.volume,
    muted: validateBoolean(r.muted) ?? DEFAULT_SETTINGS.muted,
    quality: validateQuality(r.quality) ?? DEFAULT_SETTINGS.quality,
    showFps: validateBoolean(r.showFps) ?? DEFAULT_SETTINGS.showFps,
    shake: validateBoolean(r.shake) ?? DEFAULT_SETTINGS.shake,
    colorblind: validateBoolean(r.colorblind) ?? DEFAULT_SETTINGS.colorblind,
    crosshair: validateCrosshair(r.crosshair) ?? DEFAULT_SETTINGS.crosshair,
    crosshairColour: validateCrosshairColour(r.crosshairColour) ?? DEFAULT_SETTINGS.crosshairColour,
    damageNumbers: validateBoolean(r.damageNumbers) ?? DEFAULT_SETTINGS.damageNumbers,
    reducedMotion: validateBoolean(r.reducedMotion) ?? DEFAULT_SETTINGS.reducedMotion,
    fpsCap: validateFpsCap(r.fpsCap) ?? DEFAULT_SETTINGS.fpsCap,
  };
}

export function sanitizeLoadout(raw: unknown): Loadout {
  const r = asRecord(raw);
  return {
    primary: validatePrimary(r.primary) ?? DEFAULT_LOADOUT.primary,
    attachment: validateAttachment(r.attachment) ?? DEFAULT_LOADOUT.attachment,
    perk: validatePerk(r.perk) ?? DEFAULT_LOADOUT.perk,
    gadgets: validateGadgets(r.gadgets) ?? [...DEFAULT_LOADOUT.gadgets],
    map: validateMap(r.map) ?? DEFAULT_LOADOUT.map,
    difficulty: validateDifficulty(r.difficulty) ?? DEFAULT_LOADOUT.difficulty,
  };
}
