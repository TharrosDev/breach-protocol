import type { DifficultyId } from './ids';

// Legacy DIFF table (index.html:475-479). hp and dmg are multipliers on enemy hp and on damage dealt to the player.
export interface DifficultyDef {
  name: string;
  hp: number;
  dmg: number;
  lives: number;
  maxHost: number;
  waveT: number;
  tickets: number;
  desc: string;
}

export const DIFF: Record<DifficultyId, DifficultyDef> = {
  recruit: {
    name: 'Recruit',
    hp: 0.7,
    dmg: 0.6,
    lives: 5,
    maxHost: 14,
    waveT: 16,
    tickets: 100,
    desc: 'Forgiving. 5 reinforcements, 100 enemy tickets.',
  },
  veteran: {
    name: 'Veteran',
    hp: 1,
    dmg: 1,
    lives: 3,
    maxHost: 22,
    waveT: 14,
    tickets: 150,
    desc: 'Standard. 3 reinforcements, 150 enemy tickets.',
  },
  elite: {
    name: 'Elite',
    hp: 1.35,
    dmg: 1.35,
    lives: 2,
    maxHost: 30,
    waveT: 11,
    tickets: 200,
    desc: 'Brutal. 2 reinforcements, 200 enemy tickets.',
  },
};
