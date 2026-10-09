import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS } from '../../src/content/bindingDefaults';
import { ACTIONS } from '../../src/content/ids';
import { DEFAULT_LOADOUT, DEFAULT_SETTINGS, type Loadout, type Settings } from '../../src/persist/schema';
import {
  hasSeenIntro,
  loadBindings,
  loadLoadout,
  loadSettings,
  markIntroSeen,
  saveBindings,
  saveLoadout,
  saveSettings,
} from '../../src/persist/store';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new Error('storage blocked');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

function readStored(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  return typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('corrupt storage', () => {
  it('returns defaults for corrupt JSON under every key', () => {
    const storage = memoryStorage({
      bp_settings: '{not json',
      bp_loadout: '[[',
      bp_binds: 'undefined',
    });
    expect(() => {
      expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
      expect(loadLoadout(storage)).toEqual(DEFAULT_LOADOUT);
      expect(loadBindings(storage)).toEqual(DEFAULT_BINDINGS);
    }).not.toThrow();
  });

  it('returns defaults when a stored value is not an object', () => {
    const storage = memoryStorage({ bp_settings: '42', bp_loadout: 'null', bp_binds: '"text"' });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(loadLoadout(storage)).toEqual(DEFAULT_LOADOUT);
    expect(loadBindings(storage)).toEqual(DEFAULT_BINDINGS);
  });
});

describe('settings', () => {
  it('falls back for a wrong-typed field and keeps the other fields', () => {
    const storage = memoryStorage({
      bp_settings: JSON.stringify({ sens: 'fast', fov: 90, invertY: true, quality: 'low' }),
    });
    const s = loadSettings(storage);
    expect(s.sens).toBe(DEFAULT_SETTINGS.sens);
    expect(s.fov).toBe(90);
    expect(s.invertY).toBe(true);
    expect(s.quality).toBe('low');
    expect(s.adsMul).toBe(DEFAULT_SETTINGS.adsMul);
  });

  it('clamps numeric settings to the slider ranges', () => {
    const storage = memoryStorage({
      bp_settings: JSON.stringify({ sens: 9, adsMul: 0, fov: 200, volume: 4 }),
    });
    const s = loadSettings(storage);
    expect(s.sens).toBe(3);
    expect(s.adsMul).toBe(0.2);
    expect(s.fov).toBe(110);
    expect(s.volume).toBe(1);
  });

  it('falls back to 800 for a dpi outside 400/800/1600/3200', () => {
    expect(loadSettings(memoryStorage({ bp_settings: JSON.stringify({ dpi: 123 }) })).dpi).toBe(800);
    expect(loadSettings(memoryStorage({ bp_settings: JSON.stringify({ dpi: 1600 }) })).dpi).toBe(1600);
  });

  it('falls back for an unknown quality value', () => {
    expect(loadSettings(memoryStorage({ bp_settings: JSON.stringify({ quality: 'ultra' }) })).quality).toBe(
      'high',
    );
  });

  it('round-trips through saveSettings under the bp_settings key', () => {
    const storage = memoryStorage();
    const s: Settings = { ...DEFAULT_SETTINGS, sens: 1.85, dpi: 3200, quality: 'low', colorblind: true };
    saveSettings(s, storage);
    expect(readStored(storage, 'bp_settings')).toEqual(s);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('loads a bp_settings value shaped like the legacy file without loss', () => {
    const legacyDefaults = {
      sens: 1.0,
      adsMul: 0.7,
      dpi: 800,
      fov: 75,
      invertY: false,
      volume: 0.8,
      quality: 'high',
      showFps: false,
      shake: true,
      colorblind: false,
    };
    expect(loadSettings(memoryStorage({ bp_settings: JSON.stringify(legacyDefaults) }))).toEqual(
      DEFAULT_SETTINGS,
    );

    const legacyChanged = {
      sens: 1.85,
      adsMul: 0.45,
      dpi: 1600,
      fov: 90,
      invertY: true,
      volume: 0.35,
      quality: 'low',
      showFps: true,
      shake: false,
      colorblind: true,
    };
    expect(loadSettings(memoryStorage({ bp_settings: JSON.stringify(legacyChanged) }))).toEqual(
      legacyChanged,
    );
  });
});

describe('loadout', () => {
  it('falls back for an unknown primary and keeps the other fields', () => {
    const storage = memoryStorage({
      bp_loadout: JSON.stringify({
        primary: 'laser',
        attachment: 'extmag',
        perk: 'ghost',
        map: 'substation',
        difficulty: 'elite',
      }),
    });
    const l = loadLoadout(storage);
    expect(l.primary).toBe(DEFAULT_LOADOUT.primary);
    expect(l.attachment).toBe('extmag');
    expect(l.perk).toBe('ghost');
    expect(l.map).toBe('substation');
    expect(l.difficulty).toBe('elite');
  });

  it('drops unknown gadgets and refills to two, as the legacy file does', () => {
    const load = (gadgets: unknown): Loadout =>
      loadLoadout(memoryStorage({ bp_loadout: JSON.stringify({ gadgets }) }));
    expect(load(['bogus', 'medkit', 'nope']).gadgets).toEqual(['medkit', 'frag']);
    expect(load(['drone', 'flash', 'smoke']).gadgets).toEqual(['drone', 'flash']);
    expect(load(['frag', 'frag']).gadgets).toEqual(['frag', 'flash']);
  });

  it('falls back to the default gadgets when the value is not a list or holds no known gadget', () => {
    const load = (gadgets: unknown): Loadout =>
      loadLoadout(memoryStorage({ bp_loadout: JSON.stringify({ gadgets }) }));
    expect(load('frag').gadgets).toEqual(DEFAULT_LOADOUT.gadgets);
    expect(load(['bogus']).gadgets).toEqual(DEFAULT_LOADOUT.gadgets);
  });

  it('round-trips through saveLoadout under the bp_loadout key', () => {
    const storage = memoryStorage();
    const l: Loadout = { ...DEFAULT_LOADOUT, primary: 'dm', gadgets: ['drone', 'medkit'] };
    saveLoadout(l, storage);
    expect(readStored(storage, 'bp_loadout')).toEqual(l);
    expect(loadLoadout(storage)).toEqual(l);
  });

  it('loads a bp_loadout value shaped like the legacy file without loss', () => {
    const legacy = {
      primary: 'kv',
      attachment: 'none',
      perk: 'steady',
      gadgets: ['medkit', 'drone'],
      map: 'substation',
      difficulty: 'elite',
    };
    expect(loadLoadout(memoryStorage({ bp_loadout: JSON.stringify(legacy) }))).toEqual(legacy);
    expect(loadLoadout(memoryStorage({ bp_loadout: JSON.stringify(DEFAULT_LOADOUT) }))).toEqual(
      DEFAULT_LOADOUT,
    );
  });
});

describe('bindings storage', () => {
  it('drops unknown action keys and gives a missing action its default', () => {
    const stored: Record<string, string> = { ...DEFAULT_BINDINGS, flyUp: 'KeyX', reload: 'KeyT' };
    delete stored.reload;
    const b = loadBindings(memoryStorage({ bp_binds: JSON.stringify(stored) }));
    expect(Object.keys(b)).toHaveLength(ACTIONS.length);
    expect(b).not.toHaveProperty('flyUp');
    expect(b.reload).toBe(DEFAULT_BINDINGS.reload);
  });

  it('loads a bp_binds value shaped like the legacy file without loss', () => {
    const legacy: Record<string, string> = { ...DEFAULT_BINDINGS, jump: 'KeyC', scoreboard: 'Backquote' };
    expect(loadBindings(memoryStorage({ bp_binds: JSON.stringify(legacy) }))).toEqual(legacy);
    expect(loadBindings(memoryStorage({ bp_binds: JSON.stringify(DEFAULT_BINDINGS) }))).toEqual(
      DEFAULT_BINDINGS,
    );
  });

  it('round-trips through saveBindings under the bp_binds key', () => {
    const storage = memoryStorage();
    const b = { ...DEFAULT_BINDINGS, interact: 'KeyY' };
    saveBindings(b, storage);
    expect(readStored(storage, 'bp_binds')).toEqual(b);
    expect(loadBindings(storage)).toEqual(b);
  });
});

describe('intro flag', () => {
  it('is unseen initially and seen after markIntroSeen', () => {
    const storage = memoryStorage();
    expect(hasSeenIntro(storage)).toBe(false);
    markIntroSeen(storage);
    expect(hasSeenIntro(storage)).toBe(true);
    expect(storage.getItem('bp_intro')).toBe('1');
  });
});

describe('blocked storage', () => {
  it('returns defaults when getItem throws and saves do not throw', () => {
    const storage = throwingStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(loadLoadout(storage)).toEqual(DEFAULT_LOADOUT);
    expect(loadBindings(storage)).toEqual(DEFAULT_BINDINGS);
    expect(hasSeenIntro(storage)).toBe(false);
    expect(() => {
      saveSettings(DEFAULT_SETTINGS, storage);
      saveLoadout(DEFAULT_LOADOUT, storage);
      saveBindings(DEFAULT_BINDINGS, storage);
      markIntroSeen(storage);
    }).not.toThrow();
  });

  it('uses globalThis.localStorage when no storage is passed', () => {
    vi.stubGlobal('localStorage', memoryStorage({ bp_settings: JSON.stringify({ sens: 2 }) }));
    expect(loadSettings().sens).toBe(2);
  });

  it('returns defaults when reading globalThis.localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
      expect(() => {
        saveSettings(DEFAULT_SETTINGS);
        markIntroSeen();
      }).not.toThrow();
      expect(hasSeenIntro()).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
