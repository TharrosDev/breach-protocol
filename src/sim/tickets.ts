import { ZONE_TICKET_COST } from '../content/tuning';

// Enemy tickets and the match win and loss rules (legacy index.html:2530 kill cost, 2573 zone cost,
// 2958 win check, 1642-1651 playerDie).

export interface TicketState {
  // Enemy tickets left. The win condition is this reaching 0.
  enemyTickets: number;
  // Tickets at match start (difficulty table). Used by the HUD bar; not read by the outcome rules.
  startTickets: number;
}

export type MatchOutcomeKind = 'continue' | 'win' | 'loss';

// index.html:2530: each enemy kill costs one ticket.
export function applyKill(t: TicketState): void {
  t.enemyTickets = Math.max(0, t.enemyTickets - 1);
}

// index.html:2573: a captured zone costs ZONE_TICKET_COST tickets.
export function applyZoneCapture(t: TicketState): void {
  t.enemyTickets = Math.max(0, t.enemyTickets - ZONE_TICKET_COST);
}

// Decides the match outcome after a tick. playerDead means the player is eliminated (not downed). A loss needs
// lives <= 0 as well. Loss is checked first: in the legacy tick, playerDie ends the match (index.html:1642-1651)
// before the win check at index.html:2958, which then does nothing.
export function matchOutcome(
  t: TicketState,
  zones: readonly { captured: boolean }[],
  lives: number,
  playerDead: boolean,
): MatchOutcomeKind {
  if (playerDead && lives <= 0) return 'loss';
  if (t.enemyTickets <= 0 || zones.every((z) => z.captured)) return 'win';
  return 'continue';
}
