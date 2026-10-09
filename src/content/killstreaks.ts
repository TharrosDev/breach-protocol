// Killstreak definitions and tuning, ported from the legacy game.
// Durations for the UAV and the turret live in tuning.ts (UAV_TIME, TURRET_TIME).

export const KILLSTREAK_IDS = ['uav', 'sentry', 'airstrike'] as const;
export type KillstreakId = (typeof KILLSTREAK_IDS)[number];

export interface KillstreakDef {
  id: KillstreakId;
  // Consecutive kills (streak counter, reset on death) that earn this killstreak.
  streak: number;
  // Name used in the award and ready messages.
  name: string;
  desc: string;
}

// index.html:519-523
export const KILLSTREAKS: Readonly<Record<KillstreakId, KillstreakDef>> = {
  uav: { id: 'uav', streak: 3, name: 'UAV', desc: 'Reveals every hostile for 20 s.' },
  sentry: {
    id: 'sentry',
    streak: 5,
    name: 'Sentry Turret',
    desc: 'Places an auto-turret for 45 s.',
  },
  airstrike: { id: 'airstrike', streak: 7, name: 'Airstrike', desc: 'Bombs the aim point.' },
};

// index.html:2048-2052 (a UAV spot is held at least this high while it is up).
export const UAV_SPOT_FLOOR = 0.3;

// index.html:1536-1586 (sentry turret placement and fire).
// Distances ahead of the aim point, tried in order. The first clear ground wins.
export const SENTRY_PLACE_DISTANCES = [8, 6, 4, 2] as const;
// Clearance needed around a placement point (openPoint radius, m).
export const SENTRY_OPEN_R = 0.6;
// Turret centre height (m).
export const SENTRY_HEIGHT = 1.2;
// Target and wall limits (m).
export const SENTRY_RANGE = 40;
export const SENTRY_WALL_RANGE = 60;
// Damage per shot before the head multiplier.
export const SENTRY_DAMAGE = 12;
// Seconds between shots.
export const SENTRY_FIRE_INTERVAL = 0.12;
// Turn rate: the yaw closes min(1, dt * rate) of the remaining angle each frame.
export const SENTRY_TURN_RATE = 8;
// Fire only when the barrel is within this angle (rad) of the target.
export const SENTRY_AIM_TOL = 0.15;
// Random spread added to the aim direction on x and z, each in (-0.025, 0.025).
export const SENTRY_SPREAD = 0.05;
// Tracer start offset from the turret centre (m).
export const SENTRY_MUZZLE = 0.6;

// index.html:1589-1617 (airstrike).
// Aim point distance from the player (m), used by the caller.
export const AIRSTRIKE_AIM_DIST = 40;
// Number of blasts and the side of the square they land in (m).
export const AIRSTRIKE_BLASTS = 5;
export const AIRSTRIKE_SPREAD = 12;
// Blast k fires at FIRST + k * GAP milliseconds.
export const AIRSTRIKE_FIRST_MS = 300;
export const AIRSTRIKE_GAP_MS = 260;
// Blast radius (m), centre height (m) and damage at the centre before falloff.
export const AIRSTRIKE_RADIUS = 5;
export const AIRSTRIKE_BLAST_Y = 0.3;
export const AIRSTRIKE_ENEMY_DAMAGE = 130;
export const AIRSTRIKE_PLAYER_DAMAGE = 70;
