// Legacy ENEMY_DEFS (index.html:525-530) and DIFF damage/hp multipliers (475-479).

export type EnemyKindId = 'rifle' | 'heavy' | 'sniper' | 'grenadier' | 'rusher' | 'medic' | 'juggernaut';

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
  // Fast flanker that closes to point blank and only fires from close in.
  rusher: boolean;
  // Heals wounded hostiles nearby and keeps its distance from the player.
  medic: boolean;
  // Mini-boss: slow, armoured and large.
  juggernaut: boolean;
  // Farthest target (m) this hostile will shoot at.
  fireRange: number;
  // Share of non-head damage that gets through (1 = unarmoured).
  armor: number;
  // Body scale for the model and for the hit spheres.
  scale: number;
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
    rusher: false,
    medic: false,
    juggernaut: false,
    fireRange: 50,
    armor: 1,
    scale: 1,
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
    rusher: false,
    medic: false,
    juggernaut: false,
    fireRange: 45,
    armor: 0.6,
    scale: 1,
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
    rusher: false,
    medic: false,
    juggernaut: false,
    fireRange: 110,
    armor: 1,
    scale: 1,
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
    rusher: false,
    medic: false,
    juggernaut: false,
    fireRange: 40,
    armor: 1,
    scale: 1,
    color: 0x5a3b3b,
  },
  rusher: {
    label: 'Rusher',
    hp: 45,
    dmg: 13,
    fire: 0.32,
    acc: 0.04,
    speed: 5.2,
    sight: 38,
    heavy: false,
    sniper: false,
    grenadier: false,
    rusher: true,
    medic: false,
    juggernaut: false,
    fireRange: 11,
    armor: 1,
    scale: 0.95,
    color: 0x7a4a2a,
  },
  medic: {
    label: 'Medic',
    hp: 55,
    dmg: 6,
    fire: 0.9,
    acc: 0.06,
    speed: 3.0,
    sight: 45,
    heavy: false,
    sniper: false,
    grenadier: false,
    rusher: false,
    medic: true,
    juggernaut: false,
    fireRange: 45,
    armor: 1,
    scale: 1,
    color: 0x3f6b57,
  },
  juggernaut: {
    label: 'Juggernaut',
    hp: 650,
    dmg: 17,
    fire: 0.26,
    acc: 0.05,
    speed: 1.7,
    sight: 55,
    heavy: true,
    sniper: false,
    grenadier: false,
    rusher: false,
    medic: false,
    juggernaut: true,
    fireRange: 55,
    armor: 0.45,
    scale: 1.4,
    color: 0x5b1f1f,
  },
};
