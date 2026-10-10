// Top-right minimap. The walls are pre-rendered once into an offscreen canvas (legacy mmBase, index.html:2810-2819),
// then each frame draws the base and the markers. Legacy: index.html:2813-2846.
import type { HudView, TokenName } from '../contracts';
import { ZONE_TOKEN } from './layout';

// Legacy canvas is 180 px and maps world -60..60 onto it (mmX, index.html:2813).
export const MINIMAP_PX = 180;
const WORLD_HALF = 60;
const TAU = Math.PI * 2;
const ZONE_RADIUS = 6;
const DOT_RADIUS = 3;
const DOWNED_RADIUS = 4;
const WALL_ALPHA = 0.45;
const MINIMAP_INTERVAL_MS = 50;

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

// The parts of a map the minimap draws. MapDef satisfies this structurally.
export interface MinimapBox {
  readonly min: Point2;
  readonly max: Point2;
}
export interface MinimapMap {
  readonly zones: readonly Point2[];
  readonly boxes: readonly MinimapBox[];
}

// Positions drawn from outside the view: zone centres (in the order of view.zones) and alive operators.
export interface MinimapMarks {
  readonly zones: readonly Point2[];
  readonly operators: readonly Point2[];
}

const NO_MARKS: MinimapMarks = { zones: [], operators: [] };

// Legacy mmX, applied to both axes.
export function worldToMap(v: number): number {
  return ((v + WORLD_HALF) / (WORLD_HALF * 2)) * MINIMAP_PX;
}

function tokenColour(style: CSSStyleDeclaration, name: TokenName): string {
  return style.getPropertyValue(`--tok-${name}`).trim();
}

// Token colours by name, read from the computed style once per colour mode instead of once per frame. Every read is a
// style lookup, and the minimap used about fifteen per frame.
export type Palette = Partial<Record<TokenName, string>>;

const PALETTE_TOKENS: readonly TokenName[] = [
  'mute',
  'panel',
  'friendly',
  'hostile',
  'ink',
  'health-low',
  'objective-idle',
  'objective-capturing',
  'objective-contested',
  'objective-captured',
];

export function readPalette(style: CSSStyleDeclaration): Palette {
  const out: Palette = {};
  for (const name of PALETTE_TOKENS) out[name] = tokenColour(style, name);
  return out;
}

// One view-cone gradient per canvas context. Gradients are positioned in the transformed space at fill time, so the
// same object serves every frame.
const cones = new WeakMap<CanvasRenderingContext2D, CanvasGradient>();
function coneGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  let g = cones.get(ctx);
  if (g === undefined) {
    g = ctx.createRadialGradient(0, 0, 4, 0, 0, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cones.set(ctx, g);
  }
  return g;
}

