import { test, expect } from '@playwright/test';

async function hasWebGL2(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
}

test('new app boots with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Breach Protocol');
  const gl = await hasWebGL2(page);
  const heading = gl ? 'Breach Protocol' : 'WebGL 2 is required';
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  expect(errors).toEqual([]);
});

test('new app has no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('legacy game is served at /legacy/', async ({ page }) => {
  const response = await page.goto('/legacy/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeVisible();
});
