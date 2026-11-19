import { describe, expect, it } from 'vitest';
import { DARKNESS_FOG_ID, DARKNESS_ORDER } from '../../../src/app/online/scene/darknessFog';
import { FogLayer } from '../../../src/app/online/view/layers/fogLayer';
import { SOFT_MASK_PIXELS, softDarkness } from '../../../src/app/online/view/layers/softDarkness';
import { frame, RecordingSurface } from './recordingSurface';
import { fogRect, playerScene } from './sceneFixtures';

/** The right half of a 512 × 256 map is dark: the edge runs down x = 256, one mask pixel to a world pixel. */
const MAP = { width: SOFT_MASK_PIXELS, height: 256 };
const RIGHT_HALF = [{ x: 256, y: 0 }, { x: 512, y: 0 }, { x: 512, y: 256 }, { x: 256, y: 256 }];
const alphaAt = (image: { data: Uint8ClampedArray; width: number }, x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3]!;

describe('the soft darkness', () => {
  it('leaves what players see clear up to the edge, and grows dark only past it', () => {
    const soft = softDarkness(RIGHT_HALF, MAP, 24)!;
    expect(soft.width).toBe(512);
    const row = 128;
    // Every pixel on the seen side, the last before the edge too, is untouched.
    for (let x = 0; x < 256; x++) expect(alphaAt(soft.image, x, row)).toBe(0);
    expect(alphaAt(soft.image, 260, row)).toBeGreaterThan(0);
    expect(alphaAt(soft.image, 260, row)).toBeLessThan(255);
    expect(alphaAt(soft.image, 300, row)).toBe(255);
    // Rising all the way across the ramp.
    for (let x = 256; x < 300; x++) expect(alphaAt(soft.image, x + 1, row)).toBeGreaterThanOrEqual(alphaAt(soft.image, x, row));
  });

  it('keeps the map\'s own edge as dark as what lies along it', () => {
    const soft = softDarkness(RIGHT_HALF, MAP, 24)!;
    expect(alphaAt(soft.image, 511, 0)).toBe(255);
    expect(alphaAt(soft.image, 511, 255)).toBe(255);
  });

  it('is drawn by the fog layer in place of the darkness\'s staircase, over the GM\'s own fog', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({
      map: { asset: null, width: MAP.width, height: MAP.height, cellSize: 48 },
      fog: { f1: fogRect(1), [DARKNESS_FOG_ID]: { type: 'lasso', erase: false, order: DARKNESS_ORDER, points: RIGHT_HALF } },
    });
    new FogLayer().draw(surface, frame(scene));
    const painted = surface.layers.flatMap((layer) => layer.calls).filter((call) => call.op !== 'begin' && call.op !== 'camera');
    expect(painted.map((call) => call.op)).toEqual(['rect', 'raster']);
    expect(painted[1]).toMatchObject({ op: 'raster', x: 0, y: 0, width: 512, height: 256 });
    expect(softDarkness([], MAP, 24)).toBeNull();
  });
});
