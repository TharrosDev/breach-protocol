import { AudioGraph, playEvent, type SoundEvent } from '../audio';
import type { Settings } from '../persist/schema';

// Voice limiting. Every sound is a few Web Audio nodes (a source, maybe a filter, a gain) that the browser frees when
// the sound ends. A firefight with many hostiles can start dozens a second, and past a point the extra ones are
// inaudible but still cost CPU and garbage. Background sounds (hostile and squad fire, sentry, medic) are dropped when
// the same kind just played, or when too many sounds have started in the last half second. The player's own sounds
// and blasts are never dropped.
const BACKGROUND: ReadonlySet<SoundEvent['type']> = new Set([
  'enemyShot',
  'friendlyRifle',
  'sentry',
  'medicHeal',
]);
const BACKGROUND_MIN_GAP_S = 0.03;
const VOICE_WINDOW_S = 0.5;
const VOICE_WINDOW_MAX = 24;

// The volume and mute levels the graph follows.
export type SoundLevels = Pick<Settings, 'volume' | 'muted'>;

// The page's sound (spec §1.7). The AudioGraph is made once per page, on the first user gesture, because browsers
// only let an AudioContext start inside one (legacy audioInit, index.html:1318). When audio is missing, the graph is
// null and every call here does nothing, so the game runs silent.
export class AppSound {
  private graph: AudioGraph | null = null;
  private tried = false;
  private levels: SoundLevels;
  private readonly lastStart = new Map<SoundEvent['type'], number>();
  // Start times of the most recent sounds, oldest first. Capped at VOICE_WINDOW_MAX entries.
  private readonly recent: number[] = [];

  constructor(
    levels: SoundLevels,
    private readonly makeGraph: () => AudioGraph | null = () => AudioGraph.create(),
  ) {
    this.levels = { volume: levels.volume, muted: levels.muted };
  }

  // Called on every user gesture. The first call makes the graph and applies the levels. Every call resumes the
  // context while it is not running, because resume() must run inside a gesture and a key the browser does not count
  // as one (Escape) can come first.
  unlock(): void {
    if (!this.tried) {
      this.tried = true;
      this.graph = this.makeGraph();
      this.applyLevels();
    }
    if (this.graph !== null && this.graph.state !== 'running') void this.graph.resume();
  }

  // The current volume and mute. Applied to the master bus at once, and kept for a graph made later.
  setLevels(levels: SoundLevels): void {
    this.levels = { volume: levels.volume, muted: levels.muted };
    this.applyLevels();
  }

  // Plays one sound. A failure in the audio stack must not stop the match loop, so it is contained here.
  play(ev: SoundEvent): void {
    if (this.graph === null) return;
    try {
      const now = this.graph.context.currentTime;
      if (BACKGROUND.has(ev.type)) {
        const last = this.lastStart.get(ev.type);
        if (last !== undefined && now - last < BACKGROUND_MIN_GAP_S && now >= last) return;
        const oldest = this.recent[0];
        if (this.recent.length >= VOICE_WINDOW_MAX && oldest !== undefined && now - oldest < VOICE_WINDOW_S)
          return;
        this.lastStart.set(ev.type, now);
      }
      this.recent.push(now);
      if (this.recent.length > VOICE_WINDOW_MAX) this.recent.shift();
      playEvent(this.graph, ev);
    } catch {
      // Audio stays silent for this sound; gameplay never depends on it.
    }
  }

  private applyLevels(): void {
    this.graph?.setMasterVolume(this.levels.volume);
    this.graph?.setMuted(this.levels.muted);
  }
}
