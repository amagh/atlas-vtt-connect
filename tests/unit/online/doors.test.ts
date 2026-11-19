import { describe, expect, it, vi } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, PLAYER_MESSAGE_TYPES } from '../../../src/app/online/protocol';
import { PlayerSceneMirror } from '../../../src/app/online/scene/PlayerSceneMirror';
import { diffScenes } from '../../../src/app/online/scene/sceneDiff';
import type { PlayerDoor } from '../../../src/app/online/scene/sceneTypes';
import { DoorRequests, type DoorAsk } from '../../../src/app/online/tools/DoorRequests';
import { TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { PlayerTools } from '../../../src/app/online/view/tools/PlayerTools';
import { BADGE_COLOR, createDoorBadgesLayer } from '../../../src/app/online/view/layers/doorBadgesLayer';
import { createDoorsLayer, DOOR_WOOD } from '../../../src/app/online/view/layers/doorsLayer';
import { project, projectLit, ready, scene } from './lightingFixtures';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken, sceneBody } from './sceneFixtures';

const decodeRaw = (value: unknown): ReturnType<typeof decodeControl> => decodeControl(JSON.stringify(value));
const wall = (id: string, type: string, x: number, closed = true) => ({ id, type, p1: { x, y: 300 }, p2: { x, y: 370 }, closed, blocks: 'sight', limited: false });
const walled = (walls: Record<string, unknown>, lit = false): SceneSnapshot => scene({ enabled: lit }, { walls } as Partial<SceneSnapshot['objects']>);

describe('doors for players', () => {
  it('sends doors and open secret doors, with only their opening and whether they are open', () => {
    const projected = project(walled({
      a: wall('a', 'door', 500), b: wall('b', 'door', 200, false), c: wall('c', 'solid', 300), d: wall('d', 'secret-door', 400), e: wall('e', 'secret-door', 600, false),
    }), null);
    expect(projected.doors).toEqual([
      { x1: 200, y1: 300, x2: 200, y2: 370, open: true },
      { x1: 500, y1: 300, x2: 500, y2: 370, open: false },
      { x1: 600, y1: 300, x2: 600, y2: 370, open: true, secret: true },
    ]);
  });

  it('leaves out a door players do not see, and the field with it when they see none', () => {
    const state = walled({ a: wall('a', 'door', 200), b: wall('b', 'door', 800) }, true);
    expect(projectLit(state, ready({ hero: 'seen' }, (x) => x < 500)).doors).toEqual([{ x1: 200, y1: 300, x2: 200, y2: 370, open: false }]);
    expect(projectLit(state, ready({ hero: 'seen' }, () => false))).not.toHaveProperty('doors');
    expect(project(walled({ c: wall('c', 'solid', 300) }), null)).not.toHaveProperty('doors');
  });

  it('is sent as none once players see no door, and not at all while they see none', () => {
    const door = { x1: 0, y1: 0, x2: 0, y2: 70, open: false };
    expect(diffScenes(playerScene({ doors: [door] }), playerScene())?.set).toEqual({ doors: [] });
    expect(diffScenes(playerScene({ doors: [] }), playerScene())).toBeNull();
    expect(diffScenes(playerScene(), playerScene({ doors: [door] }))?.set).toEqual({ doors: [door] });
  });

  it('takes only well-formed doors, and keeps them from a joining snapshot', () => {
    const door = { x1: 0, y1: 0, x2: 0, y2: 70, open: true };
    const patch = (doors: unknown) => decodeRaw({ v: 1, type: 'scene-patch', seq: 2, set: { doors }, upsert: {}, remove: {} }).kind;
    expect(patch([door])).toBe('message');
    expect(patch([{ ...door, open: 'yes' }])).toBe('invalid');
    expect(patch([{ ...door, x1: Number.MAX_VALUE }])).toBe('invalid');
    const mirror = new PlayerSceneMirror({ sendResync: () => undefined, onChange: () => undefined });
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene({ doors: [door] })), fogParts: 0, drawingParts: 0 });
    expect(mirror.scene?.doors).toEqual([door]);
  });
});

