/**
 * What the player visibility reader hands out, as Atlas's extension API names it (`@atlas-vtt/api-types`, which
 * Tabletop does not have): the same shapes, so Connect passes them on as its API's.
 */
import type { AmbientLight, LightReach, Sight } from './visionRules';

export type Disposer = () => void;

/** How the player window shows a token: seen, outlined only (sensed), or not at all. */
export type Perception = 'seen' | 'sensed' | 'unseen';

export type PlayerVisibility =
  /** Lighting hides nothing: dynamic lighting off, or the scene unlit. */
  | { readonly status: 'unlit' }
  /** Not worked out for the scene the store holds yet: show players nothing. */
  | { readonly status: 'pending' }
  | {
    readonly status: 'ready';
    /** By lighting only: a token the GM hid can read 'seen' here, so apply `hidden` and fog yourself. */
    readonly tokens: Readonly<Record<string, Perception>>;
    /** Where the player window shows the map, cell by cell (1 = shown), from the map's top-left corner, row by row; a fresh copy. */
    readonly darkness: { readonly cellSize: number; readonly cols: number; readonly rows: number; readonly shown: Uint8Array };
    /** The window shows explored memory where no token sees. */
    readonly showsExplored: boolean;
    /** What lights the map, for a light overlay over what players see; absent where it cannot be read. Not Atlas's API. */
    readonly light?: PlayerLight;
  };

/**
 * The light over the cells of `darkness`: which of them a token's sight shows now (1), not only the explored memory,
 * and the scene's ambient light and light reaches, walls already cut out. Read on the GM's side only: a caller sends
 * players what it works out of these, only over the cells they see.
 */
export interface PlayerLight {
  readonly seen: Uint8Array;
  readonly ambient: AmbientLight;
  readonly reaches: readonly LightReach[];
  /** The sight the cells were worked out from, walls already cut out: where its edges run, seen ground ends. */
  readonly sight: Sight;
}

export interface PlayerVisibilityOptions {
  /** The map's long side holds at most this many cells (16–1024, default 384). */
  maxCellsPerSide?: number;
  /** Only this token's sight (a point of view): the map is shown where it sees, and nowhere else. */
  onlyToken?: string;
}

export interface LightingApi {
  /** What the GM's player window shows of the view's lit scene. Never throws: anything not known is `pending`. */
  playerVisibility(viewId: string, options?: PlayerVisibilityOptions): PlayerVisibility;
  /** Called when what `playerVisibility` returns may have changed. */
  watch(viewId: string, listener: () => void): Disposer;
}