// Draws one frame: the base map, zones, operators, spotted hostiles, then the player. Colours come from the tokens
// on the canvas element, so the colour-blind palette applies here too.
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  view: HudView,
  base: HTMLCanvasElement,
  marks: MinimapMarks = NO_MARKS,
  palette: Palette | null = null,
): void {
  const live = palette ?? readPalette(getComputedStyle(ctx.canvas));
  const colourOf = (name: TokenName): string => live[name] ?? '';
  ctx.clearRect(0, 0, MINIMAP_PX, MINIMAP_PX);
  ctx.drawImage(base, 0, 0);

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);

  // Range rings centred on the player, every 20 m.
  const ppx = worldToMap(view.playerX);
  const ppy = worldToMap(view.playerZ);
  ctx.strokeStyle = colourOf('mute');
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 1;
  for (const r of [20, 40]) {
    ctx.beginPath();
    ctx.arc(ppx, ppy, r * (MINIMAP_PX / (WORLD_HALF * 2)), 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // View cone: the area the player faces. Same rotation as the player arrow below.
  if (view.alive) {
    ctx.save();
    ctx.translate(ppx, ppy);
    ctx.rotate(Math.PI / 2 - view.compassYaw);
    ctx.fillStyle = coneGradient(ctx);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 62, -0.6, 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  marks.zones.forEach((p, i) => {
    const status = view.zones[i]?.status;
    if (status === undefined) return;
    const zx = worldToMap(p.x);
    const zy = worldToMap(p.z);
    const colour = colourOf(ZONE_TOKEN[status]);
    // A ring around the zone, pulsing while it is contested or being captured.
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.globalAlpha = status === 'contested' || status === 'capturing' ? 0.35 + pulse * 0.6 : 0.45;
    ctx.beginPath();
    ctx.arc(zx, zy, ZONE_RADIUS + 3 + (status === 'contested' ? pulse * 3 : 0), 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(zx, zy, ZONE_RADIUS, 0, TAU);
    ctx.fill();
  });

  ctx.fillStyle = colourOf('friendly');
  ctx.strokeStyle = colourOf('panel');
  ctx.lineWidth = 1.5;
  for (const p of marks.operators) {
    ctx.beginPath();
    ctx.arc(worldToMap(p.x), worldToMap(p.z), DOT_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.fill();
  }

  ctx.fillStyle = colourOf('hostile');
  ctx.strokeStyle = colourOf('hostile');
  for (const s of view.spotted) {
    const sx = worldToMap(s.x);
    const sy = worldToMap(s.z);
    ctx.globalAlpha = 0.25 + pulse * 0.4;
    ctx.beginPath();
    ctx.arc(sx, sy, DOT_RADIUS + 2 + pulse * 2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, DOT_RADIUS, 0, TAU);
    ctx.fill();
  }

  const px = worldToMap(view.playerX);
  const py = worldToMap(view.playerZ);
  if (view.alive) {
    // Legacy: rotate by PI/2 - yaw, then a triangle pointing along +x.
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 2 - view.compassYaw);
    ctx.fillStyle = colourOf('ink');
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 4.5);
    ctx.lineTo(-5, -4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (view.downed) {
    ctx.fillStyle = colourOf('health-low');
    ctx.beginPath();
    ctx.arc(px, py, DOWNED_RADIUS, 0, TAU);
    ctx.fill();
  }
}

export interface Minimap {
  draw(view: HudView, operators: readonly Point2[]): void;
  // Re-renders the base map on the next draw, for example after the colour mode changes.
  invalidate(): void;
}

export function createMinimap(canvas: HTMLCanvasElement, mapDef?: MinimapMap): Minimap {
  const base = canvas.ownerDocument.createElement('canvas');
  base.width = MINIMAP_PX;
  base.height = MINIMAP_PX;
  const zones: readonly Point2[] = mapDef?.zones ?? [];
  const boxes: readonly MinimapBox[] = mapDef?.boxes ?? [];
  let built = false;
  let palette: Palette | null = null;
  let lastDraw = -Infinity;

  // Tokens are read from the canvas, so this must run once the canvas is in the document. The first draw does that.
  function buildBase(): void {
    const g = base.getContext('2d');
    if (g === null) return;
    const style = getComputedStyle(canvas);
    g.fillStyle = tokenColour(style, 'panel');
    g.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);
    g.fillStyle = tokenColour(style, 'mute');
    g.globalAlpha = WALL_ALPHA;
    const scale = MINIMAP_PX / (WORLD_HALF * 2);
    for (const b of boxes) {
      g.fillRect(
        worldToMap(b.min.x),
        worldToMap(b.min.z),
        (b.max.x - b.min.x) * scale,
        (b.max.z - b.min.z) * scale,
      );
    }
    g.globalAlpha = 1;
    built = true;
  }

  return {
    draw(view, operators) {
      // The minimap redraws at 20 Hz at most: its content (positions at 1 m per 3 px) does not need more, and the
      // canvas is a full 2D redraw plus an upload each time.
      const now = performance.now();
      if (now - lastDraw < MINIMAP_INTERVAL_MS) return;
      lastDraw = now;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      if (!built) {
        buildBase();
        palette = readPalette(getComputedStyle(canvas));
      }
      drawMinimap(ctx, view, base, { zones, operators }, palette);
    },
    invalidate() {
      built = false;
      palette = null;
      lastDraw = -Infinity;
    },
  };
}
