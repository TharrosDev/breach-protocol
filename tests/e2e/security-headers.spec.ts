import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { launchMatchWithMouse, PLAY_TIMEOUT_MS, quietHud } from './support';

// The production headers live in vercel.json. Preview serves none, so this spec attaches them to every response and
// checks that boot and a match raise no Content-Security-Policy violation. A new inline script or an external
// request would fail here before it reached production.
interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(
  readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
) as VercelConfig;
const HEADERS: Record<string, string> = Object.fromEntries(
  (config.headers[0]?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]),
);

test('the production policy is set and the page loads and plays without violations', async ({ page }) => {
  test.setTimeout(PLAY_TIMEOUT_MS);
  expect(HEADERS['content-security-policy']).toContain("default-src 'self'");
  expect(HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");

  await quietHud(page);
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...HEADERS } });
  });

  await launchMatchWithMouse(page);
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);
});
