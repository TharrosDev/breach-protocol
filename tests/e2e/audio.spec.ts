import { test, expect, type Page } from '@playwright/test';
import { APP_URL, PLAY_TIMEOUT_MS, launchMatchWithMouse, matchState, quietHud } from './support';

// Audio wiring (plan Phase 6 gate: volume and mute persist; no audio errors). The page gets a fake AudioContext before
// any script runs. It records the nodes it creates and what they connect to, so the master gain can be read back.

interface AudioCounts {
  sources: number;
  oscillators: number;
  resumes: number;
  master: number | null;
}

// Installed before the page loads. The fake is the only AudioContext the page can see.
async function installFakeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Rec {
      id: number;
      kind: string;
      gain?: { value: number };
      frequency?: { value: number };
      type?: string;
    }
    const log = {
      nodes: [] as Rec[],
      links: [] as Array<[Rec, Rec]>,
      sources: 0,
      oscillators: 0,
      resumes: 0,
    };
    let nextId = 1;

    class FakeParam {
      value = 1;
      setValueAtTime(): void {
        // Envelope automation is not read back.
      }
      exponentialRampToValueAtTime(): void {
        // Envelope automation is not read back.
      }
    }

    class FakeNode {
      readonly id = nextId++;
      constructor(readonly kind: string) {
        log.nodes.push(this);
      }
      connect(destination: unknown): unknown {
        log.links.push([this, destination as Rec]);
        return destination;
      }
    }

    class FakeAudioContext {
      readonly currentTime = 0;
      readonly sampleRate = 48000;
      state = 'suspended';
      readonly destination = new FakeNode('destination');
      createGain(): unknown {
        const g = new FakeNode('gain') as unknown as FakeNode & { gain: FakeParam };
        g.gain = new FakeParam();
        return g;
      }
      createBiquadFilter(): unknown {
        const f = new FakeNode('filter') as unknown as FakeNode & { frequency: FakeParam; type: string };
        f.frequency = new FakeParam();
        f.type = 'lowpass';
        return f;
      }
      createBufferSource(): unknown {
        log.sources += 1;
        const s = new FakeNode('source') as unknown as FakeNode & { buffer: unknown };
        s.buffer = null;
        return Object.assign(s, { start(): void {}, stop(): void {} });
      }
      createOscillator(): unknown {
        log.oscillators += 1;
        const o = new FakeNode('oscillator') as unknown as FakeNode & { frequency: FakeParam };
        o.frequency = new FakeParam();
        return Object.assign(o, { start(): void {}, stop(): void {} });
      }
      createDynamicsCompressor(): unknown {
        return new FakeNode('compressor');
      }
      createBuffer(_channels: number, length: number): unknown {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      }
      resume(): Promise<void> {
        log.resumes += 1;
        this.state = 'running';
        return Promise.resolve();
      }
    }

    const hide = { value: undefined, configurable: true, writable: true };
    Object.defineProperty(window, '__audioFake', { value: log, configurable: true });
    Object.defineProperty(window, 'AudioContext', { ...hide, value: FakeAudioContext });
    Object.defineProperty(window, 'webkitAudioContext', { ...hide, value: FakeAudioContext });
  });
}

// What the fake recorded. The master gain is the gain node that connects into the limiter (the compressor).
function readAudio(page: Page): Promise<AudioCounts> {
  return page.evaluate(() => {
    interface Rec {
      kind: string;
      gain?: { value: number };
    }
    const log = (
      window as unknown as {
        __audioFake?: {
          nodes: Rec[];
          links: Array<[Rec, Rec]>;
          sources: number;
          oscillators: number;
          resumes: number;
        };
      }
    ).__audioFake;
    if (log === undefined) return { sources: 0, oscillators: 0, resumes: 0, master: null };
    const comp = log.nodes.find((n) => n.kind === 'compressor');
    const master = log.nodes.find(
      (n) => n.kind === 'gain' && comp !== undefined && log.links.some(([a, b]) => a === n && b === comp),
    );
    return {
      sources: log.sources,
      oscillators: log.oscillators,
      resumes: log.resumes,
      master: master?.gain?.value ?? null,
    };
  });
}

// The debug hook's shot count. Needs the ?debug page.
function shotCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __bp: { shots: number } }).__bp.shots);
}

async function openAudioTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Audio' }).click();
}

test('the first click makes the audio graph, and a shot plays a sound', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installFakeAudio(page);
  await quietHud(page);
  await launchMatchWithMouse(page);

  const beforeShots = await shotCount(page);
  const before = await readAudio(page);
  expect(before.resumes).toBeGreaterThanOrEqual(1);
  expect(before.master).toBeCloseTo(0.8, 5);

  await page.locator('canvas.play-canvas').click();
  await expect.poll(() => shotCount(page), { timeout: 30_000 }).toBeGreaterThan(beforeShots);
  await expect
    .poll(async () => {
      const now = await readAudio(page);
      return now.sources + now.oscillators;
    })
    .toBeGreaterThan(before.sources + before.oscillators);
  expect(errors).toEqual([]);
});

test('Mute all sound sets the master gain to 0, and unmuting restores it', async ({ page }) => {
  await installFakeAudio(page);
  await page.goto(APP_URL);
  await openAudioTab(page);

  const mute = page.getByRole('checkbox', { name: 'Mute all sound' });
  await expect(mute).not.toBeChecked();
  expect((await readAudio(page)).master).toBeCloseTo(0.8, 5);

  await mute.check();
  await expect.poll(async () => (await readAudio(page)).master).toBe(0);

  await mute.uncheck();
  await expect.poll(async () => (await readAudio(page)).master).toBeCloseTo(0.8, 5);
});

test('mute and master volume persist across a reload', async ({ page }) => {
  await installFakeAudio(page);
  await page.goto(APP_URL);
  await openAudioTab(page);

  const slider = page.getByRole('slider', { name: 'Master volume' });
  await slider.fill('0.35');
  await page.getByRole('checkbox', { name: 'Mute all sound' }).check();
  await expect.poll(async () => (await readAudio(page)).master).toBe(0);

  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('bp_settings') ?? '{}') as unknown,
  );
  expect(stored).toMatchObject({ volume: 0.35, muted: true });

  await page.reload();
  await openAudioTab(page);
  await expect(page.getByRole('checkbox', { name: 'Mute all sound' })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Master volume' })).toHaveValue('0.35');
  // The graph is made again on the new page's first gesture, with the stored levels applied.
  await expect.poll(async () => (await readAudio(page)).master).toBe(0);
});

test('with no AudioContext the game still reaches play and throws no page error', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitAudioContext', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
  await quietHud(page);
  await launchMatchWithMouse(page);
  await expect.poll(() => matchState(page), { timeout: 30_000 }).toBe('play');

  const before = await shotCount(page);
  await page.locator('canvas.play-canvas').click();
  await expect.poll(() => shotCount(page), { timeout: 30_000 }).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
