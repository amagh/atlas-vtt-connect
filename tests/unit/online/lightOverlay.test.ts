import { describe, expect, it, vi } from 'vitest';
import { darknessRaster } from '../../../packages/atlas-host/src/lighting/darknessRaster';
import type { LightReach } from '../../../packages/atlas-host/src/lighting/visionRules';
import { LiveLighting } from '../../../src/app/online/scene/LiveLighting';
import type { FrameLight } from '../../../src/app/online/scene/lightingFrame';
import { DARK_SHADE, darkPixels, falloff, LIGHT_TINT, lightOverlay, lightSources, MEMORY_SHADE, overlayPixels, type OverlayPixels } from '../../../src/app/online/scene/lightOverlay';
import { diffScenes } from '../../../src/app/online/scene/sceneDiff';
import { decodeControl } from '../../../src/app/online/protocol';
import { createGlowLayer } from '../../../src/app/online/view/layers/glowLayer';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, sceneBody } from './sceneFixtures';
import { PlayerSceneMirror } from '../../../src/app/online/scene/PlayerSceneMirror';
import { ready, testLighting } from './lightingFixtures';

const MAP = { width: 192, height: 96 };
const decodeRaw = (value: unknown): ReturnType<typeof decodeControl> => decodeControl(JSON.stringify(value));
const square = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const torch = (x: number, y: number, polygon = square(0, 0, 192, 96)): LightReach => ({ origin: { x, y }, bright: 20, dim: 40, polygon });

/** One darkness cell per 8 map pixels: every cell shown and seen unless `seen`/`shown` say otherwise. */
function light(reaches: LightReach[], options: { ambient?: number; seen?: (x: number) => boolean; shown?: (x: number) => boolean } = {}): FrameLight {
  const cellSize = 8;
  const cols = MAP.width / cellSize;
  const rows = MAP.height / cellSize;
  const flags = (test: ((x: number) => boolean) | undefined) => {
    const cells = new Uint8Array(cols * rows);
    for (let index = 0; index < cells.length; index++) cells[index] = !test || test(((index % cols) + 0.5) * cellSize) ? 1 : 0;
    return cells;
  };
  return { cols, rows, cellSize, seen: flags(options.seen), shown: flags(options.shown), ambient: { ambient: options.ambient ?? 0 }, reaches };
}

/** The pixel at map point (x, y): the overlay has one pixel per map pixel on this small map. */
function at(pixels: OverlayPixels, x: number, y: number): [number, number, number, number] {
  const index = (Math.floor(y) * pixels.width + Math.floor(x)) * 4;
  return [pixels.data[index]!, pixels.data[index + 1]!, pixels.data[index + 2]!, pixels.data[index + 3]!];
}

