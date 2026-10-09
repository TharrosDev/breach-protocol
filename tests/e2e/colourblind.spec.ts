import { test, expect, type Locator, type Page } from '@playwright/test';
import { DEBUG_URL, PLAY_TIMEOUT_MS, quietHud } from './support';

// Colour-blind palette (spec §1.6, §4): the Display setting switches every UI colour token, and the zone and HUD
// colours drawn from them, without a reload. The checks read computed styles from the rendered page.
// Tokens (tokens.ts): hostile #ff3b3b normal, #ffb000 colour-blind. Health #4dff9a normal, #2f6bff colour-blind.
// Contested zone #ffb020 normal, #ffb000 colour-blind. The first zone is contested at the start, because the guards
// stand in it, so the zone check reads the contested colour.

const LABEL = 'Colour-blind friendly colours (zones, HUD, markers)';

// Expected computed colours for each palette, as the browser reports background-color.
const NORMAL = {
  hostile: 'rgb(255, 59, 59)',
  health: 'rgb(77, 255, 154)',
  contested: 'rgb(255, 176, 32)',
};
const COLOURBLIND = {
  hostile: 'rgb(255, 176, 0)',
  health: 'rgb(47, 107, 255)',
  contested: 'rgb(255, 176, 0)',
};

async function setColourBlind(page: Page, on: boolean): Promise<void> {
  const box = page.getByRole('checkbox', { name: LABEL });
  if ((await box.isChecked()) !== on) await box.click();
  await expect(box).toBeChecked({ checked: on });
}

async function openDisplayTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
}

// The attribute on <html> and the token value the page resolves, read from the document.
async function paletteOnPage(page: Page): Promise<{ attr: string | undefined; hostile: string }> {
  return page.evaluate(() => ({
    attr: document.documentElement.dataset.colour,
    hostile: getComputedStyle(document.documentElement).getPropertyValue('--tok-hostile').trim(),
  }));
}

// The HUD fills that carry the three tokens under test.
function hudFills(page: Page): { hostile: Locator; health: Locator; contested: Locator } {
  return {
    hostile: page.locator('.hud-etk-bar > i'),
    health: page.locator('.hud-hp > i'),
    contested: page.locator('.hud-zn').first().locator('.hud-bar > i'),
  };
}

async function expectPalette(page: Page, palette: typeof NORMAL): Promise<void> {
  const fills = hudFills(page);
  await expect(fills.hostile).toHaveCSS('background-color', palette.hostile);
  await expect(fills.health).toHaveCSS('background-color', palette.health);
  await expect(fills.contested).toHaveCSS('background-color', palette.contested);
}

test('the setting switches the tokens on the page and the HUD colours with them', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await quietHud(page);
  await page.goto(DEBUG_URL);

  // Off by default: normal tokens.
  expect(await paletteOnPage(page)).toEqual({ attr: 'normal', hostile: '#ff3b3b' });

  await openDisplayTab(page);
  await setColourBlind(page, true);
  expect(await paletteOnPage(page)).toEqual({ attr: 'colourblind', hostile: '#ffb000' });

  // Back to the menu and into a match. The HUD takes the colour-blind palette from the saved setting.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  await page.locator('.hud').waitFor({ state: 'visible' });
  await expect(page.locator('.hud-zn')).toHaveCount(3);

  await expectPalette(page, COLOURBLIND);
});

test('a change made in the pause settings reaches the running match', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  await quietHud(page);
  await page.goto(DEBUG_URL);
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  await page.locator('.hud').waitFor({ state: 'visible' });
  await expect(page.locator('.hud-zn')).toHaveCount(3);
  await expectPalette(page, NORMAL);

  // Pause, switch the palette on in the settings, and resume. The HUD and zones change without a reload.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await setColourBlind(page, true);
  expect((await paletteOnPage(page)).attr).toBe('colourblind');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume' }).click();

  await expectPalette(page, COLOURBLIND);

  // The setting is saved, so a reload keeps it.
  await page.reload();
  expect(await paletteOnPage(page)).toEqual({ attr: 'colourblind', hostile: '#ffb000' });
});
