import { describe, it, expect } from 'vitest';
import { ZONE_TICKET_COST } from '../../src/content/tuning';
import { applyKill, applyZoneCapture, matchOutcome, type TicketState } from '../../src/sim/tickets';
import { createZone, type Zone } from '../../src/sim/objectives';

function tickets(enemyTickets: number): TicketState {
  return { enemyTickets, startTickets: 150 };
}

function zones(captured: boolean[]): Zone[] {
  return captured.map((c, i) => ({
    ...createZone({ name: `Z${String(i)}`, x: i, z: 0 }),
    captured: c,
    status: c ? 'captured' : 'idle',
  }));
}

describe('applyKill', () => {
  it('reduces enemy tickets by 1', () => {
    const t = tickets(150);
    applyKill(t);
    expect(t.enemyTickets).toBe(149);
  });

  it('clamps at 0', () => {
    const t = tickets(0);
    applyKill(t);
    expect(t.enemyTickets).toBe(0);
  });
});

describe('applyZoneCapture', () => {
  it('reduces enemy tickets by the legacy zone cost of 35', () => {
    expect(ZONE_TICKET_COST).toBe(35);
    const t = tickets(150);
    applyZoneCapture(t);
    expect(t.enemyTickets).toBe(115);
  });

  it('clamps at 0', () => {
    const t = tickets(20);
    applyZoneCapture(t);
    expect(t.enemyTickets).toBe(0);
  });
});

describe('matchOutcome', () => {
  it('continues while tickets, zones and lives remain', () => {
    expect(matchOutcome(tickets(100), zones([false, true, false]), 3, false)).toBe('continue');
  });

  it('wins when enemy tickets reach 0', () => {
    expect(matchOutcome(tickets(0), zones([false, false, false]), 3, false)).toBe('win');
  });

  it('wins when every zone is captured', () => {
    expect(matchOutcome(tickets(100), zones([true, true, true]), 3, false)).toBe('win');
  });

  it('loses when the player is dead with no lives left', () => {
    expect(matchOutcome(tickets(100), zones([false, false, false]), 0, true)).toBe('loss');
  });

  it('continues when the player is dead but has lives left (respawn pending)', () => {
    expect(matchOutcome(tickets(100), zones([false, false, false]), 2, true)).toBe('continue');
  });

  it('continues when the player is alive with no lives left', () => {
    expect(matchOutcome(tickets(100), zones([false, false, false]), 0, false)).toBe('continue');
  });

  it('a loss in the same tick as a win stays a loss (legacy ordering, index.html:2958)', () => {
    expect(matchOutcome(tickets(0), zones([true, true, true]), 0, true)).toBe('loss');
  });

  it('a whole match of kills reaches the ticket win', () => {
    const t = tickets(150);
    let outcome = matchOutcome(t, zones([false, false, false]), 3, false);
    for (let i = 0; i < 150 && outcome === 'continue'; i++) {
      applyKill(t);
      outcome = matchOutcome(t, zones([false, false, false]), 3, false);
    }
    expect(t.enemyTickets).toBe(0);
    expect(outcome).toBe('win');
  });
});
