import { AudioGraph, playEvent, type SoundEvent } from '../audio';
import type { Settings } from '../persist/schema';

// The volume and mute levels the graph follows.
export type SoundLevels = Pick<Settings, 'volume' | 'muted'>;

// The page's sound (spec §1.7). The AudioGraph is made once per page, on the first user gesture, because browsers
// only let an AudioContext start inside one (legacy audioInit, index.html:1318). When audio is missing, the graph is
// null and every call here does nothing, so the game runs silent.
export class AppSound {
  private graph: AudioGraph | null = null;
  private tried = false;
  private levels: SoundLevels;

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
