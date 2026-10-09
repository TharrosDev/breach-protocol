import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingTests, parseParityTable } from '../../scripts/check-parity';

describe('parity table', () => {
  it('parses rows and ignores the header', () => {
    const md = [
      '| ID | Feature | Spec § | Test file |',
      '|---|---|---|---|',
      '| MOVE-01 | Walk speed | 1.2 | `tests/unit/movement.test.ts` |',
    ].join('\n');
    const rows = parseParityTable(md);
    expect(rows).toEqual([
      { id: 'MOVE-01', feature: 'Walk speed', specSection: '1.2', testFile: 'tests/unit/movement.test.ts' },
    ]);
  });

  it('reports only rows whose test file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'parity-'));
    mkdirSync(join(root, 'tests/unit'), { recursive: true });
    writeFileSync(join(root, 'tests/unit/present.test.ts'), '');
    const rows = [
      { id: 'A-01', feature: 'a', specSection: '1', testFile: 'tests/unit/present.test.ts' },
      { id: 'B-01', feature: 'b', specSection: '1', testFile: 'tests/unit/absent.test.ts' },
    ];
    expect(missingTests(rows, root)).toEqual(['B-01']);
  });
});
