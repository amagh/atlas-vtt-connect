/**
 * The light of a lit scene as players get it (`PlayerGlow`): a small picture over the map, worked out on the GM's
 * side from the light Atlas hands out (`FrameLight`) and the colours of the scene's lights and carried lights.
 *
 * Only cells a token's sight shows now, and those beside them, get light: so light ends where its reach does (cut by the
 * walls), not at a cell's edge. A cell only the explored memory shows is dimmed, and one further from sight takes the
 * scene's ambient light alone, as if no light reached it (the darkness fog covers it; under the fog's soft edge it
 * shades on smoothly rather than in cell-sized steps). So the picture carries nothing of what players do not see: no
 * light, colour or wall beyond the cells around their sight. Where a cell is seen, the darker its light the more black is laid
 * over it (a token seeing in the dark still sees, dimly), and the lights reaching it tint it with their colours.
 */
import { insideSpans } from '../../../../packages/atlas-host/src/lighting/darknessRaster';
import type { LightReach, Polygon } from '../../../../packages/atlas-host/src/lighting/visionRules';
import type { FrameLight } from './lightingFrame';
import { SCENE_LIMITS } from './sceneLimits';
import type { MapSize, PlayerGlow } from './sceneTypes';

/**
 * The picture's long side holds at most this many pixels, fewer where the PNG would not fit `SCENE_LIMITS.glowImage`;
 * players' canvases smooth it when they stretch it.
 */
export const OVERLAY_CELLS_PER_SIDE = [192, 128, 64] as const;
/** How much black lies over a seen cell no light reaches: what a token seeing in the dark still makes out. */
export const DARK_SHADE = 0.78;
/** How much black lies over a cell only the explored memory shows. */
export const MEMORY_SHADE = 0.6;
/** How strongly a light's colour tints what it lights, at most. */
export const LIGHT_TINT = 0.32;

