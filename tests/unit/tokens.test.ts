import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ColourMode, TokenName } from '../../src/ui/contracts';
import { HOSTILE_MARK_SHAPE, TOKENS, cssVariables, tokenValue } from '../../src/ui/tokens';

// Typed as a Record over TokenName, so the compiler fails here if a token is added to contracts.ts and not listed.
const ALL_TOKENS: Record<TokenName, true> = {
  hostile: true,
  friendly: true,
  'objective-idle': true,
  'objective-capturing': true,
  'objective-contested': true,
  'objective-captured': true,
  health: true,
  'health-low': true,
  hit: true,
  kill: true,
  warning: true,
  good: true,
  ink: true,
  mute: true,
  panel: true,
};
const NAMES = Object.keys(ALL_TOKENS).sort();
const MODES: ColourMode[] = ['normal', 'colourblind'];
const VALUE_PATTERN = /^#[0-9a-f]{6}$|^rgba\(/;

const CSS_PATH = fileURLToPath(new URL('../../src/ui/tokens.css', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8');

// Pulls the body of the first block whose selector matches exactly. Blocks in tokens.css have no nested braces.
function blockBody(selector: RegExp): string {
  const match = selector.exec(css);
  if (!match || match[1] === undefined) throw new Error(`block not found: ${selector.source}`);
  return match[1];
}

// Returns name to value pairs from declarations of the form `--tok-<name>: <value>;`, in source order.
function declarations(text: string): [string, string][] {
  return [...text.matchAll(/--tok-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]);
}

describe('TOKENS', () => {
  it('has exactly the TokenName set, with no extra or missing keys', () => {
    expect(Object.keys(TOKENS).sort()).toEqual(NAMES);
  });

  it('gives every token a normal and a colour-blind value', () => {
    for (const name of NAMES) {
      const entry = TOKENS[name as TokenName];
      expect(typeof entry.normal).toBe('string');
      expect(typeof entry.colourblind).toBe('string');
      expect(entry.normal.length).toBeGreaterThan(0);
      expect(entry.colourblind.length).toBeGreaterThan(0);
    }
  });

  it('keeps hostile and friendly distinct in both modes', () => {
    for (const mode of MODES) {
      expect(tokenValue('hostile', mode)).not.toBe(tokenValue('friendly', mode));
    }
  });

  it('uses the blue/orange pair for hostile in colour-blind mode, with a shape cue', () => {
    expect(tokenValue('hostile', 'colourblind')).toBe('#ffb000');
    expect(tokenValue('friendly', 'colourblind')).toBe('#2f6bff');
    expect(HOSTILE_MARK_SHAPE).toEqual({ normal: 'square', colourblind: 'diamond' });
  });
});

describe('tokenValue', () => {
  it('returns a hex or rgba string for every token in both modes', () => {
    for (const name of NAMES) {
      for (const mode of MODES) {
        expect(tokenValue(name as TokenName, mode)).toMatch(VALUE_PATTERN);
      }
    }
  });

  it('returns the value from TOKENS for the requested mode', () => {
    expect(tokenValue('objective-captured', 'normal')).toBe('#4dff9a');
    expect(tokenValue('objective-captured', 'colourblind')).toBe('#2f6bff');
    expect(tokenValue('panel', 'normal')).toBe('rgba(9, 13, 20, 0.84)');
  });
});

describe('cssVariables', () => {
  for (const mode of MODES) {
    it(`declares every token exactly once in ${mode} mode, with the matching value`, () => {
      const lines = cssVariables(mode).split('\n');
      expect(lines).toHaveLength(NAMES.length);
      const found = lines.map((line) => {
        const m = /^--tok-([a-z-]+): (.+);$/.exec(line);
        if (!m) throw new Error(`bad line: ${line}`);
        return [m[1] ?? '', m[2] ?? ''] as const;
      });
      expect(found.map(([name]) => name).sort()).toEqual(NAMES);
      for (const [name, value] of found) {
        expect(value).toBe(tokenValue(name as TokenName, mode));
      }
    });
  }
});

describe('tokens.css', () => {
  it('defines every token once under :root, with the normal values', () => {
    const decl = declarations(blockBody(/:root\s*\{([^}]*)\}/));
    expect(decl.map(([n]) => n).sort()).toEqual(NAMES);
    for (const [name, value] of decl) {
      expect(value).toBe(tokenValue(name as TokenName, 'normal'));
    }
  });

  it('defines every token once under :root[data-colour="colourblind"], with the colour-blind values', () => {
    const decl = declarations(blockBody(/:root\[data-colour=['"]colourblind['"]\]\s*\{([^}]*)\}/));
    expect(decl.map(([n]) => n).sort()).toEqual(NAMES);
    for (const [name, value] of decl) {
      expect(value).toBe(tokenValue(name as TokenName, 'colourblind'));
    }
  });
});
