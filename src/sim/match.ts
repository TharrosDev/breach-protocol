// Match state machine: menu -> brief -> play <-> paused -> over (legacy state strings, index.html:2641-2690).
// Each transition is a function that returns the new state, or throws on an illegal transition.

export type MatchState = 'menu' | 'brief' | 'play' | 'paused' | 'over';

// One objective as the debrief lists it: its name and whether the player's side holds it at the end.
export interface MatchZone {
  name: string;
  captured: boolean;
}

export interface MatchSummaryInput {
  score: number;
  kills: number;
  deaths: number;
  zonesCaptured: number;
  zonesTotal: number;
  // Raw match time in seconds. formatScoreLine floors it, as the legacy debrief does.
  seconds: number;
  // Display names (legacy CUR.name and DIFF[id].name).
  mapName: string;
  difficulty: string;
  // Player shots fired (one per trigger pull, legacy P.shots) and bullets that hit a hostile (legacy P.hits).
  shots: number;
  hits: number;
  // Consecutive kills at the moment the match ended (legacy P.streak).
  streak: number;
  // Objectives in map order.
  zones: readonly MatchZone[];
}

export interface MatchResult extends MatchSummaryInput {
  win: boolean;
}

// The ended match. Carrying the result in the state is what makes endMatch idempotent.
export interface MatchOver {
  state: 'over';
  result: MatchResult;
}

function illegal(from: MatchState, action: string): Error {
  return new Error(`Illegal match transition: ${action} from '${from}'`);
}

// Menu deploy (legacy deploy, index.html:2687): the brief screen opens.
export function openBrief(s: MatchState): 'brief' {
  if (s !== 'menu') throw illegal(s, 'openBrief');
  return 'brief';
}

// Ends the brief and starts play. Legacy resetMatch leaves the match in 'play'.
export function startMatch(): MatchState {
  return 'play';
}

// Pause is only allowed during play (legacy pauseGame, index.html:2675-2680).
export function pauseMatch(s: MatchState): 'paused' {
  if (s !== 'play') throw illegal(s, 'pauseMatch');
  return 'paused';
}

// Resume is only allowed from pause (legacy resume, index.html:2681-2686).
export function resumeMatch(s: MatchState): 'play' {
  if (s !== 'paused') throw illegal(s, 'resumeMatch');
  return 'play';
}

// Back to the menu from any state (legacy toMenu, index.html:2659-2667).
export function toMenu(): 'menu' {
  return 'menu';
}

// Ends the match once (legacy endMatch, index.html:2641-2658). Passing an already-ended match returns it
// unchanged, so a second end cannot change the result. Ending is allowed from play and paused only.
export function endMatch(
  s: Exclude<MatchState, 'over'> | MatchOver,
  win: boolean,
  summary: MatchSummaryInput,
): MatchOver {
  if (typeof s === 'object') return s;
  if (s !== 'play' && s !== 'paused') throw illegal(s, 'endMatch');
  return {
    state: 'over',
    result: {
      win,
      score: summary.score,
      kills: summary.kills,
      deaths: summary.deaths,
      zonesCaptured: summary.zonesCaptured,
      zonesTotal: summary.zonesTotal,
      seconds: summary.seconds,
      mapName: summary.mapName,
      difficulty: summary.difficulty,
      shots: summary.shots,
      hits: summary.hits,
      streak: summary.streak,
      zones: summary.zones.map((z) => ({ name: z.name, captured: z.captured })),
    },
  };
}

// The debrief sentence (legacy index.html:2649).
export function formatScoreLine(result: MatchResult): string {
  return (
    `Score ${String(result.score)} · ${String(result.kills)} eliminations · ${String(result.deaths)} deaths · ` +
    `${String(result.zonesCaptured)}/${String(result.zonesTotal)} objectives · ` +
    `${String(Math.floor(result.seconds))}s · ${result.mapName}, ${result.difficulty}`
  );
}
