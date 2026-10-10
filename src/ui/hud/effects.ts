// DOM writes and HUD effects. Every write is skipped when the value has not changed, so a steady frame touches
// no DOM. Legacy: index.html:1484-1497 (damage indicator), 2810-2902 (hit numbers, spotted boxes), 3366-3380.
import type { ColourMode, HudView } from '../contracts';
import { HOSTILE_MARK_SHAPE } from '../tokens';
import {
  DAMAGE_INDICATOR_SECONDS,
  HIT_NUMBER_SECONDS,
  SPOT_HEIGHT,
  SPOT_MAX,
  markerSize,
  type WorldProjector,
} from './layout';

// Last value written per element and property. Browsers rewrite values such as 50.00% as 50%, so comparing against
// the element's own style would miss unchanged values.
// Keyed by the property name alone: only setStyle uses it, so no per-call key string is built.
const written = new WeakMap<Element, Map<string, string>>();

function changed(el: Element, key: string, value: string): boolean {
  let map = written.get(el);
  if (map === undefined) {
    map = new Map();
    written.set(el, map);
  }
  if (map.get(key) === value) return false;
  map.set(key, value);
  return true;
}

export function setText(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (changed(el, prop, value)) el.style.setProperty(prop, value);
}

export function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function setFlag(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

// Spotted hostile boxes (legacy #spots, index.html:3366-3380). Each box is a square frame with a distance label.
// Colour-blind mode draws a diamond, from HOSTILE_MARK_SHAPE, so the marker is not told apart by colour alone.
export interface SpotBoxes {
  update(
    spotted: HudView['spotted'],
    project: WorldProjector | undefined,
    playerX: number,
    playerZ: number,
  ): void;
  setMode(mode: ColourMode): void;
}

interface SpotBox {
  readonly node: HTMLElement;
  readonly frame: HTMLElement;
  readonly label: HTMLElement;
}

export function createSpotBoxes(parent: HTMLElement): SpotBoxes {
  const doc = parent.ownerDocument;
  const boxes: SpotBox[] = [];
  for (let i = 0; i < SPOT_MAX; i++) {
    const node = doc.createElement('div');
    node.className = 'hud-spot';
    node.hidden = true;
    const frame = doc.createElement('div');
    frame.className = 'hud-spot-frame';
    const label = doc.createElement('b');
    node.append(frame, label);
    parent.append(node);
    boxes.push({ node, frame, label });
  }
  let shape: 'square' | 'diamond' = HOSTILE_MARK_SHAPE.normal;

  return {
    setMode(mode) {
      shape = HOSTILE_MARK_SHAPE[mode];
    },
    update(spotted, project, playerX, playerZ) {
      let shown = 0;
      for (const s of spotted) {
        if (project === undefined) break;
        const box = boxes[shown];
        if (box === undefined) break;
        const p = project(s.x, SPOT_HEIGHT, s.z);
        if (!p.onScreen) continue;
        const dist = Math.hypot(s.x - playerX, s.z - playerZ);
        const size = markerSize(dist).toFixed(0);
        shown++;
        setHidden(box.node, false);
        setStyle(box.node, 'left', `${p.x.toFixed(0)}px`);
        setStyle(box.node, 'top', `${p.y.toFixed(0)}px`);
        setAttr(box.frame, 'data-shape', shape);
        setStyle(box.frame, 'width', `${size}px`);
        setStyle(box.frame, 'height', `${size}px`);
        setText(box.label, `${s.label} ${String(Math.round(dist))}m`);
      }
      for (let i = shown; i < boxes.length; i++) {
        const box = boxes[i];
        if (box !== undefined) setHidden(box.node, true);
      }
    },
  };
}

// Directional damage marker (legacy addDmgIndicator, index.html:1488-1495). relativeAngle is the bearing to the
// source minus the player's yaw, as legacy computes it. The marker is an arc on a ring around the crosshair that
// points at the source, with a bright core, and removes itself. intensity (0..1) scales its brightness and width,
// so a light hit is faint and a heavy hit is strong.
export function addDamageIndicator(root: HTMLElement, relativeAngle: number, intensity = 0.7): void {
  const el = root.ownerDocument.createElement('div');
  el.className = 'hud-ind';
  el.style.setProperty('transform', `rotate(${(-relativeAngle).toFixed(3)}rad)`);
  el.style.setProperty('--hud-ind-a', Math.min(1, Math.max(0.35, intensity)).toFixed(2));
  const arc = root.ownerDocument.createElement('i');
  el.append(arc);
  root.append(el);
  setTimeout(() => {
    el.remove();
  }, DAMAGE_INDICATOR_SECONDS * 1000);
}

// How many numbers are on screen right now, so a burst of hits fans out instead of stacking on one spot.
let liveNumbers = 0;

// Floating damage number at a screen point (legacy hitNumber, index.html:2820-2831). x and y are CSS pixels of the
// root; the caller projects the hit point. Headshots use the kill colour and a larger size; a kill gets the biggest
// size. Each number drifts sideways a little, and the size grows with the damage.
export function addHitNumber(
  root: HTMLElement,
  x: number,
  y: number,
  value: number,
  head: boolean,
  kill = false,
): void {
  const el = root.ownerDocument.createElement('div');
  const kind = kill ? ' kill' : head ? ' head' : '';
  el.className = `hud-dn${kind}`;
  el.textContent = String(Math.round(value));
  const fan = (liveNumbers % 5) - 2;
  el.style.setProperty('left', `${(x + fan * 14).toFixed(0)}px`);
  el.style.setProperty('top', `${(y - Math.min(liveNumbers, 4) * 6).toFixed(0)}px`);
  el.style.setProperty('--hud-dn-drift', `${String(fan * 9)}px`);
  el.style.setProperty('--hud-dn-size', `${(14 + Math.min(14, value / 6)).toFixed(0)}px`);
  root.append(el);
  liveNumbers += 1;
  setTimeout(() => {
    el.remove();
    liveNumbers = Math.max(0, liveNumbers - 1);
  }, HIT_NUMBER_SECONDS * 1000);
}
