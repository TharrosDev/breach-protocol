// Optional performance overlay, shown when the page is opened with ?perf. It is off by default and costs nothing then:
// no object is made and the frame loop only checks one reference. The same numbers are available to scripts as
// window.__bpPerf (a snapshot object, refreshed four times a second) so a profiling run can log them.
import type * as THREE from 'three';

export interface PerfCounts {
  // Entities the sim holds right now.
  enemies: number;
  enemiesAlive: number;
  operators: number;
  // Render scale factor from the resolution scaler, and the pixel ratio actually in use.
  scale: number;
  pixelRatio: number;
  // Sim time dropped by the max-steps clamp, in seconds.
  droppedSimSeconds: number;
}

export interface PerfSnapshot extends PerfCounts {
  fps: number;
  // Time between frames (what the player sees) and time spent inside the frame function (CPU side), in ms.
  frameMsAvg: number;
  frameMsWorst: number;
  cpuMsAvg: number;
  cpuMsWorst: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

declare global {
  interface Window {
    __bpPerf?: PerfSnapshot;
  }
}

// True when the URL asks for the overlay.
export function perfRequested(search: string): boolean {
  return new URLSearchParams(search).has('perf');
}

export interface PerfMonitor {
  // Call at the start of the frame function, with the rAF timestamp.
  begin(now: number): void;
  // Call after the frame has been drawn.
  end(counts: PerfCounts): void;
  dispose(): void;
}

const REFRESH_MS = 250;

export function createPerfMonitor(root: HTMLElement, renderer: THREE.WebGLRenderer): PerfMonitor {
  const doc = root.ownerDocument;
  const box = doc.createElement('pre');
  box.className = 'hud-perf';
  box.setAttribute('aria-hidden', 'true');
  root.append(box);
  // The composer renders in several passes per frame; keep the counters until the frame is over.
  renderer.info.autoReset = false;

  let lastNow = 0;
  let startedAt = 0;
  let frames = 0;
  let frameSum = 0;
  let frameWorst = 0;
  let cpuSum = 0;
  let cpuWorst = 0;
  let windowStart = performance.now();

  return {
    begin(now) {
      if (lastNow > 0) {
        const dt = now - lastNow;
        if (dt < 1000) {
          frameSum += dt;
          frameWorst = Math.max(frameWorst, dt);
          frames += 1;
        }
      }
      lastNow = now;
      startedAt = performance.now();
      renderer.info.reset();
    },
    end(counts) {
      const t = performance.now();
      const cpu = t - startedAt;
      cpuSum += cpu;
      cpuWorst = Math.max(cpuWorst, cpu);
      if (t - windowStart < REFRESH_MS || frames === 0) return;
      const info = renderer.info;
      const snap: PerfSnapshot = {
        ...counts,
        fps: (frames * 1000) / (t - windowStart),
        frameMsAvg: frameSum / frames,
        frameMsWorst: frameWorst,
        cpuMsAvg: cpuSum / frames,
        cpuMsWorst: cpuWorst,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
      window.__bpPerf = snap;
      box.textContent =
        `${snap.fps.toFixed(0)} fps  frame ${snap.frameMsAvg.toFixed(1)} ms (worst ${snap.frameMsWorst.toFixed(0)})\n` +
        `cpu ${snap.cpuMsAvg.toFixed(1)} ms (worst ${snap.cpuMsWorst.toFixed(0)})\n` +
        `draws ${String(snap.drawCalls)}  tris ${String(snap.triangles)}\n` +
        `geo ${String(snap.geometries)}  tex ${String(snap.textures)}  progs ${String(snap.programs)}\n` +
        `hostiles ${String(snap.enemiesAlive)}/${String(snap.enemies)}  ops ${String(snap.operators)}\n` +
        `res x${snap.scale.toFixed(2)}  pr ${snap.pixelRatio.toFixed(2)}  dropped ${snap.droppedSimSeconds.toFixed(1)} s`;
      frames = 0;
      frameSum = 0;
      frameWorst = 0;
      cpuSum = 0;
      cpuWorst = 0;
      windowStart = t;
    },
    dispose() {
      box.remove();
      renderer.info.autoReset = true;
      delete window.__bpPerf;
    },
  };
}
