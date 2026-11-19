/**
 * The doors players see (`PlayerScene.doors`), over the fog and the darkness so they stand out: a closed door as a wooden bar across
 * its opening, an open one as its leaf swung a quarter turn from its first end, with the opening marked faintly. Its
 * badge, which players tap to ask the GM to turn it, is drawn over the fog (`doorBadgesLayer`).
 */
import { intersects } from '../camera';
import type { PlayerLayer } from './layerTypes';

export const DOOR_WOOD = '#8a5a2b';
export const DOOR_EDGE = '#2a1a0c';
/** A door's thickness, as a share of a grid cell, and its least in world pixels. */
const DOOR_THICKNESS = 0.14;
const DOOR_MIN_THICKNESS = 3;

export function createDoorsLayer(): PlayerLayer {
  return {
    draw(surface, frame): void {
      const doors = frame.scene.doors;
      if (!doors || doors.length === 0) return;
      const thickness = Math.max(DOOR_MIN_THICKNESS, frame.scene.map.cellSize * DOOR_THICKNESS);
      for (const { x1, y1, x2, y2, open } of doors) {
        const length = Math.hypot(x2 - x1, y2 - y1);
        const reach = length + thickness;
        const area = { x: Math.min(x1, x2) - reach, y: Math.min(y1, y2) - reach, width: Math.abs(x2 - x1) + 2 * reach, height: Math.abs(y2 - y1) + 2 * reach };
        if (!intersects(area, frame.visible)) continue;
        const from = { x: x1, y: y1 };
        if (!open) {
          surface.paths([[from, { x: x2, y: y2 }]], false, { stroke: DOOR_EDGE, lineWidth: thickness + 2 * frame.pixel * 1.5 });
          surface.paths([[from, { x: x2, y: y2 }]], false, { stroke: DOOR_WOOD, lineWidth: thickness });
          continue;
        }
        // Swung a quarter turn about its first end, to the left of the opening.
        const leaf = { x: x1 - (y2 - y1), y: y1 + (x2 - x1) };
        surface.paths([[from, { x: x2, y: y2 }]], false, { stroke: DOOR_WOOD, lineWidth: Math.max(frame.pixel, thickness / 4), alpha: 0.6, dash: [thickness, thickness] });
        surface.paths([[from, leaf]], false, { stroke: DOOR_EDGE, lineWidth: thickness * 0.7 + 2 * frame.pixel * 1.5, alpha: 0.85 });
        surface.paths([[from, leaf]], false, { stroke: DOOR_WOOD, lineWidth: thickness * 0.7, alpha: 0.85 });
      }
    },
  };
}
