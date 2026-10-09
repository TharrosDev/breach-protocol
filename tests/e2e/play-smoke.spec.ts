import { test, expect } from '@playwright/test';

interface BpView {
  P: { pos: { x: number; y: number; z: number } };
  shots: number;
  hits: number;
  state: string;
}

function readView(page: import('@playwright/test').Page): Promise<BpView> {
  return page.evaluate(() => {
    const bp = (window as unknown as { __bp: BpView }).__bp;
    return { P: { pos: { ...bp.P.pos } }, shots: bp.shots, hits: bp.hits, state: bp.state };
  });
}

// Matches render with software WebGL (SwiftShader) here, so frames are slow and parallel workers compete for CPU.
// The play tests get 90 s instead of 30 s. Their checks are unchanged.
const PLAY_TIMEOUT_MS = 90_000;

test('deploy, move, fire at a dummy', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();

  const before = await readView(page);
  expect(before.state).toBe('play');

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');

  const after = await readView(page);
  expect(Math.abs(after.P.pos.z - before.P.pos.z)).toBeGreaterThan(3);

  // The HUD has a second canvas (the minimap), so the match canvas is selected by its class.
  await page.locator('canvas.play-canvas').click();
  const fired = await readView(page);
  expect(fired.shots).toBeGreaterThan(before.shots);
});

test('substation map loads and plays with no page errors', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('bp_loadout', JSON.stringify({ map: 'substation' }));
  });

  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByRole('heading', { name: 'Substation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Launch mission' }).click();

  // Let a few frames render, so a shader or render error would surface here.
  await page.waitForTimeout(1000);
  const view = await readView(page);
  expect(view.state).toBe('play');
  expect(errors).toEqual([]);
});

test('a match ends with the debrief when enemy tickets reach 0', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  // The poll allows for a slow software renderer when the workers run in parallel.
  await expect.poll(async () => (await readView(page)).state, { timeout: 30_000 }).toBe('play');

  // The one debug write: the enemy ticket pool goes to 0, so the next tick ends the match as a win.
  await page.evaluate(() => {
    (window as unknown as { __bp: { forceTickets(n: number): void } }).__bp.forceTickets(0);
  });

  await expect(page.getByRole('heading', { name: 'Sector Secured' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redeploy' })).toBeVisible();
  await expect.poll(async () => (await readView(page)).state, { timeout: 30_000 }).toBe('over');
});