/** A light's colour (0–255 each) and strength, where the scene has a light or a carried light. */
export interface LightSource {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

/** Straight RGBA, row by row. */
export interface OverlayPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type Encoder = (pixels: OverlayPixels) => string | null;

const WHITE: Omit<LightSource, 'x' | 'y'> = { r: 255, g: 255, b: 255, intensity: 1 };
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const items = (value: unknown): Array<Record<string, unknown>> => (isObj(value) ? Object.values(value).filter(isObj) : []);

function rgbOf(color: unknown): { r: number; g: number; b: number } | null {
  if (typeof color !== 'string' || !HEX.test(color)) return null;
  const hex = color.length === 4 ? [...color.slice(1)].map((digit) => digit + digit).join('') : color.slice(1);
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

/** The scene's lights and the lights its tokens carry, where they stand, with their colours. */
export function lightSources(objects: { lights?: unknown; tokens?: unknown } | undefined): LightSource[] {
  const sources: LightSource[] = [];
  const add = (raw: Record<string, unknown>, emission: unknown): void => {
    if (!isObj(emission) || typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return;
    const rgb = rgbOf(emission.color) ?? WHITE;
    sources.push({ x: raw.x, y: raw.y, ...rgb, intensity: Math.min(1, Math.max(0, num(emission.intensity, 1))) });
  };
  for (const raw of items(objects?.lights)) if (raw.hidden !== true) add(raw, raw.emission);
  for (const raw of items(objects?.tokens)) if (raw.offMap !== true) add(raw, raw.light);
  return sources;
}

/** The source nearest a reach's origin, within `reach` world pixels; white at full strength without one. */
function sourceOf(reach: LightReach, sources: readonly LightSource[], within: number): Omit<LightSource, 'x' | 'y'> {
  let best: LightSource | null = null;
  let bestDistance = within;
  for (const source of sources) {
    const distance = Math.hypot(source.x - reach.origin.x, source.y - reach.origin.y);
    if (distance <= bestDistance) {
      best = source;
      bestDistance = distance;
    }
  }
  return best ?? WHITE;
}

/** How much a light gives at `distance`: full in its bright light, fading out through its dim light. */
export function falloff(distance: number, bright: number, dim: number): number {
  if (distance <= bright) return 1 - 0.2 * (bright > 0 ? distance / bright : 0);
  if (distance > dim || dim <= bright) return 0;
  const t = (distance - bright) / (dim - bright);
  return 0.55 * (1 - t * t);
}

interface Grid {
  cols: number;
  rows: number;
  size: number;
}

/** Calls `visit` for every pixel whose centre lies inside `polygon`, with the pixel's centre. */
function forInside({ cols, rows, size }: Grid, polygon: Polygon, visit: (index: number, x: number, y: number) => void): void {
  if (polygon.length < 3) return;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of polygon) {
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  const lastRow = Math.min(rows - 1, Math.floor(bottom / size));
  for (let row = Math.max(0, Math.floor(top / size)); row <= lastRow; row++) {
    const y = (row + 0.5) * size;
    for (const [from, to] of insideSpans(polygon, y)) {
      const last = Math.min(cols - 1, Math.floor(to / size - 0.5));
      for (let col = Math.max(0, Math.ceil(from / size - 0.5)); col <= last; col++) visit(row * cols + col, (col + 0.5) * size, y);
    }
  }
}

/**
 * The overlay's pixels over `map`: black where the window shows nothing, dimmed where only the memory shows, and where a
 * token sees, black by how little light falls there and tinted by the lights' colours. `within`: how far from a reach's
 * origin its light may stand to lend it its colour.
 */
export function overlayPixels(light: FrameLight, sources: readonly LightSource[], map: MapSize, within: number, cellsPerSide: number = OVERLAY_CELLS_PER_SIDE[0]): OverlayPixels | null {
  if (!(map.width > 0) || !(map.height > 0) || !(light.cellSize > 0)) return null;
  const size = Math.max(1, Math.ceil(Math.max(map.width, map.height) / cellsPerSide));
  const grid: Grid = { cols: Math.max(1, Math.ceil(map.width / size)), rows: Math.max(1, Math.ceil(map.height / size)), size };
  const count = grid.cols * grid.rows;
  const ambient = new Float32Array(count).fill(Math.min(1, Math.max(0, light.ambient.ambient)));
  for (const zone of light.ambient.zones ?? []) {
    const value = Math.min(1, Math.max(0, zone.ambient));
    forInside(grid, zone.polygon, (index) => { ambient[index] = value; });
  }
  // What the lights leave dark (their product of 1 − light), their sum, and their colours weighted by it.
  const unlit = new Float32Array(count).fill(1);
  const sum = new Float32Array(count);
  const red = new Float32Array(count);
  const green = new Float32Array(count);
  const blue = new Float32Array(count);
  const magicalDark = new Uint8Array(count);
  for (const reach of light.reaches) {
    if (reach.darkness) {
      forInside(grid, reach.polygon, (index, x, y) => {
        if (Math.hypot(x - reach.origin.x, y - reach.origin.y) <= reach.dim) magicalDark[index] = 1;
      });
      continue;
    }
    const source = sourceOf(reach, sources, within);
    forInside(grid, reach.polygon, (index, x, y) => {
      const given = falloff(Math.hypot(x - reach.origin.x, y - reach.origin.y), reach.bright, reach.dim) * source.intensity;
      if (given <= 0) return;
      unlit[index]! *= 1 - Math.min(1, given);
      sum[index]! += given;
      red[index]! += given * source.r;
      green[index]! += given * source.g;
      blue[index]! += given * source.b;
    });
  }
  const nearSight = besideSeen(light);
  // What a cell away from sight shows: the scene's ambient light alone, whatever lights stand there.
  const away = Math.round(DARK_SHADE * (1 - Math.min(1, Math.max(0, light.ambient.ambient))) * 255);
  const data = new Uint8ClampedArray(count * 4);
  for (let row = 0; row < grid.rows; row++) {
    const cellRow = Math.floor(((row + 0.5) * size) / light.cellSize);
    for (let col = 0; col < grid.cols; col++) {
      const index = row * grid.cols + col;
      const cellCol = Math.floor(((col + 0.5) * size) / light.cellSize);
      const cell = cellRow < light.rows && cellCol < light.cols ? cellRow * light.cols + cellCol : -1;
      const out = index * 4;
      if (cell < 0 || nearSight[cell] !== 1) {
        data[out + 3] = light.shown[cell] === 1 ? Math.round(MEMORY_SHADE * 255) : away;
        continue;
      }
      const base = ambient[index]!;
      const lit = magicalDark[index] ? 0 : 1 - (1 - base) * unlit[index]!;
      const shade = DARK_SHADE * (1 - lit);
      const given = sum[index]!;
      const tint = magicalDark[index] || given <= 0 ? 0 : LIGHT_TINT * Math.min(1, given) * (1 - base);
      const alpha = shade + tint * (1 - shade);
      if (alpha <= 0) continue;
      const share = (tint * (1 - shade)) / alpha;
      data[out] = given > 0 ? (red[index]! / given) * share : 0;
      data[out + 1] = given > 0 ? (green[index]! / given) * share : 0;
      data[out + 2] = given > 0 ? (blue[index]! / given) * share : 0;
      data[out + 3] = Math.round(alpha * 255);
    }
  }
  return { width: grid.cols, height: grid.rows, data };
}

/** What `encodePng` uses of a document: a canvas, never put on the page. */
export interface CanvasDocument {
  createElement(tag: 'canvas'): HTMLCanvasElement;
}

/** The cells a token's sight shows now, and every cell beside one of them (diagonals too). */
function besideSeen({ cols, rows, seen }: FrameLight): Uint8Array {
  const near = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (seen[row * cols + col] !== 1) continue;
      for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(cols - 1, col + 1); c++) near[r * cols + c] = 1;
      }
    }
  }
  return near;
}

/** The pixels as a PNG data URL through a canvas; null where none can be made (no DOM, no 2D context). */
export function encodePng(pixels: OverlayPixels, doc: CanvasDocument | undefined = typeof window === 'undefined' ? undefined : window.document): string | null {
  if (!doc) return null;
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/png');
    return url.startsWith('data:image/png;base64,') ? url : null;
  } catch {
    return null;
  }
}

/** The overlay last made for each light, and the sources it was coloured by. */
const made = new WeakMap<FrameLight, { sources: string; width: number; height: number; lighting: PlayerGlow | null }>();

/**
 * The players' light picture for `light` over `map`, coloured by the scene's `objects`; the same object while neither
 * changes, so the scene's diff sends it again only when it does. Null where no picture can be made.
 */
export function lightOverlay(light: FrameLight, objects: { lights?: unknown; tokens?: unknown } | undefined, map: MapSize, within: number, encode: Encoder = encodePng): PlayerGlow | null {
  const sources = lightSources(objects);
  const key = JSON.stringify(sources);
  const last = made.get(light);
  if (last && last.sources === key && last.width === map.width && last.height === map.height) return last.lighting;
  let image: string | null = null;
  for (const cells of OVERLAY_CELLS_PER_SIDE) {
    const pixels = overlayPixels(light, sources, map, within, cells);
    const encoded = pixels ? encode(pixels) : null;
    if (!encoded) break;
    if (encoded.length <= SCENE_LIMITS.glowImage) {
      image = encoded;
      break;
    }
  }
  const lighting = image ? Object.freeze({ image }) : null;
  made.set(light, { sources: key, width: map.width, height: map.height, lighting });
  return lighting;
}
