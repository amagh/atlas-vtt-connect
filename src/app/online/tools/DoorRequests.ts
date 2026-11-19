/**
 * Players asking to open or close a door (`door-request`), which the GM allows or denies. A request is taken only for a
 * door the sender was sent (`PlayerScene.doors`, so one they see) on the scene they have, at most
 * `DOOR_REQUESTS_PER_SECOND` a second, and one waiting answer per door at a time. The GM gets a notice; on Allow the
 * door is found again in the scene the GM's view shows now and turned through Atlas's own store (a locked door is
 * unlocked first: the GM allowed it). Nothing changes without the GM's Allow. Secret doors, which have no badge on
 * Atlas's player window, are never asked for. A `GmSession` handler.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { PlayerDoor } from '../scene/sceneTypes';
import type { SlotProjection } from '../scene/slotViews';

export const DOOR_REQUESTS_PER_SECOND = 2;

type DoorRequest = Extract<ControlMessage, { type: 'door-request' }>;

/** Turns a door of a view's scene by its wall id; false when the view or the door is gone, or Atlas refuses. */
export interface DoorToggle {
  toggle(viewId: string, wallId: string, unlock: boolean): boolean;
}

/** What the GM is asked: who, and whether the door would open or close, and is locked. */
export interface DoorAsk {
  player: string;
  opening: boolean;
  locked: boolean;
}

export interface DoorRequestsOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'shownSnapshot'>;
  /** Atlas's doors; null where this Atlas has none, and every request is dropped. */
  doors: DoorToggle | null;
  /** Shows the GM the question; `answer` runs once with their choice. Returns what hides it unanswered. */
  ask(question: DoorAsk, answer: (allow: boolean) => void): { hide(): void };
  /** While a cutscene runs, no request is taken. */
  cutscene?: { running(): boolean };
}

const keyOf = (sceneId: string, door: Pick<PlayerDoor, 'x1' | 'y1' | 'x2' | 'y2'>): string => `${sceneId}|${door.x1},${door.y1},${door.x2},${door.y2}`;
const sameOpening = (a: Pick<PlayerDoor, 'x1' | 'y1' | 'x2' | 'y2'>, b: Pick<PlayerDoor, 'x1' | 'y1' | 'x2' | 'y2'>): boolean =>
  a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;

interface WallRecord {
  id?: unknown;
  type?: unknown;
  locked?: unknown;
  p1?: { x?: unknown; y?: unknown };
  p2?: { x?: unknown; y?: unknown };
}

export class DoorRequests implements SessionHandler {
  private readonly limit = new RateLimit(DOOR_REQUESTS_PER_SECOND);
  /** The questions the GM has not answered, by door. */
  private readonly waiting = new Map<string, { playerId: string; hide(): void }>();
  private unuse: (() => void) | null = null;

  constructor(private readonly options: DoorRequestsOptions) {}

  start(): void {
    this.unuse ??= this.options.session.use(this);
  }

  stop(): void {
    this.unuse?.();
    this.unuse = null;
    for (const question of this.waiting.values()) question.hide();
    this.waiting.clear();
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'door-request' || !this.options.doors || this.options.cutscene?.running()) return;
    if (!this.limit.allow(player.playerId, Date.now())) return;
    const slot = this.options.projection.slotOf(player.playerId);
    const scene = slot?.lastSent;
    if (!slot || !scene || scene.sceneId !== message.sceneId) return;
    // Only a door this player was sent: one they see, as they see it.
    const door = (scene.doors ?? []).find((each) => sameOpening(each, message));
    // A secret door has no badge to ask with, as on Atlas's player window.
    if (!door || door.secret) return;
    const key = keyOf(scene.sceneId, door);
    if (this.waiting.has(key)) return;
    // Players are never told a door is locked (Atlas shows them no lock); the GM is.
    const locked = this.wallAt(slot.sceneId, message)?.locked === true;
    const question = this.options.ask({ player: player.name, opening: !door.open, locked }, (allow) => {
      this.waiting.delete(key);
      const wall = allow ? this.wallAt(slot.sceneId, message) : null;
      if (wall) this.options.doors?.toggle(slot.tab.viewId, wall.id, true);
    });
    this.waiting.set(key, { playerId: player.playerId, hide: () => question.hide() });
  }

  /** A player who left takes their questions with them. */
  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const [key, question] of this.waiting) {
      if (known.has(question.playerId)) continue;
      question.hide();
      this.waiting.delete(key);
    }
  }

  /** The door at the request's opening in what the GM's view holds now; null when it moved, went or Atlas is on another map. */
  private wallAt(sceneId: string, request: DoorRequest): { id: string; locked: boolean } | null {
    const snapshot = this.options.projection.shownSnapshot(sceneId);
    const walls = (snapshot?.objects as { walls?: unknown } | undefined)?.walls;
    if (!walls || typeof walls !== 'object') return null;
    for (const raw of Object.values(walls as Record<string, unknown>)) {
      const wall = raw as WallRecord;
      if (typeof wall.id !== 'string' || wall.type !== 'door') continue;
      const { p1, p2 } = wall;
      if (p1?.x === request.x1 && p1.y === request.y1 && p2?.x === request.x2 && p2.y === request.y2) return { id: wall.id, locked: wall.locked === true };
    }
    return null;
  }
}
