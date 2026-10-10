import { PRIMARY_WEAPON_IDS, SIDEARM_ID } from './ids';
import type { AttachmentId, PerkId, PrimaryWeaponId } from './ids';

export type Attachment = AttachmentId;
export type Perk = PerkId;

export interface WeaponDef {
  id: string;
  name: string;
  dmg: number;
  headMul: number;
  rpm: number;
  mag: number;
  res: number;
  reload: number;
  spread: number;
  spreadMax: number;
  gain: number;
  recoil: number;
  recoilYaw: number;
  pellets: number;
  auto: boolean;
  range: number;
  adsFov: number;
  scoped: boolean;
  // Shots per trigger pull for a burst weapon (absent or 1: single shot or full auto).
  burst?: number;
  // Extra seconds before the next burst may start, on top of the normal fire interval.
  burstGap?: number;
}

// index.html:486-493. Values are copied exactly from the legacy table.
export const WEAPONS: Record<PrimaryWeaponId | typeof SIDEARM_ID, WeaponDef> = {
  vx: {
    id: 'vx',
    name: 'VX-9 Rifle',
    dmg: 24,
    headMul: 2.5,
    rpm: 690,
    mag: 30,
    res: 150,
    reload: 2.1,
    spread: 0.01,
    spreadMax: 0.045,
    gain: 0.005,
    recoil: 0.008,
    recoilYaw: 0.003,
    pellets: 1,
    auto: true,
    range: 200,
    adsFov: 55,
    scoped: false,
  },
  kv: {
    id: 'kv',
    name: 'K-Vector SMG',
    dmg: 17,
    headMul: 2.2,
    rpm: 900,
    mag: 36,
    res: 216,
    reload: 1.8,
    spread: 0.018,
    spreadMax: 0.06,
    gain: 0.003,
    recoil: 0.005,
    recoilYaw: 0.004,
    pellets: 1,
    auto: true,
    range: 90,
    adsFov: 60,
    scoped: false,
  },
  bk: {
    id: 'bk',
    name: 'Breaker Shotgun',
    dmg: 11,
    headMul: 1.0,
    rpm: 70,
    mag: 6,
    res: 36,
    reload: 2.6,
    spread: 0.05,
    spreadMax: 0.07,
    gain: 0,
    recoil: 0.05,
    recoilYaw: 0.01,
    pellets: 9,
    auto: false,
    range: 45,
    adsFov: 60,
    scoped: false,
  },
  lm: {
    id: 'lm',
    name: 'Hammer LMG',
    dmg: 20,
    headMul: 2.0,
    rpm: 480,
    mag: 80,
    res: 240,
    reload: 4.2,
    spread: 0.012,
    spreadMax: 0.05,
    gain: 0.002,
    recoil: 0.006,
    recoilYaw: 0.004,
    pellets: 1,
    auto: true,
    range: 150,
    adsFov: 55,
    scoped: false,
  },
  dm: {
    id: 'dm',
    name: 'Warden DMR',
    dmg: 52,
    headMul: 2.5,
    rpm: 240,
    mag: 10,
    res: 60,
    reload: 2.6,
    spread: 0.004,
    spreadMax: 0.02,
    gain: 0.01,
    recoil: 0.035,
    recoilYaw: 0.002,
    pellets: 1,
    auto: false,
    range: 250,
    adsFov: 35,
    scoped: true,
  },
  rc: {
    id: 'rc',
    name: 'Ranger Carbine',
    dmg: 26,
    headMul: 2.4,
    rpm: 800,
    mag: 30,
    res: 150,
    reload: 2.0,
    spread: 0.007,
    spreadMax: 0.03,
    gain: 0.006,
    recoil: 0.012,
    recoilYaw: 0.002,
    pellets: 1,
    auto: false,
    range: 170,
    adsFov: 55,
    scoped: false,
    burst: 3,
    burstGap: 0.16,
  },
  lb: {
    id: 'lb',
    name: 'Longbow Sniper',
    dmg: 110,
    headMul: 2.5,
    rpm: 50,
    mag: 5,
    res: 25,
    reload: 3.2,
    spread: 0.002,
    spreadMax: 0.03,
    gain: 0.02,
    recoil: 0.06,
    recoilYaw: 0.002,
    pellets: 1,
    auto: false,
    range: 350,
    adsFov: 18,
    scoped: true,
  },
  hp: {
    id: 'hp',
    name: 'Hornet PDW',
    dmg: 14,
    headMul: 2.0,
    rpm: 1000,
    mag: 40,
    res: 240,
    reload: 1.6,
    spread: 0.02,
    spreadMax: 0.05,
    gain: 0.002,
    recoil: 0.0035,
    recoilYaw: 0.003,
    pellets: 1,
    auto: true,
    range: 70,
    adsFov: 62,
    scoped: false,
  },
  vp: {
    id: 'vp',
    name: 'Viper Pistol',
    dmg: 30,
    headMul: 2.3,
    rpm: 260,
    mag: 12,
    res: 60,
    reload: 1.3,
    spread: 0.012,
    spreadMax: 0.03,
    gain: 0.008,
    recoil: 0.03,
    recoilYaw: 0.005,
    pellets: 1,
    auto: false,
    range: 120,
    adsFov: 60,
    scoped: false,
  },
};

// Legacy order: vx, kv, bk, lm, dm.
export const PRIMARY_WEAPONS: readonly WeaponDef[] = PRIMARY_WEAPON_IDS.map((id) => WEAPONS[id]);

export const SIDEARM: WeaponDef = WEAPONS[SIDEARM_ID];
