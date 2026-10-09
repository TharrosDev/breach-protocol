import { describe, it, expect } from 'vitest';
import {
  endMatch,
  formatScoreLine,
  openBrief,
  pauseMatch,
  resumeMatch,
  startMatch,
  toMenu,
  type MatchSummaryInput,
} from '../../src/sim/match';

const summary: MatchSummaryInput = {
  score: 2450,
  kills: 17,
  deaths: 2,
  zonesCaptured: 2,
  zonesTotal: 3,
  seconds: 412.7,
  mapName: 'Compound',
  difficulty: 'Veteran',
};

describe('match state transitions', () => {
  it('deploys from menu to brief, then starts play', () => {
    expect(openBrief('menu')).toBe('brief');
    expect(startMatch()).toBe('play');
  });

  it('openBrief throws outside the menu', () => {
    expect(() => openBrief('play')).toThrow();
    expect(() => openBrief('brief')).toThrow();
  });

  it('pauses only from play', () => {
    expect(pauseMatch('play')).toBe('paused');
    expect(() => pauseMatch('menu')).toThrow();
    expect(() => pauseMatch('brief')).toThrow();
    expect(() => pauseMatch('paused')).toThrow();
    expect(() => pauseMatch('over')).toThrow();
  });

  it('resumes only from paused', () => {
    expect(resumeMatch('paused')).toBe('play');
    expect(() => resumeMatch('play')).toThrow();
    expect(() => resumeMatch('menu')).toThrow();
  });

  it('returns to the menu from any state', () => {
    expect(toMenu()).toBe('menu');
  });

  it('ends a match in play with the summary as its result', () => {
    const ended = endMatch('play', true, summary);
    expect(ended.state).toBe('over');
    expect(ended.result).toEqual({ win: true, ...summary });
  });

  it('ends a paused match', () => {
    expect(endMatch('paused', false, summary).result.win).toBe(false);
  });

  it('refuses to end a match that has not started', () => {
    expect(() => endMatch('menu', true, summary)).toThrow();
    expect(() => endMatch('brief', true, summary)).toThrow();
  });

  it('is idempotent: a second end returns the same result and cannot change it', () => {
    const first = endMatch('play', true, summary);
    const second = endMatch(first, false, { ...summary, score: 0, kills: 0 });
    expect(second).toBe(first);
    expect(second.state).toBe('over');
    expect(second.result.win).toBe(true);
    expect(second.result.score).toBe(2450);
  });

  it('copies the summary fields rather than keeping the caller object', () => {
    const input: MatchSummaryInput = { ...summary };
    const ended = endMatch('play', true, input);
    input.score = 1;
    expect(ended.result.score).toBe(2450);
  });
});

describe('formatScoreLine', () => {
  it('matches the legacy debrief sentence', () => {
    const { result } = endMatch('play', true, summary);
    expect(formatScoreLine(result)).toBe(
      'Score 2450 · 17 eliminations · 2 deaths · 2/3 objectives · 412s · Compound, Veteran',
    );
  });
});
