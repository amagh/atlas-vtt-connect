/**
 * The player view's layers, one per Atlas layer in `SCENE_LAYER_ORDER`: a layer added
 * to Atlas's list fails the build here until the player view has one.
 */
import type { SceneLayer } from '@atlas-vtt/shared/draw';
import { createDoorsLayer } from './doorsLayer';
import { createDrawingsLayer } from './drawingsLayer';
import { FogLayer } from './fogLayer';
import { createGlowLayer } from './glowLayer';
import { createGridLayer } from './gridLayer';
import type { PlayerLayer } from './layerTypes';
import type { MiniLayer } from '../minis/miniLayer';
import { createMapLayer } from './mapLayer';
import { createTextsLayer } from './textsLayer';
import { createTokensLayer } from './tokensLayer';

/** Draws `layers` in order as one layer: the scene's light on the map's own layer, the doors on the grid's. */
function stacked(...layers: PlayerLayer[]): PlayerLayer {
  return {
    draw: (surface, frame) => { for (const layer of layers) layer.draw(surface, frame); },
    animating: () => layers.some((layer) => layer.animating?.() === true),
    dispose: () => { for (const layer of layers) layer.dispose?.(); },
  };
}

/** `minis`: the 3D minis on tokens (`minis/miniLayer.ts`); without it none is drawn. */
export function createSceneLayers(options: { minis?: MiniLayer } = {}): Record<SceneLayer, PlayerLayer> {
  return {
    map: stacked(createMapLayer(), createGlowLayer()),
    // Doors on the grid's own layer: over the floor, under the tokens.
    grid: stacked(createGridLayer(), createDoorsLayer()),
    tokens: createTokensLayer(options.minis ? { minis: options.minis } : {}),
    texts: createTextsLayer(),
    drawings: createDrawingsLayer(),
    fog: new FogLayer(),
  };
}
