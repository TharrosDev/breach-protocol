import { test, expect, type Page } from '@playwright/test';
import { APP_URL, DEBUG_URL, PLAY_TIMEOUT_MS, quietHud } from './support';

// Responsive layout (plan Phase 5, spec §4): no horizontal scroll on any screen at phone and desktop sizes, and no
// overlap between the HUD panels at 390 px. Review Focus 5 is the 200% zoom case at 1280 px, which this test covers
// as a 640 px wide viewport (the same CSS width as 1280 px at 200%).

const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
] as const;

// Horizontal overflow in CSS pixels (0 or less means no horizontal scroll).
async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

// Each state opens the screen it names, from a fresh page at the given size.
type Shot = { name: string; open: (page: Page) => Promise<void> };

const SCREENS: readonly Shot[] = [
  { name: 'menu', open: async () => {} },
  {
    name: 'brief',
    open: async (page) => {
      await page.getByRole('button', { name: 'Deploy' }).click();
    },
  },
  {
    name: 'loadout',
    open: async (page) => {
      await page.getByRole('button', { name: 'Mission setup' }).click();
    },
  },
  {
    name: 'settings controls',
    open: async (page) => {
      await page.getByRole('button', { name: 'Settings' }).click();
    },
  },
  {
    name: 'settings mouse',
    open: async (page) => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Mouse' }).click();
    },
  },
  {
    name: 'settings display',
    open: async (page) => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Display' }).click();
    },
  },
  {
    name: 'settings audio',
    open: async (page) => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Audio' }).click();
    },
  },
];

for (const size of SIZES) {
  test.describe(`${String(size.width)}x${String(size.height)}`, () => {
    test.use({ viewport: size });

    for (const screen of SCREENS) {
      test(`no horizontal scroll on ${screen.name}`, async ({ page }) => {
        await quietHud(page);
        await page.goto(APP_URL);
        await screen.open(page);
        expect(await overflowPx(page), screen.name).toBeLessThanOrEqual(0);
      });
    }

    test('no horizontal scroll on pause and debrief, and in the match HUD', async ({ page }) => {
      test.setTimeout(PLAY_TIMEOUT_MS);
      await quietHud(page);
      await page.goto(DEBUG_URL);
      await page.getByRole('button', { name: 'Deploy' }).click();
      await page.getByRole('button', { name: 'Launch mission' }).click();
      await page.locator('.hud').waitFor({ state: 'visible' });
      expect(await overflowPx(page), 'hud').toBeLessThanOrEqual(0);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
      expect(await overflowPx(page), 'pause').toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: 'Resume' }).click();
      await page.evaluate(() => {
        (window as unknown as { __bp: { forceTickets(n: number): void } }).__bp.forceTickets(0);
      });
      await expect(page.getByRole('heading', { name: /Sector Secured|Mission Failed/ })).toBeVisible();
      expect(await overflowPx(page), 'debrief').toBeLessThanOrEqual(0);
    });
  });
}

// The HUD panels at 390 x 844 (phone): compass strip, zone cards, enemy tickets, feed, minimap, and the four
// corner panels. No two of them may overlap. The feed is empty at the start, so its box is zero-height and counts
// as no overlap. Boxes come from the HUD root's children, as the plan asks.
test('HUD panels do not overlap at 390 px', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await page.setViewportSize({ width: 390, height: 844 });
  await quietHud(page);
  await page.goto(DEBUG_URL);
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  await page.locator('.hud').waitFor({ state: 'visible' });
  // Let the first frames lay out the HUD and fill the zone cards.
  await expect(page.locator('.hud-zn')).toHaveCount(3);
  await expect(page.locator('.hud-mm')).toBeVisible();

  const boxes = await page.evaluate(() => {
    const pick = (sel: string): { name: string; x: number; y: number; w: number; h: number } | null => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { name: sel, x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const items = [
      '.hud-top',
      '.hud-compass',
      '.hud-zones',
      '.hud-etk',
      '.hud-mm',
      '.hud-feed',
      '.hud-left',
      '.hud-right',
      '.hud-bl',
      '.hud-br',
    ];
    return items.map((sel) => pick(sel)).filter((b): b is NonNullable<typeof b> => b !== null);
  });
  expect(boxes.length).toBe(10);

  const overlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): number => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };

  // Compass strip, zone cards, enemy tickets and the minimap are the four elements the plan names. The panels are
  // checked against each other too. Nested elements (the compass inside the top bar, the minimap inside the right
  // column) are skipped in pairs where one contains the other.
  const contains = (
    outer: { x: number; y: number; w: number; h: number },
    inner: { x: number; y: number; w: number; h: number },
  ): boolean =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;

  const problems: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === undefined || b === undefined) continue;
      if (contains(a, b) || contains(b, a)) continue;
      if (overlap(a, b) > 0) problems.push(`${a.name} overlaps ${b.name}`);
    }
  }
  expect(problems).toEqual([]);

  // Every HUD box stays on the screen.
  const offscreen = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > 390 || b.y + b.h > 844);
  expect(offscreen.map((b) => b.name)).toEqual([]);
});
