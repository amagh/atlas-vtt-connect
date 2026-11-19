/**
 * Atlas's fog, drawn last and opaque. The fog is rendered once into a cached image of
 * the map area (at most 4096 px on its long side) and redrawn only when the fog
 * changes, so panning and zooming over thousands of strokes stays cheap. Erasing cuts
 * out of the image like Atlas's compositor (`destination-out`).
 */
import { FOG_COLOR } from '@atlas-vtt/shared/draw';
import { fogShapes, type FogShape } from '../../preview/previewShapes';
import type { PlayerFogOp, PlayerScene } from '../../scene/sceneTypes';
import { intersects, type WorldRect } from '../camera';
import type { LayerSurface, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';
import { DARKNESS_FOG_ID } from '../../scene/darknessFog';
import { decodeImage, type GlowDecoder } from './glowLayer';
import { softDarkness, type SoftDarkness } from './softDarkness';


/** The fog image's long side, in pixels, at most. */
export const FOG_CACHE_MAX_SIDE = 4096;

interface FogCache {
  fog: Readonly<Record<string, PlayerFogOp>>;
  mapWidth: number;
  mapHeight: number;
  /** Painted without the darkness fog, which the GM's finer darkness stands in for. */
  masked: boolean;
  area: WorldRect | null;
  layer: LayerSurface | null;
}

/** The fog image's world area: the map, or without a map size the extent of the fog itself. */
export function fogArea(scene: PlayerScene, shapes: readonly FogShape[]): WorldRect | null {
  if (scene.map.width > 0 && scene.map.height > 0) return { x: 0, y: 0, width: scene.map.width, height: scene.map.height };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (x: number, y: number, pad: number): void => {
    left = Math.min(left, x - pad);
    top = Math.min(top, y - pad);
    right = Math.max(right, x + pad);
    bottom = Math.max(bottom, y + pad);
  };
  for (const shape of shapes) {
    if (shape.kind === 'rect') {
      add(shape.x, shape.y, 0);
      add(shape.x + shape.width, shape.y + shape.height, 0);
    } else {
      const pad = shape.kind === 'stroke' ? shape.width / 2 : 0;
      for (const point of shape.points) add(point.x, point.y, pad);
    }
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export class FogLayer implements PlayerLayer {
  private cache: FogCache | null = null;
  /** How many times the fog image was painted; tests read it. */
  rebuilds = 0;
  /** The GM's finer darkness (`PlayerGlow.dark`) shown, and the one decoding: the last stays up until the next is ready. */
  private dark: { url: string; image: HTMLImageElement | ImageBitmap } | null = null;
  private darkLoading: string | null = null;

  constructor(private readonly decode: GlowDecoder = decodeImage) {}

  /** While the darkness is decoding the view keeps drawing, so it shows as soon as it is ready. */
  animating(): boolean {
    return this.darkLoading !== null;
  }

  draw(surface: ViewSurface, frame: LayerFrame): void {
    const { fog, map } = frame.scene;
    this.follow(frame.scene.glow?.dark ?? null);
    // A decoded darkness stands in for the darkness fog's cell-stepped outline; until one is, the outline is drawn soft.
    const masked = this.dark !== null && map.width > 0 && map.height > 0;
    const cache = this.cache;
    if (!cache || cache.fog !== fog || cache.mapWidth !== map.width || cache.mapHeight !== map.height || cache.masked !== masked) this.rebuild(surface, frame.scene, masked);
    const area = this.cache?.area ?? null;
    const layer = this.cache?.layer ?? null;
    if (area && layer && intersects(area, frame.visible)) surface.drawLayer(layer, area.x, area.y, area.width, area.height);
    if (masked && this.dark) {
      const { image } = this.dark;
      const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
      const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
      // The mask's long side spans the map's: a pixel is the same world size each way.
      const pixel = Math.max(map.width, map.height) / Math.max(width, height, 1);
      surface.image(image, 0, 0, width * pixel, height * pixel, null);
    }
  }

  dispose(): void {
    this.cache?.layer?.release();
    this.cache = null;
  }

  /** Decodes the GM's darkness when it changes; none drops it. */
  private follow(url: string | null): void {
    if (!url) {
      this.dark = null;
      this.darkLoading = null;
      return;
    }
    if (this.dark?.url === url || this.darkLoading === url) return;
    this.darkLoading = url;
    this.decode(url).then((image) => {
      if (this.darkLoading !== url) return;
      this.dark = { url, image };
      this.darkLoading = null;
    }, (error: unknown) => {
      if (this.darkLoading !== url) return;
      this.darkLoading = null;
      console.warn("[Atlas VTT Connect] Could not show the scene's darkness:", error);
    });
  }

  private rebuild(surface: ViewSurface, scene: PlayerScene, masked: boolean): void {
    this.dispose();
    // A lit scene's darkness is drawn soft, last as its order says, where the map has a size; else as any other fog.
    // Where the GM's finer darkness is shown it takes the place of the darkness fog altogether.
    const darkness = Object.hasOwn(scene.fog, DARKNESS_FOG_ID) ? scene.fog[DARKNESS_FOG_ID] : undefined;
    const soft = !masked && darkness?.type === 'lasso' && !darkness.erase ? softDarkness(darkness.points, scene.map) : null;
    const shapes = fogShapes(soft || masked ? withoutDarkness(scene.fog) : scene.fog);
    const area = shapes.length > 0 || soft ? fogArea(scene, shapes) : null;
    const layer = area ? this.paint(surface, shapes, area, soft) : null;
    this.cache = { fog: scene.fog, mapWidth: scene.map.width, mapHeight: scene.map.height, masked, area, layer };
  }

  private paint(surface: ViewSurface, shapes: readonly FogShape[], area: WorldRect, soft: SoftDarkness | null): LayerSurface | null {
    const scale = Math.min(1, FOG_CACHE_MAX_SIDE / Math.max(area.width, area.height));
    const width = Math.max(1, Math.round(area.width * scale));
    const height = Math.max(1, Math.round(area.height * scale));
    const layer = surface.createLayer(width, height);
    if (!layer) return null;
    this.rebuilds++;
    layer.begin(width, height, null);
    layer.setCamera(scale, 0 - area.x * scale, 0 - area.y * scale);
    for (const shape of shapes) paintShape(layer, shape);
    if (soft) layer.raster(soft.image, 0, 0, soft.width, soft.height);
    return layer;
  }
}

/** The fog without the lit scene's darkness, by its own properties. */
function withoutDarkness(fog: Readonly<Record<string, PlayerFogOp>>): Record<string, PlayerFogOp> {
  const rest: Record<string, PlayerFogOp> = {};
  for (const [id, op] of Object.entries(fog)) {
    if (id !== DARKNESS_FOG_ID) Object.defineProperty(rest, id, { value: op, enumerable: true, writable: true, configurable: true });
  }
  return rest;
}

function paintShape(surface: ViewSurface, shape: FogShape): void {
  const base = { erase: shape.erase, round: true };
  if (shape.kind === 'rect') {
    surface.rect(shape.x, shape.y, shape.width, shape.height, { ...base, fill: FOG_COLOR });
    return;
  }
  if (shape.kind === 'polygon') {
    surface.paths([shape.points], true, { ...base, fill: FOG_COLOR });
    return;
  }
  const [only] = shape.points;
  if (shape.points.length === 1 && only) surface.circle(only.x, only.y, shape.width / 2, { ...base, fill: FOG_COLOR });
  else surface.paths([shape.points], false, { ...base, stroke: FOG_COLOR, lineWidth: shape.width });
}
