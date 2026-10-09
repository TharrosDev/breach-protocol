import type { Page } from '@playwright/test';

// Shared helpers for the Phase 5 E2E specs. The match runs on SwiftShader here, so frames are slow: the play tests
// get 90 s instead of 30 s.
export const PLAY_TIMEOUT_MS = 90_000;

// Screen names as the screens set them in data-screen (ui/screens/*), used by the specs to find a screen root.
export type ScreenName = 'menu' | 'brief' | 'loadout' | 'settings' | 'pause' | 'debrief';

export const APP_URL = '/';
export const DEBUG_URL = '/?debug';

// Seen-intro flag set, so the one-time control hints never cover the HUD in a test.
export const SEEN_INTRO = 'bp_intro';

// Starts a match from the menu with the mouse (Deploy, then Launch mission) and waits for the HUD to show.
export async function launchMatchWithMouse(page: Page): Promise<void> {
  await page.goto(DEBUG_URL);
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  await page.locator('.hud').waitFor({ state: 'visible' });
}

// The match state the debug hook reports ('menu', 'play', 'paused' or 'over'). Needs the ?debug page.
export async function matchState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bp = (window as unknown as { __bp?: { state: string } }).__bp;
    return bp?.state ?? 'none';
  });
}

// Keeps the one-time control hints off the HUD (they fade in for about 12 s after the first launch).
export async function quietHud(page: Page): Promise<void> {
  await page.addInitScript(
    ({ intro }: { intro: string }) => {
      try {
        if (localStorage.getItem(intro) === null) localStorage.setItem(intro, '1');
      } catch {
        // Storage blocked: the hints simply show.
      }
    },
    { intro: SEEN_INTRO },
  );
}
