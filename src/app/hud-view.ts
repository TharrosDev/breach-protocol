// HUD view for the in-match HUD (spec §3: the HUD reads a read-only view of the sim each frame and never writes game
// state). buildHudView only reads the sim. HudState holds the render-side messages that sim events produce (kill feed
// lines, banners, the hit marker of the frame), which the sim does not keep. Legacy references are to
// public/index.html: 1476-1497 (feed, announce, damage indicator), 2530-2543 (kill feed and multi-kill banners),
// 2880-2910 (HUD update), 2001 and 2886-2887 (flash and hurt), 2893-2898 (prompt), 3389-3400 (hit numbers, hints).
import type { HudView } from '../ui/contracts';
import type { HudExtras, HudOperator, IntroKeys, ScoreboardRow } from '../ui/hud/hud';
import { scoreboardFooter, type FeedCls } from '../ui/hud/layout';
import { ENEMY_DEFS } from '../content/enemies';
import type { Action } from '../content/ids';
import { GADGETS } from '../content/gadgets';
import { KILLSTREAKS, KILLSTREAK_IDS, type KillstreakId } from '../content/killstreaks';
import { ANNOUNCE_SECONDS } from '../ui/hud/layout';
import { PLANT_REACH } from '../sim/breach';
import { readyLabel } from '../sim/killstreaks';
import { nearestCrate } from '../sim/resupply';
import type { SimWorld } from '../sim/world';

// Legacy flashbang blindness, in seconds (index.html:2001). The whiteout is flashT / this (index.html:2886).
export const FLASH_SECONDS = 3;
// Legacy hurt vignette: fades over 0.9 s after a hit (index.html:2887).
export const HURT_SECONDS = 0.9;
// Legacy kill window for multi-kill banners (index.html:2537-2538).
export const MULTI_KILL_WINDOW = 4;
// Feed lines kept in the view. The HUD shows at most four, for four seconds each.
export const FEED_KEEP = 6;
// Squad order names, in sim order (legacy ORDERS, index.html:473).
export const SQUAD_ORDER_NAMES = ['ATTACK', 'HOLD', 'FOLLOW'] as const;

// What the view needs besides the sim: the start pool of the difficulty (the sim keeps its own copy private) and the
// label of the key bound to an action.
export interface HudEnv {
  readonly difficultyTickets: number;
  readonly keyOf: (action: Action) => string;
  // The map and difficulty names for the scoreboard footer (legacy CUR.name and DIFF.name). A missing name is left out
  // of the footer.
  readonly mapName?: string;
  readonly difficultyName?: string;
}

export type HitLevel = HudView['hitMarker'];

const HIT_RANK: Record<HitLevel, number> = { none: 0, hit: 1, kill: 2, head: 3 };

interface Banner {
  readonly text: string;
  readonly sub: string;
  readonly until: number;
}

// Render-side messages. The HUD view takes a snapshot of this each frame. Time runs on advance(), so a paused match
// (zero step) freezes banners and feed ages with it.
export class HudState {
  private clock = 0;
  private lines: { text: string; cls: FeedCls }[] = [];
  private banner: Banner | null = null;
  private frameHit: HitLevel = 'none';
  private killTimes: number[] = [];

  advance(dt: number): void {
    if (Number.isFinite(dt) && dt > 0) this.clock += dt;
  }

  // Adds a feed line at the top (the feed is newest first).
  feed(text: string, cls: FeedCls = ''): void {
    this.lines.unshift({ text, cls });
    if (this.lines.length > FEED_KEEP) this.lines.length = FEED_KEEP;
  }

  // Shows a banner for `seconds`. A newer banner replaces the older one.
  announce(text: string, sub = '', seconds = ANNOUNCE_SECONDS): void {
    this.banner = { text, sub, until: this.clock + seconds };
  }

