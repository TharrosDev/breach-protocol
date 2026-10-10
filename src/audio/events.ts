import type { AudioGraph } from './graph';
import { SFX } from './synth';

// Gameplay sounds the simulation reports. The game maps its own events to these.
export type SoundEvent =
  | { type: 'gunfire'; weapon: string; suppressed: boolean }
  | { type: 'enemyShot'; sniper: boolean }
  | { type: 'explosion' }
  | { type: 'breach' }
  | { type: 'flashbang' }
  | { type: 'smoke' }
  | { type: 'kill'; head: boolean }
  | { type: 'pickup'; kind: 'resupply' | 'medkit' }
  | { type: 'melee' }
  | { type: 'sentry' }
  | { type: 'friendlyRifle' }
  | { type: 'medicHeal' }
  | { type: 'shield' }
  | { type: 'emp' }
  | { type: 'mineSet' };

// Legacy weapon id for the Breaker Shotgun (index.html:489, checked at 1832).
const BREAKER_WEAPON_ID = 'bk';

// Bus choice: gunfire, hostile fire, blasts and melee are world sounds on sfx.
// Pickup and kill confirmations are player feedback, so they go on ui (see synth.ts).
// Legacy has no separate hit sound; damageEnemy() plays only the kill tone (index.html:2531).
export function playEvent(graph: AudioGraph, ev: SoundEvent): void {
  switch (ev.type) {
    case 'gunfire':
      if (ev.suppressed) SFX.gunfireSuppressed(graph);
      else if (ev.weapon === BREAKER_WEAPON_ID) SFX.gunfireBreaker(graph);
      else SFX.gunfire(graph);
      return;
    case 'enemyShot':
      SFX.enemyShot(graph, ev.sniper);
      return;
    case 'explosion':
      SFX.explosion(graph);
      return;
    case 'breach':
      SFX.breach(graph);
      return;
    case 'flashbang':
      SFX.flashbang(graph);
      return;
    case 'smoke':
      SFX.smoke(graph);
      return;
    case 'kill':
      SFX.kill(graph, ev.head);
      return;
    case 'pickup':
      if (ev.kind === 'resupply') SFX.pickupResupply(graph);
      else SFX.pickupMedkit(graph);
      return;
    case 'melee':
      SFX.melee(graph);
      return;
    case 'sentry':
      SFX.sentry(graph);
      return;
    case 'friendlyRifle':
      SFX.friendlyRifle(graph);
      return;
    case 'medicHeal':
      SFX.medicHeal(graph);
      return;
    case 'shield':
      SFX.shield(graph);
      return;
    case 'emp':
      SFX.emp(graph);
      return;
    case 'mineSet':
      SFX.mineSet(graph);
      return;
  }
}
