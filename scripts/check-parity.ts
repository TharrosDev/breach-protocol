import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ParityRow {
  id: string;
  feature: string;
  specSection: string;
  testFile: string;
}

// Parses the markdown table in docs/parity.md: | ID | Feature | Spec § | Test file |
export function parseParityTable(markdown: string): ParityRow[] {
  const rows: ParityRow[] = [];
  for (const line of markdown.split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 4) continue;
    const [id, feature, specSection, testFile] = cells as [string, string, string, string];
    if (!/^[A-Z]+-\d{2}$/.test(id)) continue;
    rows.push({ id, feature, specSection, testFile: testFile.replace(/`/g, '') });
  }
  return rows;
}

// Returns the IDs of rows whose test file does not exist on disk.
export function missingTests(rows: ParityRow[], root: string): string[] {
  return rows.filter((r) => !existsSync(resolve(root, r.testFile))).map((r) => r.id);
}

function main(): void {
  const root = process.cwd();
  const rows = parseParityTable(readFileSync(resolve(root, 'docs/parity.md'), 'utf8'));
  const missing = missingTests(rows, root);
  console.log(`Parity rows: ${String(rows.length)}. Rows without a test file: ${String(missing.length)}`);
  for (const id of missing) console.log(`  missing: ${id}`);
  if (process.env.PARITY_STRICT === '1' && missing.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
