// Legacy ENEMY_DEFS (index.html:525-530) and DIFF damage/hp multipliers (475-479).

export type EnemyKindId = 'rifle' | 'heavy' | 'sniper' | 'grenadier';

export interface EnemyDef {
  label: string;
  hp: number;
  dmg: number;
  fire: number;
  acc: number;
  speed: number;
  sight: number;
  heavy: boolean;
  sniper: boolean;
  grenadier: boolean;
  color: number;
}

export const ENEMY_DEFS: Record<EnemyKindId, EnemyDef> = {
  rifle: {
    label: 'Rifleman',
    hp: 60,
    dmg: 8,
    fire: 0.45,
    acc: 0.05,
    speed: 3.1,
    sight: 50,
    heavy: false,
    sniper: false,
    grenadier: false,
    color: 0x56624f,
  },
  heavy: {
    label: 'Heavy',
    hp: 150,
    dmg: 13,
    fire: 0.75,
    acc: 0.035,
    speed: 2.0,
    sight: 45,
    heavy: true,
    sniper: false,
    grenadier: false,
    color: 0x2c3a4f,
  },
  sniper: {
    label: 'Sniper',
    hp: 55,
    dmg: 40,
    fire: 2.4,
    acc: 0.012,
    speed: 2.4,
    sight: 110,
    heavy: false,
    sniper: true,
    grenadier: false,
    color: 0x6b5b3a,
  },
  grenadier: {
    label: 'Grenadier',
    hp: 70,
    dmg: 10,
    fire: 0.7,
    acc: 0.06,
    speed: 2.8,
    sight: 40,
    heavy: false,
    sniper: false,
    grenadier: true,
    color: 0x5a3b3b,
  },
};
