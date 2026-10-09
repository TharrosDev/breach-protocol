import type { Action } from './ids';

// index.html:578-586 (default key codes, in ACTIONS order)
export const DEFAULT_BINDINGS: Readonly<Record<Action, string>> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'ControlLeft',
  sprint: 'ShiftLeft',
  reload: 'KeyR',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  gadget1: 'KeyG',
  gadget2: 'KeyF',
  interact: 'KeyE',
  melee: 'KeyQ',
  order: 'KeyV',
  killstreak: 'KeyH',
  scoreboard: 'Tab',
};

// index.html:579-583 (labels shown in the Controls settings)
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump / vault',
  crouch: 'Crouch / slide',
  sprint: 'Sprint',
  reload: 'Reload',
  weapon1: 'Primary weapon',
  weapon2: 'Sidearm',
  gadget1: 'Gadget slot 1',
  gadget2: 'Gadget slot 2',
  interact: 'Interact (resupply / breach)',
  melee: 'Melee knife',
  order: 'Squad order',
  killstreak: 'Use killstreak',
  scoreboard: 'Scoreboard',
};
