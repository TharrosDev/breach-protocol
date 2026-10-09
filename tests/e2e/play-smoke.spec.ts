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

test('deploy, move, fire at a dummy', async ({ page }) => {
  await page.goto('/next.html?debug');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();

  const before = await readView(page);
  expect(before.state).toBe('play');

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');

  const after = await readView(page);
  expect(Math.abs(after.P.pos.z - before.P.pos.z)).toBeGreaterThan(3);

  await page.locator('canvas').click();
  const fired = await readView(page);
  expect(fired.shots).toBeGreaterThan(before.shots);
});
