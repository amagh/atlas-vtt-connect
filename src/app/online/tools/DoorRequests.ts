/**
 * Players asking to open or close a door (`door-request`), which the GM allows or denies. A request is taken only for a
 * door the sender was sent (`PlayerScene.doors`, so one they see) on the scene they have, at most
 * `DOOR_REQUESTS_PER_SECOND` a second, and one waiting answer per door at a time. The GM gets a notice; on Allow the
 * door is found again in the scene the GM's view shows now and turned through Atlas's own store (a locked door is
 * unlocked first: the GM allowed it). Nothing changes without the GM's Allow. A `GmSession` handler.
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
  closed?: unknown;
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
    if (!door) return;
    const key = keyOf(scene.sceneId, door);
    if (this.waiting.has(key)) return;
    const question = this.options.ask({ player: player.name, opening: !door.open, locked: door.locked === true }, (allow) => {
      this.waiting.delete(key);
      if (allow) this.turn(slot.sceneId, slot.tab.viewId, message);
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

  /** Turns the door, found again in what the GM's view holds now: nothing when it moved, went or Atlas is on another map. */
  private turn(sceneId: string, viewId: string, request: DoorRequest): void {
    const snapshot = this.options.projection.shownSnapshot(sceneId);
    const walls = (snapshot?.objects as { walls?: unknown } | undefined)?.walls;
    if (!walls || typeof walls !== 'object') return;
    for (const raw of Object.values(walls as Record<string, unknown>)) {
      const wall = raw as WallRecord;
      if (typeof wall.id !== 'string' || (wall.type !== 'door' && !(wall.type === 'secret-door' && wall.closed === false))) continue;
      const { p1, p2 } = wall;
      if (p1?.x === request.x1 && p1.y === request.y1 && p2?.x === request.x2 && p2.y === request.y2) {
        this.options.doors?.toggle(viewId, wall.id, true);
        return;
      }
    }
  }
}
