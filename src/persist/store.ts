import type { Action } from '../content/ids';
import { Bindings } from '../input/bindings';
import { sanitizeProfile, type Profile } from './profile';
import { sanitizeLoadout, sanitizeSettings, type Loadout, type Settings } from './schema';

// Same keys as the legacy file (index.html). Changing one would drop existing players' data.
export const STORAGE_KEYS = {
  settings: 'bp_settings',
  loadout: 'bp_loadout',
  bindings: 'bp_binds',
  intro: 'bp_intro',
  profile: 'bp_profile',
} as const;

// Looked up at call time, never at module load. Accessing localStorage can throw (blocked site data).
function resolveStorage(storage: Storage | undefined): Storage | undefined {
  if (storage !== undefined) return storage;
  try {
    const store: Storage | undefined = globalThis.localStorage;
    return store;
  } catch {
    return undefined;
  }
}

function readJson(key: string, storage: Storage | undefined): unknown {
  try {
    const text = resolveStorage(storage)?.getItem(key);
    return typeof text === 'string' ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function writeRaw(key: string, text: string, storage: Storage | undefined): void {
  try {
    resolveStorage(storage)?.setItem(key, text);
  } catch {
    // Storage blocked or full: the game keeps running and the settings simply do not persist.
  }
}

function writeJson(key: string, value: unknown, storage: Storage | undefined): void {
  writeRaw(key, JSON.stringify(value), storage);
}

export function loadSettings(storage?: Storage): Settings {
  return sanitizeSettings(readJson(STORAGE_KEYS.settings, storage));
}

export function saveSettings(s: Settings, storage?: Storage): void {
  writeJson(STORAGE_KEYS.settings, sanitizeSettings(s), storage);
}

export function loadLoadout(storage?: Storage): Loadout {
  return sanitizeLoadout(readJson(STORAGE_KEYS.loadout, storage));
}

export function saveLoadout(l: Loadout, storage?: Storage): void {
  writeJson(STORAGE_KEYS.loadout, sanitizeLoadout(l), storage);
}

export function loadProfile(storage?: Storage): Profile {
  return sanitizeProfile(readJson(STORAGE_KEYS.profile, storage));
}

export function saveProfile(p: Profile, storage?: Storage): void {
  writeJson(STORAGE_KEYS.profile, sanitizeProfile(p), storage);
}

export function loadBindings(storage?: Storage): Record<Action, string> {
  return new Bindings(readJson(STORAGE_KEYS.bindings, storage)).toJSON();
}

export function saveBindings(b: Readonly<Record<Action, string>>, storage?: Storage): void {
  writeJson(STORAGE_KEYS.bindings, new Bindings(b).toJSON(), storage);
}

// The intro flag is a raw '1', as the legacy file writes it. Any non-empty value counts as seen.
export function hasSeenIntro(storage?: Storage): boolean {
  try {
    const flag = resolveStorage(storage)?.getItem(STORAGE_KEYS.intro);
    return typeof flag === 'string' && flag !== '';
  } catch {
    return false;
  }
}

export function markIntroSeen(storage?: Storage): void {
  writeRaw(STORAGE_KEYS.intro, '1', storage);
}
