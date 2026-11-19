/**
 * What dynamic lighting hides from online players, as Atlas tells it (`lighting.playerVisibility`): the
 * same sight, light, explored memory and token perception the GM's player window is drawn by. Nothing of
 * walls, lights or vision reaches Connect; only what they decide: which tokens players see, and the
 * darkness over the map (`darknessFog`). Atlas works the picture out, throttles the darkness (it may lag
 * tokens by up to 200 ms) and answers `pending` whenever it cannot tell; this turns its answer into a frame.
 */
import type { Disposer, LightingApi, PlayerVisibility } from '@atlas-vtt/api-types';
import { closedFrame, rasterFrame, type DarknessGrid, type FrameLight, type LightingFrame, type RasterFrame } from './lightingFrame';
import type { PlayerLight } from '../../../../packages/atlas-host/src/lighting/types';
import type { AmbientLight } from '../../../../packages/atlas-host/src/lighting/visionRules';
import type { MapSize } from './sceneTypes';

/** Far more cells than Atlas ever answers with (at most 1024 a side): a grid past it is not read, and the frame closes. */
const MAX_CELLS = 1 << 22;

type ReadyVisibility = Extract<PlayerVisibility, { status: 'ready' }>;

interface Built {
  cols: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
  shown: Uint8Array;
  raster: RasterFrame;
}

/** The lighting of one presentation's view: its frame for each projection, and `onDue` when Atlas says it changed. */
export class LiveLighting {
  private readonly stopWatching: Disposer;
  /** The last raster worked out, kept while Atlas's answer stays the same: the fog coverage is keyed on its darkness. */
  private built: Built | null = null;
  /** The last light handed on, kept while it stays the same: the light overlay is worked out again only when it changes. */
  private light: FrameLight | null = null;

  constructor(private readonly lighting: Pick<LightingApi, 'playerVisibility' | 'watch'>, private readonly viewId: string, onDue: () => void) {
    this.stopWatching = lighting.watch(viewId, onDue);
  }

  /**
   * Null while lighting hides nothing (`unlit`): the projection is then as without lighting. While Atlas
   * cannot tell (`pending`, or a status this Connect does not know), and for an answer that does not fit
   * the map, nothing is seen (`closedFrame`).
   */
  frame(map: MapSize): LightingFrame | null {
    const visibility = this.visibility();
    if (visibility.status === 'unlit') return null;
    const raster = visibility.status === 'ready' ? this.rasterOf(visibility, map) : null;
    if (visibility.status !== 'ready' || !raster) {
      this.built = null;
      return closedFrame(map);
    }
    const { tokens } = visibility;
    const light = this.lightOf(visibility);
    // Tokens never wait: they follow the window's perception at every projection; a token only sensed is not seen.
    return {
      seen: (tokenId) => Object.hasOwn(tokens, tokenId) && tokens[tokenId] === 'seen', darkness: raster.darkness, shows: raster.shows,
      ...(light ? { light } : {}),
    };
  }

  /** Atlas's answer; an answer that cannot be had is not known, and unknown is dark (ruling L4). */
  private visibility(): PlayerVisibility {
    try {
      return this.lighting.playerVisibility(this.viewId);
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not read what players see:', error);
      return { status: 'pending' };
    }
  }

  /** Whether Atlas cannot tell yet what players see (`pending`): a scene going live waits for it (ruling P8). */
  pending(): boolean {
    return this.visibility().status === 'pending';
  }

  /** The store holds the scene anew (reloaded in place): nothing worked out for it before stands in. */
  restart(): void {
    this.built = null;
    this.light = null;
  }

  dispose(): void {
    this.stopWatching();
    this.built = null;
    this.light = null;
  }

  /** The answer's light (an Atlas host of Connect's own hands it out, Atlas's API does not), or null where it does not fit. */
  private lightOf(visibility: ReadyVisibility): FrameLight | null {
    const given = (visibility as { light?: PlayerLight }).light;
    const { cellSize, cols, rows, shown } = visibility.darkness;
    if (!given || !(given.seen instanceof Uint8Array) || given.seen.length !== cols * rows || !Array.isArray(given.reaches)) return null;
    const last = this.light;
    if (last && last.cols === cols && last.rows === rows && last.cellSize === cellSize && sameAmbient(last.ambient, given.ambient)
      && last.reaches === given.reaches && sameBytes(last.seen, given.seen) && sameBytes(last.shown, shown)) return last;
    this.light = Object.freeze({ cols, rows, cellSize, seen: given.seen.slice(), shown: shown.slice(), ambient: given.ambient, reaches: given.reaches });
    return this.light;
  }

  /** The darkness and positive check of a ready answer over `map`; null when the answer does not fit it or is too large (fail closed). */
  private rasterOf({ darkness: { cellSize, cols, rows, shown } }: ReadyVisibility, map: MapSize): RasterFrame | null {
    const { width, height } = map;
    if (!(width > 0) || !(height > 0) || !(cellSize > 0) || !Number.isFinite(cellSize)) return null;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 0 || rows < 0 || shown.length !== cols * rows) return null;
    const last = this.built;
    if (last && last.cols === cols && last.rows === rows && last.cellSize === cellSize && last.width === width
      && last.height === height && sameBytes(last.shown, shown)) return last.raster;
    const grid = darkGrid(cols, rows, cellSize, shown, map);
    if (!grid) return null;
    const raster = rasterFrame({ ...grid, map });
    this.built = { cols, rows, cellSize, width, height, shown: shown.slice(), raster };
    return raster;
  }
}

/**
 * The cells players do not see: every cell not shown (only 1 is shown), and every cell of `map` the
 * answer's grid does not reach, so a map larger than the one Atlas measured is dark beyond it.
 */
function darkGrid(cols: number, rows: number, cellSize: number, shown: Uint8Array, map: MapSize): Omit<DarknessGrid, 'map'> | null {
  const allCols = Math.max(cols, Math.ceil(map.width / cellSize));
  const allRows = Math.max(rows, Math.ceil(map.height / cellSize));
  if (allCols * allRows > MAX_CELLS) return null;
  const dark = new Uint8Array(allCols * allRows).fill(1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) if (shown[row * cols + col] === 1) dark[row * allCols + col] = 0;
  }
  return { cols: allCols, rows: allRows, cellSize, dark };
}

/** Atlas hands out a new ambient object while a scene has light zones: the same light is the same values and zones. */
function sameAmbient(a: AmbientLight, b: AmbientLight): boolean {
  return a === b || (a.ambient === b.ambient && a.litThreshold === b.litThreshold && a.brightThreshold === b.brightThreshold && a.zones === b.zones);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}