  // A kill by the player: the feed line, and the multi-kill banner for the second, third and later kills within the
  // kill window (legacy killTimes, index.html:2537-2543).
  playerKill(label: string, head: boolean): void {
    this.feed(`You -> ${label}${head ? ' [HEADSHOT]' : ''}`, 'kill');
    const now = this.clock;
    this.killTimes = this.killTimes.filter((t) => now - t < MULTI_KILL_WINDOW);
    this.killTimes.push(now);
    const count = this.killTimes.length;
    if (count === 2) this.announce('Double kill');
    else if (count === 3) this.announce('Triple kill');
    else if (count >= 4) this.announce('Rampage');
  }

  // Records a hit for the frame. The strongest level of the frame wins (head over kill over hit).
  hit(level: Exclude<HitLevel, 'none'>): void {
    if (HIT_RANK[level] > HIT_RANK[this.frameHit]) this.frameHit = level;
  }

  // The hit marker for the frame just simulated. Cleared on read.
  takeHit(): HitLevel {
    const level = this.frameHit;
    this.frameHit = 'none';
    return level;
  }

  feedLines(): HudView['feed'] {
    return this.lines.map((l) => ({ text: l.text, cls: l.cls }));
  }

  bannerNow(): HudView['announce'] {
    const b = this.banner;
    if (b === null || this.clock >= b.until) return null;
    return { text: b.text, sub: b.sub };
  }
}

// Next streak reward above the current streak (3, 5 or 7), or null when none is left (legacy HUD, index.html:2864).
export function nextStreakAt(streak: number): number | null {
  let next: number | null = null;
  for (const id of KILLSTREAK_IDS) {
    const n = KILLSTREAKS[id].streak;
    if (n > streak && (next === null || n < next)) next = n;
  }
  return next;
}

// The aim ray from the player's eye, as sim/world.ts builds it (legacy aimDir, index.html:1299-1302).
function aimOf(sim: SimWorld): {
  eye: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
} {
  const p = sim.player;
  const cp = Math.cos(p.pitch);
  return {
    eye: { x: p.pos.x, y: p.pos.y + p.eyeHeight, z: p.pos.z },
    dir: { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: Math.cos(p.yaw) * cp },
  };
}

// The bottom-centre prompt (legacy updHUD, index.html:2893-2898). The breach check is a read-only raycast, as in
// the legacy aimBreakable.
export function promptFor(sim: SimWorld, env: HudEnv): string {
  const plant = sim.breach.plant;
  if (plant !== null) return `Breach charge armed · ${plant.t.toFixed(1)}s`;
  const p = sim.player;
  if (!p.alive) return '';
  const key = `[${env.keyOf('interact')}]`;
  if (nearestCrate(sim.crates, p.pos) !== null) return `${key} Resupply`;
  if (p.vault === null) {
    const { eye, dir } = aimOf(sim);
    if (sim.collision.raycast(eye, dir, PLANT_REACH, { onlyBreakable: true }) !== null) {
      return sim.breach.charges > 0 ? `${key} Place breach charge` : 'No breach charges left';
    }
  }
  return '';
}

// Builds the HUD view from the sim and the render-side messages. Reads only.
export function buildHudView(sim: SimWorld, env: HudEnv, state: HudState): HudView {
  const p = sim.player;
  const w = sim.weapon;
  const sinceHurt = sim.time - p.lastHurt;
  return {
    hp: p.hp,
    stamina: p.stamina,
    alive: p.alive,
    downed: p.downed,
    bleedout: p.bleedT,
    respawnIn: p.deathT,
    weaponName: w.def.name,
    ammo: w.ammo,
    reserve: w.res,
    reloading: w.reloadLeft > 0,
    gadgets: sim.gadgets.map((g, i) => ({
      name: GADGETS[g.id].name,
      uses: g.uses,
      key: env.keyOf(i === 0 ? 'gadget1' : 'gadget2'),
    })),
    breachCharges: sim.breach.charges,
    breachKey: env.keyOf('interact'),
    killstreakReady: sim.killstreak.ks === null ? null : readyLabel(sim.killstreak.ks),
    killstreakKey: env.keyOf('killstreak'),
    streak: sim.streak,
    nextStreakAt: nextStreakAt(sim.streak),
    score: sim.score,
    reinforcements: sim.lives,
    hostilesAlive: sim.enemies.reduce((n, e) => (e.alive ? n + 1 : n), 0),
    // The legacy count includes the player (index.html:2888): three operators in all, two AI and the player.
    operatorsAlive: sim.operators.reduce((n, a) => (a.alive ? n + 1 : n), p.alive ? 1 : 0),
    operatorsTotal: sim.operators.length + 1,
    squadOrder: SQUAD_ORDER_NAMES[sim.order],
    tickets: sim.enemyTickets,
    ticketsStart: env.difficultyTickets,
    zones: sim.zones.map((z) => ({ name: z.name, status: z.status, prog: z.prog })),
    spotted: sim.spotted.map((e) => ({ label: ENEMY_DEFS[e.kind].label, x: e.pos.x, y: 0, z: e.pos.z })),
    whiteout: Math.min(1, Math.max(0, sim.flashT / FLASH_SECONDS)),
    hurt: Math.min(1, Math.max(0, 1 - sinceHurt / HURT_SECONDS)),
    hitMarker: state.takeHit(),
    feed: state.feedLines(),
    prompt: promptFor(sim, env),
    announce: state.bannerNow(),
    compassYaw: p.yaw,
    playerX: p.pos.x,
    playerZ: p.pos.z,
  };
}