describe('the light overlay', () => {
  it('lays black over what no light reaches, less where a light does, none at its middle in daylight', () => {
    const pixels = overlayPixels(light([torch(40, 48)]), [], MAP, 10)!;
    expect(pixels.width).toBe(192);
    expect(at(pixels, 150, 48)[3]).toBe(Math.round(DARK_SHADE * 255));
    expect(at(pixels, 40, 48)[3]).toBeLessThan(at(pixels, 70, 48)[3]);
    expect(at(pixels, 70, 48)[3]).toBeLessThan(at(pixels, 150, 48)[3]);
    expect(at(overlayPixels(light([], { ambient: 1 }), [], MAP, 10)!, 150, 48)[3]).toBe(0);
  });

  it('tints what a light reaches with its colour, matched by where the light stands', () => {
    const sources = lightSources({ lights: { l1: { id: 'l1', x: 41, y: 48, emission: { color: '#ff0000', intensity: 1 } } } });
    const [red, green, blue, alpha] = at(overlayPixels(light([torch(40, 48)]), sources, MAP, 10)!, 40, 48);
    expect(alpha).toBeGreaterThan(0);
    expect(red).toBeGreaterThan(200);
    expect(green).toBe(0);
    expect(blue).toBe(0);
    // Too far from the light to take its colour: white.
    const [r, g, b] = at(overlayPixels(light([torch(40, 48)]), sources, MAP, 0.5)!, 40, 48);
    expect(r).toBeGreaterThan(240);
    expect(new Set([r, g, b]).size).toBe(1);
  });

  it('stops at the walls the reach is cut by', () => {
    const pixels = overlayPixels(light([torch(40, 48, square(0, 0, 50, 96))]), [], MAP, 10)!;
    expect(at(pixels, 55, 48)[3]).toBe(Math.round(DARK_SHADE * 255));
    expect(at(pixels, 45, 48)[3]).toBeLessThan(Math.round(DARK_SHADE * 255));
  });

  it('carries nothing of what players do not see: ambient dark where hidden, dimmed where only remembered', () => {
    const sources = lightSources({ lights: { l1: { x: 150, y: 48, emission: { color: '#00ff00' } } } });
    const pixels = overlayPixels(light([torch(150, 48)], { seen: (x) => x < 96, shown: (x) => x < 128 }), sources, MAP, 10)!;
    expect(at(pixels, 150, 48)).toEqual([0, 0, 0, Math.round(DARK_SHADE * 255)]);
    expect(at(pixels, 110, 48)).toEqual([0, 0, 0, Math.round(MEMORY_SHADE * 255)]);
    const empty = overlayPixels(light([], { seen: (x) => x < 96, shown: (x) => x < 128 }), [], MAP, 10)!;
    // The light beyond their sight changes no pixel they get.
    expect(pixels.data).toEqual(empty.data);
  });

  it('lights the cells beside sight too, so light ends where its reach does rather than at a cell\'s edge', () => {
    const near = overlayPixels(light([torch(90, 48)], { seen: (x) => x < 96, shown: (x) => x < 96 }), [], MAP, 10)!;
    // One cell past sight (x 96–104) the torch still lights; two cells past, only the ambient dark.
    expect(at(near, 100, 48)[3]).toBeLessThan(Math.round(DARK_SHADE * 255));
    expect(at(near, 108, 48)[3]).toBe(Math.round(DARK_SHADE * 255));
  });

  it('leaves magical darkness unlit, whatever light falls in it', () => {
    const darkness: LightReach = { ...torch(40, 48), darkness: true };
    const pixels = overlayPixels(light([torch(40, 48), darkness], { ambient: 0.5 }), [], MAP, 10)!;
    expect(at(pixels, 40, 48)).toEqual([0, 0, 0, Math.round(DARK_SHADE * 255)]);
  });

  it('falls off from full light through dim light to none', () => {
    expect(falloff(0, 20, 40)).toBe(1);
    expect(falloff(30, 20, 40)).toBeGreaterThan(0);
    expect(falloff(30, 20, 40)).toBeLessThan(falloff(20, 20, 40));
    expect(falloff(41, 20, 40)).toBe(0);
    expect(LIGHT_TINT).toBeLessThan(1);
  });

  it('is made once per light and colours, and again only when they change', () => {
    const encode = vi.fn((pixels: OverlayPixels) => `data:image/png;base64,${pixels.width}AA`);
    const frameLight = light([torch(40, 48)]);
    const objects = { lights: { l1: { x: 40, y: 48, emission: { color: '#ff0000' } } } };
    const first = lightOverlay(frameLight, objects, MAP, 10, encode);
    expect(lightOverlay(frameLight, objects, MAP, 10, encode)).toBe(first);
    // The light picture and the finer darkness, once each.
    expect(encode).toHaveBeenCalledTimes(2);
    lightOverlay(frameLight, { lights: { l1: { x: 40, y: 48, emission: { color: '#0000ff' } } } }, MAP, 10, encode);
    expect(encode).toHaveBeenCalledTimes(4);
    expect(lightOverlay(frameLight, objects, MAP, 10, () => null)).toBeNull();
  });
});

