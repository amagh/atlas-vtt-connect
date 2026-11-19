/**
 * Atlas's door badges as its player window draws them (`door-icons`): at the middle of each door players see, a dark
 * disc ringed in blue with the closed or open door glyph. Drawn over the darkness and the fog, so a door to ask for is
 * easy to find and tap; a secret door has none, as on Atlas's player window, which badges plain doors only.
 */
import { intersects } from '../camera';
import type { DoorGlyph } from '../doorGlyphs';
import type { PlayerLayer } from './layerTypes';

/** Atlas's badge, as a share of a grid cell (`HRi`), its ring's width and its glyph's size as shares of that (`GRi`). */
const BADGE_RADIUS = 0.2;
const BADGE_RING = 0.14;
const BADGE_GLYPH = 1.35;
/** The glyph sits a little low in its disc, as Atlas anchors it (`WRi`, 0.53). */
const GLYPH_DROP = 0.03;
export const BADGE_FILL = '#1b1b1f';
const BADGE_FILL_ALPHA = 0.85;
export const BADGE_COLOR = '#44aaff';

export function createDoorBadgesLayer(): PlayerLayer {
  return {
    draw(surface, frame): void {
      const doors = frame.scene.doors;
      if (!doors || doors.length === 0) return;
      const radius = frame.scene.map.cellSize * BADGE_RADIUS;
      const glyph = radius * BADGE_GLYPH;
      for (const { x1, y1, x2, y2, open, secret } of doors) {
        if (secret) continue;
        const x = (x1 + x2) / 2;
        const y = (y1 + y2) / 2;
        if (!intersects({ x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius }, frame.visible)) continue;
        surface.circle(x, y, radius, { fill: BADGE_FILL, alpha: BADGE_FILL_ALPHA });
        surface.circle(x, y, radius, { stroke: BADGE_COLOR, lineWidth: radius * BADGE_RING });
        const name: DoorGlyph = open ? 'door-open' : 'door-closed';
        surface.glyph(name, x, y + glyph * GLYPH_DROP, glyph, BADGE_COLOR, 1);
      }
    },
  };
}
