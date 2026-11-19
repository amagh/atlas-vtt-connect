import { describe, expect, it } from 'vitest';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { DARKNESS_FOG_ID, DARKNESS_ORDER } from '../../../src/app/online/scene/darknessFog';
import { FogLayer } from '../../../src/app/online/view/layers/fogLayer';
import { SOFT_MASK_PIXELS, softDarkness, stairOf } from '../../../src/app/online/view/layers/softDarkness';
import { frame, RecordingSurface } from './recordingSurface';
import { fogRect, playerScene } from './sceneFixtures';

/** One mask pixel to a world pixel. */
const MAP = { width: SOFT_MASK_PIXELS, height: 512 };
const alphaAt = (image: { data: Uint8ClampedArray; width: number }, x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3]!;

/** Dark above a staircase of `stair`-pixel steps, running from the top-left down to the right: x + y < 512, rounded to stairs. */
function staircase(stair: number): ScenePoint[] {
  const points: ScenePoint[] = [{ x: 0, y: 0 }, { x: 512, y: 0 }];
  for (let x = 512; x > 0; x -= stair) points.push({ x, y: 512 - x }, { x: x - stair, y: 512 - x });
  return points;
}

describe('the soft darkness', () => {
  it('reads its stair from the outline, not from the map\'s edge', () => {
    expect(stairOf(staircase(16), MAP)).toBe(16);
    expect(stairOf([{ x: 0, y: 0 }, { x: 512, y: 0 }, { x: 512, y: 512 }], MAP)).toBeNull();
  });

  it('runs smooth along a slope the darkness cells make into stairs', () => {
    const soft = softDarkness(staircase(16), MAP)!;
    // Where the darkness starts, row by row: on a smooth edge it moves the same way each row, never a stair at a time.
    const starts: number[] = [];
    for (let y = 100; y < 400; y++) {
      let x = 511;
      while (x > 0 && alphaAt(soft.image, x - 1, y) > 0) x--;
      starts.push(x);
    }
    const steps = starts.slice(1).map((x, index) => x - starts[index]!);
    expect(Math.max(...steps.map((step) => Math.abs(step)))).toBeLessThanOrEqual(3);
  });

  it('leaves every seen pixel clear, and is full dark well inside', () => {
    const soft = softDarkness(staircase(16), MAP)!;
    // A pixel is dark where it lies above its column of stairs' tread: y < 512 − (the column's right edge).
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) if (y >= 512 - (Math.floor(x / 16) + 1) * 16) expect(alphaAt(soft.image, x, y)).toBe(0);
    }
    expect(alphaAt(soft.image, 100, 100)).toBe(255);
  });

  it('keeps the map\'s own edge as dark as what lies along it', () => {
    const soft = softDarkness(staircase(16), MAP)!;
    expect(alphaAt(soft.image, 0, 0)).toBe(255);
    expect(alphaAt(soft.image, 300, 0)).toBe(255);
  });

  it('is drawn by the fog layer in place of the darkness\'s staircase, over the GM\'s own fog', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({
      map: { asset: null, width: MAP.width, height: MAP.height, cellSize: 48 },
      fog: { f1: fogRect(1), [DARKNESS_FOG_ID]: { type: 'lasso', erase: false, order: DARKNESS_ORDER, points: staircase(16) } },
    });
    new FogLayer().draw(surface, frame(scene));
    const painted = surface.layers.flatMap((layer) => layer.calls).filter((call) => call.op !== 'begin' && call.op !== 'camera');
    expect(painted.map((call) => call.op)).toEqual(['rect', 'raster']);
    expect(painted[1]).toMatchObject({ op: 'raster', x: 0, y: 0, width: 512, height: 512 });
    expect(softDarkness([], MAP)).toBeNull();
  });
});
