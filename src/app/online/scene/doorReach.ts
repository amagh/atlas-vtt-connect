/**
 * Which doors a player may ask for: those within `DOOR_REACH_CELLS` grid squares of one of the tokens they control,
 * counted as squares are on a grid (diagonals too) from the token's edge to the door's middle. Both the player's page
 * (which badges only these, and takes a tap only on a badge) and the GM (who drops any other request) judge it so.
 * Shared with the web page.
 */
import { tokenDiameterInCells } from '@atlas-vtt/shared/draw';
import type { PlayerDoor, ScenePoint } from './sceneTypes';

export const DOOR_REACH_CELLS = 2;

/** A token where it stands: its middle and its size in cells. */
export interface ReachingToken {
  x: number;
  y: number;
  size: number;
}

export function doorMiddle({ x1, y1, x2, y2 }: Pick<PlayerDoor, 'x1' | 'y1' | 'x2' | 'y2'>): ScenePoint {
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/** Whether any of `tokens` stands within reach of the door, on a grid of `cellSize`. */
export function doorInReach(door: Pick<PlayerDoor, 'x1' | 'y1' | 'x2' | 'y2'>, tokens: Iterable<ReachingToken>, cellSize: number): boolean {
  const middle = doorMiddle(door);
  for (const token of tokens) {
    const half = (Math.max(1, tokenDiameterInCells(token.size)) * cellSize) / 2;
    if (Math.max(Math.abs(token.x - middle.x), Math.abs(token.y - middle.y)) <= half + DOOR_REACH_CELLS * cellSize) return true;
  }
  return false;
}
