// Colour tokens for the shell and HUD (spec §1.8, §4). Objective colours follow zones.ts ZONE_PALETTE. The rest
// follow the legacy HUD palette. Every token has a colour-blind value, so no UI colour depends on red and green alone.
import type { ColourMode, TokenName } from './contracts';

// Hex values are lower-case #rrggbb (legacy 0xRRGGBB converted), except panel, which is a translucent rgba.
export const TOKENS: Record<TokenName, { normal: string; colourblind: string }> = {
  // Hostile markers: legacy red (humans.ts MARK_COLOUR). The colour-blind value is the orange half of the
  // blue/orange pair, so it separates from friendly blue. The UI adds a shape cue (see HOSTILE_MARK_SHAPE).
  hostile: { normal: '#ff3b3b', colourblind: '#ffb000' },
  friendly: { normal: '#58b7ff', colourblind: '#2f6bff' },
  'objective-idle': { normal: '#ff4d4d', colourblind: '#e6e6e6' },
  'objective-capturing': { normal: '#58b7ff', colourblind: '#9ad0ff' },
  'objective-contested': { normal: '#ffb020', colourblind: '#ffb000' },
  'objective-captured': { normal: '#4dff9a', colourblind: '#2f6bff' },
  health: { normal: '#4dff9a', colourblind: '#2f6bff' },
  'health-low': { normal: '#ff5a4f', colourblind: '#ffb000' },
  hit: { normal: '#ff5a5a', colourblind: '#ffffff' },
  kill: { normal: '#ffd27a', colourblind: '#ffd27a' },
  warning: { normal: '#ffb020', colourblind: '#ffb000' },
  good: { normal: '#4dff9a', colourblind: '#2f6bff' },
  ink: { normal: '#e8eef8', colourblind: '#e8eef8' },
  mute: { normal: '#8ea0ba', colourblind: '#8ea0ba' },
  panel: { normal: 'rgba(9, 13, 20, 0.84)', colourblind: 'rgba(9, 13, 20, 0.84)' },
};

// Hostile markers also get a shape, so the colour is not the only cue. Normal is a square; colour-blind is a diamond.
export const HOSTILE_MARK_SHAPE: Record<ColourMode, 'square' | 'diamond'> = {
  normal: 'square',
  colourblind: 'diamond',
};

export function tokenValue(name: TokenName, mode: ColourMode): string {
  return TOKENS[name][mode];
}

// One `--tok-<name>: <value>;` declaration per line, in TOKENS order. Wrap in a `:root` block to use it.
export function cssVariables(mode: ColourMode): string {
  return (Object.keys(TOKENS) as TokenName[])
    .map((name) => `--tok-${name}: ${tokenValue(name, mode)};`)
    .join('\n');
}
