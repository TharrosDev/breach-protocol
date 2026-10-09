import type { Action } from '../content/ids';
import type { Bindings } from './bindings';

// The subset of Bindings the command snapshot needs. Type-only, so this module has no runtime dependency on bindings.ts.
export type BindingLookup = Pick<Bindings, 'get' | 'actionFor'>;

// One frame of player intent. The simulation reads this and never touches DOM events.
export interface Command {
  move: { fwd: -1 | 0 | 1; strafe: -1 | 0 | 1 };
  look: { dx: number; dy: number };
  buttons: { fire: boolean; ads: boolean };
  pressed: ReadonlySet<Action>;
  crouch: boolean;
  sprint: boolean;
}

// index.html:1724-1725. Opposing keys cancel to 0.
function axis(positive: boolean, negative: boolean): -1 | 0 | 1 {
  if (positive === negative) return 0;
  return positive ? 1 : -1;
}

// Pure snapshot builder. `held` is the set of KeyboardEvent.code values currently down; `pressedCodes` are the codes newly pressed since the last frame.
// Movement reads through the bindings, so a rebind changes which key moves the player (legacy index.html:1724, 1738).
export function buildCommand(
  held: ReadonlySet<string>,
  mouse: { fire: boolean; ads: boolean },
  look: { dx: number; dy: number },
  pressedCodes: ReadonlySet<string>,
  bindings: BindingLookup,
): Command {
  const pressed = new Set<Action>();
  for (const code of pressedCodes) {
    const action = bindings.actionFor(code);
    if (action !== undefined) pressed.add(action);
  }
  return {
    move: {
      fwd: axis(held.has(bindings.get('forward')), held.has(bindings.get('back'))),
      strafe: axis(held.has(bindings.get('right')), held.has(bindings.get('left'))),
    },
    look: { dx: look.dx, dy: look.dy },
    buttons: { fire: mouse.fire, ads: mouse.ads },
    pressed,
    crouch: held.has(bindings.get('crouch')),
    sprint: held.has(bindings.get('sprint')),
  };
}