describe('the doors layer', () => {
  it('draws a closed door across its opening and an open one swung from its first end', () => {
    const surface = new RecordingSurface();
    createDoorsLayer().draw(surface, frame(playerScene({ doors: [{ x1: 100, y1: 100, x2: 170, y2: 100, open: false }, { x1: 300, y1: 100, x2: 370, y2: 100, open: true }] })));
    const strokes = surface.calls.filter((call) => call.op === 'paths') as Array<{ paths: Array<Array<{ x: number; y: number }>>; style: { stroke?: string } }>;
    expect(strokes[1]?.paths).toEqual([[{ x: 100, y: 100 }, { x: 170, y: 100 }]]);
    expect(strokes[1]?.style.stroke).toBe(DOOR_WOOD);
    expect(strokes.at(-1)?.paths).toEqual([[{ x: 300, y: 100 }, { x: 300, y: 170 }]]);
  });

  it('badges with Atlas\'s glyph each door within two squares of the player\'s own tokens, a secret door with none', () => {
    const scene = playerScene({
      tokens: { t1: playerToken({ x: 235 }), t2: playerToken({ x: 900 }) },
      doors: [
        { x1: 100, y1: 100, x2: 170, y2: 100, open: false }, { x1: 300, y1: 100, x2: 370, y2: 100, open: true },
        { x1: 200, y1: 150, x2: 270, y2: 150, open: true, secret: true }, { x1: 700, y1: 100, x2: 770, y2: 100, open: false },
      ],
    });
    const glyphsOf = (controlled: string[]) => {
      const surface = new RecordingSurface();
      createDoorBadgesLayer().draw(surface, frame(scene, { overlay: { controlled: new Set(controlled), positions: new Map() } }));
      return (surface.calls.filter((call) => call.op === 'glyph') as Array<{ name: string; x: number; color: string }>).map(({ name, x, color }) => [name, x, color]);
    };
    expect(glyphsOf(['t1'])).toEqual([['door-closed', 135, BADGE_COLOR], ['door-open', 335, BADGE_COLOR]]);
    // Another player's token near the far door badges nothing for this one.
    expect(glyphsOf([])).toEqual([]);
  });

  it('draws nothing without doors', () => {
    const surface = new RecordingSurface();
    createDoorsLayer().draw(surface, frame(playerScene()));
    expect(surface.calls).toEqual([]);
  });
});

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const OPENING = { x1: 200, y1: 300, x2: 200, y2: 370 };

/** A door request handler whose player has a scene with one closed door at `OPENING` (locked or not). */
function requests(options: { locked?: boolean; held?: boolean; far?: boolean } = {}) {
  let handler: SessionHandler | null = null;
  const asks: Array<{ question: DoorAsk; answer: (allow: boolean) => void; hidden: boolean }> = [];
  const toggle = vi.fn(() => true);
  const sent = playerScene({ doors: [{ ...OPENING, open: false }], tokens: { t1: playerToken({ x: options.far ? 600 : 300, y: 335 }) } });
  const shown = { objects: { walls: { w1: { id: 'w1', type: 'door', closed: true, ...(options.locked ? { locked: true } : {}), p1: { x: 200, y: 300 }, p2: { x: 200, y: 370 } }, w2: { id: 'w2', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 0, y: 70 } } } } };
  const doors = new DoorRequests({
    session: { use: (h: SessionHandler) => { handler = h; return () => undefined; } } as never,
    projection: { slotOf: () => ({ sceneId: sent.sceneId, lastSent: sent, tab: { viewId: 'v1' } }), shownSnapshot: () => (options.held === false ? null : shown) } as never,
    doors: { toggle },
    tokensOf: (playerId) => (playerId === 'p1' ? ['t1'] : []),
    ask: (question, answer) => {
      const asked = { question, answer, hidden: false };
      asks.push(asked);
      return { hide: () => { asked.hidden = true; } };
    },
  });
  doors.start();
  const request = (opening = OPENING, sceneId = sent.sceneId): void => handler!.onMessage?.(ANA, { v: 1, type: 'door-request', sceneId, ...opening });
  return { doors, asks, toggle, request };
}