describe('the light Atlas hands out', () => {
  it('marks the cells a token sees apart from those only the memory shows', () => {
    const sight = { all: false, regions: [{ sense: { sees: { bright: 'normal', dim: 'normal', dark: 'none', magicalDark: 'none' }, reveals: 'all', lineOfSight: true, precise: true }, origin: { x: 20, y: 20 }, radius: 1000, polygon: square(0, 0, 64, 64) }] } as never;
    const coverage = new Uint8Array(4).fill(255);
    const raster = darknessRaster({ sight, ambient: { ambient: 1 }, reaches: [] }, { width: 128, height: 64 }, 384, { width: 2, height: 2, coverage });
    expect(raster.dark.every((cell) => cell === 0)).toBe(true);
    expect(raster.seen[0]).toBe(1);
    expect(raster.seen[raster.cols - 1]).toBe(0);
  });

  it('passes on the same light while Atlas\'s answer stays the same', () => {
    const reaches = [torch(40, 48)];
    const ambient = { ambient: 0.2 };
    const answer = (seen: number) => {
      const base = ready({ hero: 'seen' }, () => true, MAP, 8);
      if (base.status !== 'ready') throw new Error('not ready');
      return { ...base, light: { seen: new Uint8Array(base.darkness.shown.length).fill(seen), ambient, reaches } };
    };
    const lighting = testLighting(answer(1));
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    const first = live.frame(MAP)?.light;
    expect(first?.reaches).toBe(reaches);
    lighting.current = answer(1);
    expect(live.frame(MAP)?.light).toBe(first);
    lighting.current = answer(0);
    expect(live.frame(MAP)?.light).not.toBe(first);
    lighting.current = ready({ hero: 'seen' }, () => true, MAP, 8);
    expect(live.frame(MAP)?.light).toBeUndefined();
  });
});

describe('the scene\'s light on the wire', () => {
  const glow = { image: 'data:image/png;base64,iVBORw0KGgo=' };

  it('is sent as null once it goes away, and not at all while it stays away', () => {
    expect(diffScenes(playerScene({ glow }), playerScene())?.set).toEqual({ glow: null });
    expect(diffScenes(playerScene({ glow: null }), playerScene())).toBeNull();
    expect(diffScenes(playerScene(), playerScene({ glow }))?.set).toEqual({ glow });
  });

  it('takes only a PNG data URL', () => {
    const patch = (value: unknown) => decodeRaw({ v: 1, type: 'scene-patch', seq: 2, set: { glow: value }, upsert: {}, remove: {} }).kind;
    expect(patch(glow)).toBe('message');
    expect(patch(null)).toBe('message');
    expect(patch({ image: 'https://example.com/x.png' })).toBe('invalid');
    expect(patch({ image: 'data:image/svg+xml;base64,PHN2Zz4=' })).toBe('invalid');
    expect(patch({ image: 'data:image/png;base64,"<script>' })).toBe('invalid');
  });
});

describe('the glow layer', () => {
  it('draws the light over the map once decoded, keeps the last while the next decodes, and drops it with the light', async () => {
    let finish: (image: HTMLImageElement) => void = () => undefined;
    const decode = vi.fn(() => new Promise<HTMLImageElement>((resolve) => { finish = resolve; }));
    const layer = createGlowLayer(decode);
    const surface = new RecordingSurface();
    const lit = playerScene({ glow: { image: 'data:image/png;base64,AAAA' } });
    layer.draw(surface, frame(lit));
    expect(surface.calls).toEqual([]);
    expect(layer.animating?.()).toBe(true);
    const image = {} as HTMLImageElement;
    finish(image);
    await Promise.resolve();
    layer.draw(surface, frame(lit));
    expect(surface.calls).toEqual([{ op: 'image', image, x: 0, y: 0, width: 1000, height: 800, clip: null }]);
    expect(layer.animating?.()).toBe(false);
    surface.clear();
    layer.draw(surface, frame(playerScene({ glow: { image: 'data:image/png;base64,BBBB' } })));
    expect(surface.calls).toHaveLength(1);
    surface.clear();
    layer.draw(surface, frame(playerScene({ glow: null })));
    layer.draw(surface, frame(playerScene()));
    expect(surface.calls).toEqual([]);
    expect(decode).toHaveBeenCalledTimes(2);
  });
});

describe('the light picture\'s size', () => {
  it('shrinks until it fits a message, and is left out where even the smallest does not', () => {
    const torchLight: FrameLight = { cols: 24, rows: 12, cellSize: 8, seen: new Uint8Array(288).fill(1), shown: new Uint8Array(288).fill(1), ambient: { ambient: 0 }, reaches: [] };
    const widths: number[] = [];
    const fitsAt = (width: number) => (pixels: OverlayPixels) => {
      widths.push(pixels.width);
      return `data:image/png;base64,${'A'.repeat(pixels.width > width ? 70_000 : 10)}`;
    };
    expect(lightOverlay(torchLight, {}, { width: 1920, height: 960 }, 10, fitsAt(128))).not.toBeNull();
    // The light picture fits at 128, then the finer darkness at its first try.
    expect(widths).toEqual([192, 128, 768]);
    widths.length = 0;
    expect(lightOverlay({ ...torchLight }, {}, { width: 1920, height: 960 }, 10, fitsAt(1))).toBeNull();
    expect(widths).toEqual([192, 128, 64]);
  });
});

