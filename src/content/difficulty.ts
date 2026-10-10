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
  // Tactical skill of the hostiles, 0..1.3: reaction time, cover use, flanking and suppressing fire.
  ai: number;
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
    ai: 0.35,
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
    ai: 0.7,
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
    ai: 1,
  },
  nightmare: {
    name: 'Nightmare',
    hp: 1.6,
    dmg: 1.6,
    lives: 1,
    maxHost: 36,
    waveT: 9,
    tickets: 260,
    desc: 'Relentless. 1 reinforcement, 260 enemy tickets, sharper hostiles.',
    ai: 1.3,
  },
};