describe('door requests', () => {
  it('ask the GM, and turn the door only when the GM allows', () => {
    const { asks, toggle, request } = requests();
    request();
    expect(asks.map(({ question }) => question)).toEqual([{ player: 'Ana', opening: true, locked: false }]);
    expect(toggle).not.toHaveBeenCalled();
    asks[0]!.answer(true);
    expect(toggle).toHaveBeenCalledWith('v1', 'w1', true);
    vi.useFakeTimers();
    vi.advanceTimersByTime(2_000);
    request();
    asks[1]!.answer(false);
    expect(toggle).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('are taken only for a door the player was sent, on the scene they have, once while the GM has not answered', () => {
    vi.useFakeTimers();
    const { asks, request } = requests();
    request({ ...OPENING, x1: 201 });
    request(OPENING, 'other-scene');
    expect(asks).toEqual([]);
    // Refused requests count against the limit too.
    vi.advanceTimersByTime(2_000);
    request();
    request();
    expect(asks).toHaveLength(1);
    vi.useRealTimers();
  });

  it('are dropped for a door over two squares from every token the player controls', () => {
    const { asks, request } = requests({ far: true });
    request();
    expect(asks).toEqual([]);
  });

  it('tell the GM a door is locked, and turn nothing once the GM\'s Atlas is on another map', () => {
    const locked = requests({ locked: true });
    locked.request();
    expect(locked.asks[0]?.question.locked).toBe(true);
    const away = requests({ held: false });
    away.request();
    away.asks[0]!.answer(true);
    expect(away.toggle).not.toHaveBeenCalled();
  });

  it('take a waiting question away when its player leaves, or the session stops', () => {
    const { doors, asks, request } = requests();
    request();
    doors.playersChanged([]);
    expect(asks[0]?.hidden).toBe(true);
    request();
    doors.stop();
    expect(asks[1]?.hidden).toBe(true);
  });

  it('are well formed on the wire, and only players may send them', () => {
    expect(decodeRaw({ v: 1, type: 'door-request', sceneId: 's1', ...OPENING }).kind).toBe('message');
    expect(decodeRaw({ v: 1, type: 'door-request', sceneId: 's1', ...OPENING, x2: 'far' }).kind).toBe('invalid');
    expect(PLAYER_MESSAGE_TYPES.has('door-request')).toBe(true);
  });
});

describe('a tap on a door', () => {
  it('asks the GM only on its badge, near the player\'s own token; the door itself and a drag ask nothing', () => {
    const identity = (point: { x: number; y: number }) => ({ x: point.x, y: point.y });
    const moves = new TokenMoves({ toWorld: identity, send: () => true, onChange: () => undefined });
    const asked: PlayerDoor[] = [];
    const tools = new PlayerTools({
      moves, toWorld: identity, zoom: () => 1, now: () => Date.now(), sendLaser: () => true, onChange: () => undefined,
      sendDoorRequest: (door) => { asked.push(door); return true; },
    });
    const door: PlayerDoor = { x1: 500, y1: 100, x2: 500, y2: 170, open: false };
    const show = (x: number) => {
      const scene = playerScene({ doors: [door], tokens: { t1: playerToken({ x, y: 135 }) } });
      moves.setScene(scene);
      tools.setScene(scene);
    };
    show(400);
    moves.setControlled(['t1']);
    moves.setConnected(true);
    tools.setConnected(true);
    // On the door, off its badge.
    expect(tools.grab({ x: 500, y: 104 }, 'mouse')).toBe(false);
    expect(tools.grab({ x: 505, y: 138 }, 'mouse')).toBe(true);
    tools.tap({ x: 505, y: 138 });
    expect(asked).toEqual([door]);
    tools.grab({ x: 505, y: 138 }, 'mouse');
    tools.drop({ x: 505, y: 300 });
    tools.tap({ x: 505, y: 138 });
    expect(asked).toHaveLength(1);
    // Over two squares away, the door has no badge to tap.
    show(200);
    expect(tools.grab({ x: 505, y: 138 }, 'mouse')).toBe(false);
  });
});

describe('a closed door', () => {
  it('is seen from the side a token stands on, though sight stops at it', () => {
    // Sight ends at the door's line (x = 500): the cell on it is half dark, the one before it seen.
    const state = walled({ a: wall('a', 'door', 500), b: wall('b', 'door', 900) }, true);
    const seen = projectLit(state, ready({ hero: 'seen' }, (x) => x < 496));
    expect(seen.doors).toEqual([{ x1: 500, y1: 300, x2: 500, y2: 370, open: false }]);
  });
});
