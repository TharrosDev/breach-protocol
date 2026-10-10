import { test, expect, type Page } from '@playwright/test';
import { APP_URL, DEBUG_URL, PLAY_TIMEOUT_MS, quietHud } from './support';

// Visual regression (spec §5; plan Phase 5): each screen and the in-match HUD at 1280 x 720 and 390 x 844. Only the DOM
// is compared. The 3D canvas is hidden with a stylesheet rule, so the stage behind it shows its solid background.
// (Masking the canvas itself would paint over the whole viewport and hide the HUD, because the canvas is full-size.)
// The minimap canvas and the feed are masked: the minimap is drawn each frame, and the feed depends on the browser (a
// pointer-lock notice). The debrief's score line and time tile are masked too (wall-clock seconds).
// Baselines live in visual.spec.ts-snapshots/ and are made with --update-snapshots.

const SIZES = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;

// A fixed local date, so the daily challenges in the screens do not change the baselines.
const FIXED_DAY = new Date(2026, 9, 10, 12, 0, 0);

const COMPARE = { maxDiffPixelRatio: 0.02, animations: 'disabled' as const, caret: 'hide' as const };

// Selectors masked in the match screens.
const MATCH_MASK = ['.hud-mm', '.hud-feed'];

// Hides the 3D canvas, so the stage's solid background is what the HUD and the pause screen sit on. The feed is hidden
// too: whether it holds a line (the pointer-lock notice) depends on timing, and the line moves the masks.
async function hideMatchCanvas(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.play-canvas { visibility: hidden !important; } .hud-feed { display: none !important; }',
  });
}

// Moves the pointer off the page first, so no button shows its hover state in the shot.
async function snap(page: Page, name: string, mask: readonly string[] = []): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(name, {
    ...COMPARE,
    mask: mask.map((selector) => page.locator(selector)),
    maskColor: '#ff00ff',
  });
}

for (const size of SIZES) {
  const tag = `${String(size.width)}x${String(size.height)}`;

  test.describe(tag, () => {
    test.use({ viewport: size });

    test('menu, brief and loadout', async ({ page }) => {
      // The menu lists the daily challenges, which come from the date.
      await page.clock.setFixedTime(FIXED_DAY);
      await quietHud(page);
      await page.goto(APP_URL);
      await expect(page.getByRole('heading', { name: 'Breach Protocol' })).toBeVisible();
      await snap(page, `menu-${tag}.png`);

      await page.getByRole('button', { name: 'Deploy' }).click();
      await expect(page.getByRole('heading', { name: 'Compound', exact: true })).toBeVisible();
      await snap(page, `brief-${tag}.png`);

      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Mission setup' }).click();
      await expect(page.getByRole('heading', { name: 'Mission setup' })).toBeVisible();
      await snap(page, `loadout-${tag}.png`);
    });

    test('career', async ({ page }) => {
      await page.clock.setFixedTime(FIXED_DAY);
      await quietHud(page);
      await page.goto(APP_URL);
      await page.getByRole('button', { name: 'Career' }).click();
      await expect(page.getByRole('heading', { name: 'Career' })).toBeVisible();
      await snap(page, `career-${tag}.png`);
    });

    test('settings: controls and mouse tabs', async ({ page }) => {
      await quietHud(page);
      await page.goto(APP_URL);
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('tab', { name: 'Controls' })).toHaveAttribute('aria-selected', 'true');
      await snap(page, `settings-controls-${tag}.png`);

      await page.getByRole('tab', { name: 'Mouse' }).click();
      await snap(page, `settings-mouse-${tag}.png`);
    });

    test('pause, debrief and the in-match HUD', async ({ page }) => {
      test.setTimeout(PLAY_TIMEOUT_MS);
      await page.clock.setFixedTime(FIXED_DAY);
      await quietHud(page);
      await page.goto(DEBUG_URL);
      await hideMatchCanvas(page);
      await page.getByRole('button', { name: 'Deploy' }).click();
      await page.getByRole('button', { name: 'Launch mission' }).click();
      await page.locator('.hud').waitFor({ state: 'visible' });
      await expect(page.locator('.hud-zn')).toHaveCount(3);
      await snap(page, `hud-${tag}.png`, MATCH_MASK);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
      await snap(page, `pause-${tag}.png`, MATCH_MASK);

      await page.getByRole('button', { name: 'Resume' }).click();
      await page.evaluate(() => {
        (window as unknown as { __bp: { forceTickets(n: number): void } }).__bp.forceTickets(0);
      });
      await expect(page.getByRole('heading', { name: 'Sector Secured' })).toBeVisible();
      await snap(page, `debrief-${tag}.png`, [
        ...MATCH_MASK,
        '.scr-nav > p.scr-sub',
        '.scr-tile:has-text("Time in match")',
      ]);
    });
  });
}
