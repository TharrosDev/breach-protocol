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
  if (changed(el, `style:${prop}`, value)) el.style.setProperty(prop, value);
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
// source minus the player's yaw, as legacy computes it. The marker points at the source and removes itself.
export function addDamageIndicator(root: HTMLElement, relativeAngle: number): void {
  const el = root.ownerDocument.createElement('div');
  el.className = 'hud-ind';
  el.style.setProperty('transform', `rotate(${(-relativeAngle).toFixed(3)}rad)`);
  root.append(el);
  setTimeout(() => {
    el.remove();
  }, DAMAGE_INDICATOR_SECONDS * 1000);
}

// Floating damage number at a screen point (legacy hitNumber, index.html:2820-2831). x and y are CSS pixels of the
// root; the caller projects the hit point. Headshots use the kill colour and a larger size.
export function addHitNumber(root: HTMLElement, x: number, y: number, value: number, head: boolean): void {
  const el = root.ownerDocument.createElement('div');
  el.className = head ? 'hud-dn head' : 'hud-dn';
  el.textContent = String(Math.round(value));
  el.style.setProperty('left', `${x.toFixed(0)}px`);
  el.style.setProperty('top', `${y.toFixed(0)}px`);
  root.append(el);
  setTimeout(() => {
    el.remove();
  }, HIT_NUMBER_SECONDS * 1000);
}
