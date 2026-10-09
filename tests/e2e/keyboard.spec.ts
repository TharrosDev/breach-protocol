import { test, expect, type Page } from '@playwright/test';
import { APP_URL, DEBUG_URL, PLAY_TIMEOUT_MS, matchState } from './support';

// The match runs on software WebGL here, so state changes can take a few seconds to show.
const SLOW = { timeout: 20_000 };

// Keyboard-only path (plan Phase 5 gate): every screen is reachable and usable with Tab, arrows, Enter and Esc.
// The mouse is not used after the page loads.

async function readPrimary(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bp_loadout');
    const parsed = raw === null ? {} : (JSON.parse(raw) as { primary?: string });
    return parsed.primary;
  });
}

test('menu, loadout, settings, brief and launch, with the keyboard only', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await page.goto(APP_URL);

  const deploy = page.getByRole('button', { name: 'Deploy' });
  const missionSetup = page.getByRole('button', { name: 'Mission setup' });
  const settingsButton = page.getByRole('button', { name: 'Settings' });

  // Menu: focus starts on Deploy. Tab reaches Mission setup.
  await expect(deploy).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(missionSetup).toBeFocused();
  await page.keyboard.press('Enter');

  // Loadout: focus lands on Done. Tab moves into the primary weapon grid, on the selected weapon.
  const vx = page.getByRole('radio', { name: 'VX-9 Rifle' });
  const kv = page.getByRole('radio', { name: 'K-Vector' });
  await expect(page.getByRole('heading', { name: 'Mission setup' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(vx).toBeFocused();
  await expect(vx).toHaveAttribute('aria-checked', 'true');

  // Arrow keys move through the grid and select (single-choice radio group).
  await page.keyboard.press('ArrowRight');
  await expect(kv).toBeFocused();
  await expect(kv).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => readPrimary(page)).toBe('kv');

  // Escape goes back to the menu, and focus returns to the menu's first control.
  await page.keyboard.press('Escape');
  await expect(deploy).toBeFocused();

  // Settings: Tab, Tab, Enter opens it. Focus lands on the Controls tab.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(settingsButton).toBeFocused();
  await page.keyboard.press('Enter');
  const controls = page.getByRole('tab', { name: 'Controls' });
  const mouseTab = page.getByRole('tab', { name: 'Mouse' });
  await expect(controls).toBeFocused();
  await expect(controls).toHaveAttribute('aria-selected', 'true');

  // The tab list moves with the arrow keys: Mouse, then back to Controls.
  await page.keyboard.press('ArrowDown');
  await expect(mouseTab).toBeFocused();
  await expect(mouseTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(controls).toBeFocused();
  await expect(controls).toHaveAttribute('aria-selected', 'true');

  // Escape goes back to the menu.
  await page.keyboard.press('Escape');
  await expect(deploy).toBeFocused();

  // Brief: Enter on Deploy opens it, and focus lands on Launch.
  await page.keyboard.press('Enter');
  const launch = page.getByRole('button', { name: 'Launch mission' });
  await expect(launch).toBeFocused();

  // Enter on Launch starts the match.
  await page.keyboard.press('Enter');
  await expect(page.locator('.hud')).toBeVisible();
});

test('pause, settings from pause, and debrief, with the keyboard only', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await page.goto(DEBUG_URL);
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  await expect.poll(() => matchState(page), SLOW).toBe('play');

  // Escape pauses. Resume is focused.
  await page.keyboard.press('Escape');
  const resume = page.getByRole('button', { name: 'Resume' });
  await expect.poll(() => matchState(page), SLOW).toBe('paused');
  await expect(resume).toBeFocused();

  // Tab to Settings and open it. Escape returns to the pause screen, with Resume focused again.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Controls' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(resume).toBeFocused();

  // Enter on Resume plays on.
  await page.keyboard.press('Enter');
  await expect.poll(() => matchState(page), SLOW).toBe('play');

  // The enemy tickets run out, so the debrief opens with Redeploy focused.
  await page.evaluate(() => {
    (window as unknown as { __bp: { forceTickets(n: number): void } }).__bp.forceTickets(0);
  });
  const redeploy = page.getByRole('button', { name: 'Redeploy' });
  await expect(page.getByRole('heading', { name: 'Sector Secured' })).toBeVisible(SLOW);
  await expect(redeploy).toBeFocused();

  // Tab reaches Main menu. Enter leaves for the menu, and Deploy is focused there.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Main menu' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeFocused();
});

test('every visible button on every screen has an accessible name', async ({ page }) => {
  // Stands in for an axe run, which is not installed (see the Phase 5 report). It checks the same rule axe uses for
  // buttons: a visible button needs a name.
  await page.goto(APP_URL);
  const unnamed = async (): Promise<string[]> =>
    page.evaluate(() => {
      const out: string[] = [];
      for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('button'))) {
        if (b.getClientRects().length === 0) continue;
        const parts = [b.getAttribute('aria-label'), b.textContent].filter((p): p is string => p !== null);
        if (parts.join(' ').trim() === '') out.push(b.outerHTML.slice(0, 80));
      }
      return out;
    });
  const screens: { go: () => Promise<void>; label: string }[] = [
    { label: 'menu', go: async () => {} },
    {
      label: 'loadout',
      go: async () => {
        await page.getByRole('button', { name: 'Mission setup' }).click();
      },
    },
    {
      label: 'settings',
      go: async () => {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Settings' }).click();
      },
    },
    {
      label: 'brief',
      go: async () => {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Deploy' }).click();
      },
    },
  ];
  for (const screen of screens) {
    await screen.go();
    expect(await unnamed(), screen.label).toEqual([]);
  }
});
