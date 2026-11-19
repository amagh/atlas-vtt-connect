/**
 * A lit scene's darkness (its fog lasso, `DARKNESS_FOG_ID`) with soft edges. The lasso follows the GM's darkness cells,
 * so its edge is a staircase; here it is drawn as a small mask over the map, blurred well past one stair (`stairOf`),
 * so its edge runs smooth along a wall at any angle, and stretched by the canvas.
 *
 * The darkness starts only where the blurred mask is past `CLEAR_UP_TO`: further in than a seen cell's corner reaches,
 * where three of the four cells around it are dark. What players see is not dimmed; along a slope the smooth edge cuts
 * across the stairs' dark corners, so slivers of the dark side show through, faintly. That is only the map image players
 * already have: tokens and the rest are sent only where they see. Pure, so tests read its pixels. Shared with the web
 * page.
 */
import { insideSpans } from '../../../../../packages/atlas-host/src/lighting/darknessRaster';
import type { MapSize, ScenePoint } from '../../scene/sceneTypes';
import type { RasterImage } from '../ViewSurface';

/** The mask's long side, in pixels: well finer than the darkness cells (384 a side at most), cheap to blur. */
export const SOFT_MASK_PIXELS = 512;
/** Box blur passes: three come close to a Gaussian, of a spread about one pass's radius. */
const PASSES = 3;
/** The blur's spread, in stairs: enough that its edge no longer steps. */
export const BLUR_STAIRS = 1.25;
/** The blurred mask's value up to which nothing is dark: a seen cell's corner with three dark cells around it reads ¾. */
export const CLEAR_UP_TO = 0.75;

/** The soft darkness: its pixels, and the world area from the map's top-left corner they stretch over. */
export interface SoftDarkness {
  image: RasterImage;
  width: number;
  height: number;
}

/**
 * The darkness's stair, in world pixels: its shortest side between two corners off the map's edge (the outline runs
 * along cell edges, and a cell clipped by the map's edge is shorter). Null for an outline without one.
 */
export function stairOf(points: readonly ScenePoint[], map: MapSize): number | null {
  const onEdge = (point: ScenePoint): boolean => point.x <= 0 || point.y <= 0 || point.x >= map.width || point.y >= map.height;
  let shortest = Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    if (onEdge(a) || onEdge(b)) continue;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length > 0 && (a.x === b.x || a.y === b.y)) shortest = Math.min(shortest, length);
  }
  return Number.isFinite(shortest) ? shortest : null;
}

/** The darkness over `map` as straight RGBA, black with the soft alpha; null without a map size or an outline. */
export function softDarkness(points: readonly ScenePoint[], map: MapSize): SoftDarkness | null {
  if (!(map.width > 0) || !(map.height > 0) || points.length < 3) return null;
  const pixel = Math.max(map.width, map.height) / SOFT_MASK_PIXELS;
  const width = Math.max(1, Math.ceil(map.width / pixel));
  const height = Math.max(1, Math.ceil(map.height / pixel));
  const mask = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) * pixel;
    for (const [from, to] of insideSpans(points, y)) {
      const last = Math.min(width - 1, Math.floor(to / pixel - 0.5));
      for (let col = Math.max(0, Math.ceil(from / pixel - 0.5)); col <= last; col++) mask[row * width + col] = 1;
    }
  }
  // A darkness without stairs (one rectangle) is still eased: as if its stair were two mask pixels.
  const stair = stairOf(points, map) ?? 2 * pixel;
  const radius = Math.max(1, Math.round((BLUR_STAIRS * stair) / pixel));
  const scratch = new Float32Array(Math.max(width, height));
  for (let pass = 0; pass < PASSES; pass++) {
    for (let row = 0; row < height; row++) boxBlur(mask, row * width, 1, width, radius, scratch);
    for (let col = 0; col < width; col++) boxBlur(mask, col, width, height, radius, scratch);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < mask.length; index++) {
    const t = Math.min(1, Math.max(0, (mask[index]! - CLEAR_UP_TO) / (1 - CLEAR_UP_TO)));
    data[index * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return { image: { data, width, height }, width: width * pixel, height: height * pixel };
}

/**
 * One box blur of `count` values from `start`, `step` apart, in place: each the mean of those within `radius`, with the
 * line's ends held past its edges (so the map's edge stays as dark as what lies along it).
 */
function boxBlur(values: Float32Array, start: number, step: number, count: number, radius: number, scratch: Float32Array): void {
  const at = (index: number): number => values[start + Math.min(count - 1, Math.max(0, index)) * step]!;
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) sum += at(offset);
  const size = 2 * radius + 1;
  for (let index = 0; index < count; index++) {
    scratch[index] = sum / size;
    sum += at(index + radius + 1) - at(index - radius);
  }
  for (let index = 0; index < count; index++) values[start + index * step] = scratch[index]!;
}
