import { DEFAULT_BINDINGS } from '../content/bindingDefaults';
import { ACTIONS, type Action } from '../content/ids';

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {};
}

// Key bindings as KeyboardEvent.code strings. Each action has exactly one code unless loaded data conflicts.
export class Bindings {
  private readonly codes: Record<Action, string>;

  // Accepts any value (usually parsed storage). Unknown action keys are dropped, invalid values fall back per action.
  constructor(source: unknown) {
    const raw = asRecord(source);
    const codes = {} as Record<Action, string>;
    for (const action of ACTIONS) {
      const value = raw[action];
      codes[action] = typeof value === 'string' && value !== '' ? value : DEFAULT_BINDINGS[action];
    }

    // The first action in ACTIONS order keeps a shared code. Later duplicates get their default if it is free.
    const kept = new Set<string>();
    const duplicates: Action[] = [];
    for (const action of ACTIONS) {
      if (kept.has(codes[action])) duplicates.push(action);
      else kept.add(codes[action]);
    }
    for (const action of duplicates) {
      const fallback = DEFAULT_BINDINGS[action];
      if (!kept.has(fallback)) {
        codes[action] = fallback;
        kept.add(fallback);
      }
    }

    this.codes = codes;
  }

  get(action: Action): string {
    return this.codes[action];
  }

  // Taking a code that another action uses swaps the two: the other action receives this action's old code.
  set(action: Action, code: string): void {
    if (code === '') return;
    const holder = this.actionFor(code);
    if (holder !== undefined && holder !== action) {
      this.codes[holder] = this.codes[action];
    }
    this.codes[action] = code;
  }

  reset(): void {
    for (const action of ACTIONS) {
      this.codes[action] = DEFAULT_BINDINGS[action];
    }
  }

  actionFor(code: string): Action | undefined {
    return ACTIONS.find((action) => this.codes[action] === code);
  }

  // Actions whose code is also held by an earlier action in ACTIONS order. Empty when every code is unique.
  conflicts(): Action[] {
    const seen = new Set<string>();
    const out: Action[] = [];
    for (const action of ACTIONS) {
      const code = this.codes[action];
      if (seen.has(code)) out.push(action);
      else seen.add(code);
    }
    return out;
  }

  toJSON(): Record<Action, string> {
    return { ...this.codes };
  }
}
