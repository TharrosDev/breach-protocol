import type { SoundEvent } from '../audio/events';
import { ENEMY_DEFS } from '../content/enemies';
import type { SimEvent } from '../sim/world';

// Maps one sim event to the sound it makes, or null when the event is silent. Pure: no audio and no DOM, so the
// unit test can run it in Node. The sim only reports what happened; deciding which sound that is lives here.
// Legacy call sites are named per case (public/index.html line numbers).
export function mapSimEventToSound(ev: SimEvent): SoundEvent | null {
  switch (ev.type) {
    // fire(): breaker, other weapons, or the suppressed shot (index.html:1830-1835).
    case 'playerFire':
      return { type: 'gunfire', weapon: ev.weapon, suppressed: ev.suppressed };
    // enemyShoot(): sniper or rifle tone, for shots at the player or an operator (index.html:2242).
    case 'enemyShot':
      return { type: 'enemyShot', sniper: ENEMY_DEFS[ev.shooter.kind].sniper };
    // allyFire() (index.html:2437).
    case 'operatorShot':
      return { type: 'friendlyRifle' };
    // updTurrets() (index.html:1582).
    case 'turretShot':
      return { type: 'sentry' };
    // damageEnemy() plays the kill tone for every kill, by the player or an operator (index.html:2531).
    case 'enemyKilled':
      return { type: 'kill', head: ev.head };
    // explodeGrenade() frag branches: the player's frag via explodeAt and the enemy frag (index.html:1973, 1607).
    case 'grenadeBlast':
      return { type: 'explosion' };
    // explodeAt() for airstrike shells (index.html:1607).
    case 'airstrikeBlast':
      return { type: 'explosion' };
    // updPlant() detonation (index.html:2081).
    case 'breachBlast':
      return { type: 'breach' };
    // explodeGrenade() flash and smoke branches (index.html:1989, 1968).
    case 'grenadeDetonated':
      return ev.kind === 'flash' ? { type: 'flashbang' } : { type: 'smoke' };
    // resupply() (index.html:3232).
    case 'resupplied':
      return { type: 'pickup', kind: 'resupply' };
    // useMedkit() (index.html:2007). The sim reports only uses that heal.
    case 'medkitUsed':
      return { type: 'pickup', kind: 'medkit' };
    default:
      return null;
  }
}