// The Tab scoreboard rows (legacy updScoreboard, index.html:2885-2894): the player, then each operator. The player's
// status is Down, Active or KIA. Allies have no score or deaths in legacy, so those cells show a dash.
export function scoreboardRows(sim: SimWorld): ScoreboardRow[] {
  const p = sim.player;
  const you: ScoreboardRow = {
    name: 'You',
    score: String(sim.score),
    kills: String(sim.playerKills),
    deaths: String(sim.deaths),
    status: p.downed ? 'Down' : p.alive ? 'Active' : 'KIA',
  };
  const allies = sim.operators.map((a): ScoreboardRow => ({
    name: a.name,
    score: '–',
    kills: String(a.kills),
    deaths: '–',
    status: a.alive ? 'Active' : 'Down',
  }));
  return [you, ...allies];
}

// The per-frame extras: squad cards and minimap dots, the crosshair spread, the squad order key, and the Tab
// scoreboard (shown while `scoreboard` is true).
export function buildHudExtras(sim: SimWorld, env: HudEnv, scoreboard = false): HudExtras {
  return {
    operators: sim.operators.map((a): HudOperator => ({
      name: a.name,
      hp: a.hp,
      maxHp: a.maxHp,
      alive: a.alive,
      x: a.pos.x,
      z: a.pos.z,
    })),
    spread: sim.weapon.spread,
    orderKey: env.keyOf('order'),
    scoreboard,
    scoreboardRows: scoreboardRows(sim),
    scoreboardFooter: scoreboardFooter({
      hostiles: sim.enemies.reduce((n, e) => (e.alive ? n + 1 : n), 0),
      captured: sim.zones.filter((z) => z.captured).length,
      zones: sim.zones.length,
      tickets: sim.enemyTickets,
      mapName: env.mapName ?? '',
      difficultyName: env.difficultyName ?? '',
    }),
  };
}

// Key labels for the one-time intro hints (legacy introHints, index.html:3402-3417).
export function introKeys(env: HudEnv): IntroKeys {
  const k = env.keyOf;
  return {
    move: `${k('forward')} ${k('left')} ${k('back')} ${k('right')}`,
    sprint: k('sprint'),
    crouch: k('crouch'),
    reload: k('reload'),
    melee: k('melee'),
    interact: k('interact'),
    order: k('order'),
    scoreboard: k('scoreboard'),
  };
}

// Killstreak feedback (legacy useKillstreak, index.html:2027-2047): the feed line and the banner.
export const KILLSTREAK_USED: Readonly<Record<KillstreakId, { feed: string; banner: string; sub: string }>> =
  {
    uav: { feed: 'UAV online: hostiles revealed', banner: 'UAV ONLINE', sub: 'all hostiles revealed' },
    sentry: { feed: 'Sentry turret online', banner: 'SENTRY ONLINE', sub: '' },
    airstrike: { feed: 'Airstrike inbound', banner: 'AIRSTRIKE', sub: '' },
  };
