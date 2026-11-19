/**
 * Doors on a stock Atlas VTT, which has no extension API for them: turned through the scene store's own `toggleDoor`,
 * as a click on a door's badge turns it, after `setDoorLocked` where a locked door is to open. Only ever called for a
 * request the GM allowed (`DoorRequests`). Whatever cannot be found refuses, never guesses.
 */
import type { DoorToggle } from '../app/online/tools/DoorRequests';

interface DoorScene {
  mapLoaded: boolean;
  isMapLoading: boolean;
  toggleDoor?: (wallId: string) => void;
  setDoorLocked?: (wallId: string, locked: boolean) => void;
}

export interface DoorView {
  readonly atlasStore: { getState(): DoorScene };
}

export function stockDoorsApi(view: (viewId: string) => DoorView | null): DoorToggle {
  return {
    toggle(viewId, wallId, unlock): boolean {
      const state = view(viewId)?.atlasStore.getState();
      if (!state?.mapLoaded || state.isMapLoading || typeof state.toggleDoor !== 'function') return false;
      try {
        if (unlock && typeof state.setDoorLocked === 'function') state.setDoorLocked(wallId, false);
        state.toggleDoor(wallId);
        return true;
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not turn a door:', error);
        return false;
      }
    },
  };
}