describe('a player joining a lit scene', () => {
  it('gets its light with the snapshot, not only with a later patch', () => {
    const glow = { image: 'data:image/png;base64,iVBORw0KGgo=' };
    const mirror = new PlayerSceneMirror({ sendResync: () => undefined, onChange: () => undefined });
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene({ glow })), fogParts: 0, drawingParts: 0 });
    expect(mirror.scene?.glow).toEqual(glow);
  });
});

describe('the finer darkness', () => {
  const SIGHT = { sees: { bright: 'normal', dim: 'normal', dark: 'normal', magicalDark: 'none' }, reveals: 'all', lineOfSight: true, precise: true } as const;
  /** Seen ground below a wall rising one in two, y = x/2 + 64, on 32-pixel darkness cells; seen cells lie wholly below it. */
  function walled(withSight = true): FrameLight {
    const cellSize = 32;
    const cols = 8;
    const below = (x: number, y: number): boolean => y >= x / 2 + 64;
    const seen = new Uint8Array(cols * cols);
    for (let row = 0; row < cols; row++) {
      for (let col = 0; col < cols; col++) {
        const [x0, y0, x1, y1] = [col * cellSize, row * cellSize, (col + 1) * cellSize, (row + 1) * cellSize];
        seen[row * cols + col] = below(x0, y0) && below(x1, y0) && below(x0, y1) && below(x1, y1) ? 1 : 0;
      }
    }
    const polygon = [{ x: 0, y: 64 }, { x: 256, y: 192 }, { x: 256, y: 256 }, { x: 0, y: 256 }];
    return {
      cols, rows: cols, cellSize, seen, shown: seen.slice(), ambient: { ambient: 0 }, reaches: [],
      ...(withSight ? { sight: { all: false, regions: [{ sense: SIGHT, origin: { x: 128, y: 240 }, radius: 1000, polygon }] } } : {}),
    } as FrameLight;
  }
  const map = { width: 256, height: 256 };
  /** Where the darkness ends going down each column: the first pixel left clear. */
  const edgeOf = (pixels: OverlayPixels): number[] => Array.from({ length: pixels.width }, (_, x) => {
    let y = 0;
    while (y < pixels.height && at(pixels, x, y)[3] > 0) y++;
    return y;
  });

  it('follows the wall the tokens\' sight stops at, not the stairs of the cells', () => {
    const edge = edgeOf(darkPixels(walled(), map, 8, 256)!);
    // Its distance from the wall (y = x/2 + 64) stays the same all along it: the edge runs parallel to the wall.
    const offsets = edge.slice(40, 216).map((y, index) => y - ((40 + index) / 2 + 64));
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThanOrEqual(2);
    // Close to the wall: the seen side clear, little of the far side through the blur.
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(8);
    // Without the sight to read, the cells decide: the edge drifts from the wall with their stairs.
    const stepped = edgeOf(darkPixels(walled(false), map, 8, 256)!).slice(40, 216).map((y, index) => y - ((40 + index) / 2 + 64));
    expect(Math.max(...stepped) - Math.min(...stepped)).toBeGreaterThan(Math.max(...offsets) - Math.min(...offsets));
  });

  it('leaves the ground the tokens see clear, and stays dark across the wall', () => {
    const pixels = darkPixels(walled(), map, 8, 256)!;
    expect(at(pixels, 128, 240)[3]).toBe(0);
    expect(at(pixels, 128, 20)[3]).toBeGreaterThanOrEqual(250);
  });

  it('is sent with the light picture, where it fits', () => {
    const encode = (pixels: OverlayPixels) => `data:image/png;base64,${pixels.width}AA`;
    expect(lightOverlay(walled(), {}, map, 10, encode)?.dark).toBe('data:image/png;base64,768AA');
  });
});
