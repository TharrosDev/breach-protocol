import { test, expect, type Page } from '@playwright/test';
import { APP_URL, DEBUG_URL, PLAY_TIMEOUT_MS, quietHud } from './support';

// Text rules (spec §1.8, §4; plan Phase 5): every visible text element on every screen and in the HUD is at least
// 12 px, uses uppercase only on labels of three words or fewer, and has letter-spacing of at most 0.02em.

// The rules as numbers. The letter-spacing limit is 0.02 of the element's own font size.
const MIN_FONT_PX = 12;
const MAX_UPPER_WORDS = 3;
const MAX_TRACKING_EM = 0.02;

interface Violation {
  readonly rule: string;
  readonly text: string;
  readonly detail: string;
}

// Runs in the page. Walks every element that has its own text node, skips the ones that are not rendered, and
// reports each rule it breaks. The text is the element's own text (its text nodes), so a parent is not counted twice.
function findViolations(limits: {
  minFont: number;
  maxUpperWords: number;
  maxTrackingEm: number;
}): Violation[] {
  const out: Violation[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (own === '') continue;
    if (el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const text = own.slice(0, 60);
    const size = Number.parseFloat(cs.fontSize);
    if (!(size >= limits.minFont)) {
      out.push({ rule: 'font-size', text, detail: `${String(size)}px` });
    }
    if (cs.textTransform === 'uppercase') {
      const words = own.split(' ').length;
      if (words > limits.maxUpperWords) {
        out.push({ rule: 'uppercase', text, detail: `${String(words)} words` });
      }
    }
    const tracking = cs.letterSpacing === 'normal' ? 0 : Number.parseFloat(cs.letterSpacing);
    if (tracking > limits.maxTrackingEm * size + 1e-6) {
      out.push({ rule: 'letter-spacing', text, detail: `${tracking.toFixed(2)}px at ${String(size)}px` });
    }
  }
  return out;
}

async function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(findViolations, {
    minFont: MIN_FONT_PX,
    maxUpperWords: MAX_UPPER_WORDS,
    maxTrackingEm: MAX_TRACKING_EM,
  });
}

const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
] as const;

for (const size of SIZES) {
  test.describe(`${String(size.width)}x${String(size.height)}`, () => {
    test.use({ viewport: size });

    test('menu, brief, loadout, settings tabs, and the Compound brief', async ({ page }) => {
      await quietHud(page);
      await page.goto(APP_URL);
      expect(await violations(page), 'menu').toEqual([]);

      await page.getByRole('button', { name: 'Deploy' }).click();
      expect(await violations(page), 'brief').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Mission setup' }).click();
      expect(await violations(page), 'loadout').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Career' }).click();
      await expect(page.getByRole('heading', { name: 'Career' })).toBeVisible();
      expect(await violations(page), 'career').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Settings' }).click();
      for (const tab of ['Controls', 'Mouse', 'Display', 'Audio']) {
        await page.getByRole('tab', { name: tab }).click();
        expect(await violations(page), `settings ${tab}`).toEqual([]);
      }
    });

    test('pause, debrief and the match HUD', async ({ page }) => {
      test.setTimeout(PLAY_TIMEOUT_MS);
      await quietHud(page);
      await page.goto(DEBUG_URL);
      await page.getByRole('button', { name: 'Deploy' }).click();
      await page.getByRole('button', { name: 'Launch mission' }).click();
      await page.locator('.hud').waitFor({ state: 'visible' });
      // The HUD is laid out and its zone cards filled before the rules are read.
      await expect(page.locator('.hud-zn')).toHaveCount(3);
      expect(await violations(page), 'hud').toEqual([]);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
      expect(await violations(page), 'pause').toEqual([]);

      await page.getByRole('button', { name: 'Resume' }).click();
      await page.evaluate(() => {
        (window as unknown as { __bp: { forceTickets(n: number): void } }).__bp.forceTickets(0);
      });
      await expect(page.getByRole('heading', { name: 'Sector Secured' })).toBeVisible();
      expect(await violations(page), 'debrief').toEqual([]);
    });
  });
}

// The rules are not vacuous: a page with body copy in uppercase and tracked out is reported. This runs the same
// checker against a page built here.
test('the checker reports uppercase body copy, tracked text and small type', async ({ page }) => {
  await page.setContent(`
    <p style="font-size:14px; text-transform:uppercase">Four words of body copy here</p>
    <p style="font-size:14px; letter-spacing:0.1em">Tracked out body copy</p>
    <p style="font-size:10px">Tiny body copy</p>
    <p style="font-size:12px; text-transform:uppercase">Squad label</p>
  `);
  const found = await violations(page);
  const rules = found.map((v) => v.rule).sort();
  expect(rules).toEqual(['font-size', 'letter-spacing', 'uppercase']);
  expect(found.find((v) => v.rule === 'uppercase')?.text).toBe('Four words of body copy here');
});
