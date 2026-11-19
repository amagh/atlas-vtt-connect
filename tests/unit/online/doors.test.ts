import { describe, expect, it } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import { decodeControl } from '../../../src/app/online/protocol';
import { PlayerSceneMirror } from '../../../src/app/online/scene/PlayerSceneMirror';
import { diffScenes } from '../../../src/app/online/scene/sceneDiff';
import { createDoorsLayer, DOOR_WOOD } from '../../../src/app/online/view/layers/doorsLayer';
import { project, projectLit, ready, scene } from './lightingFixtures';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, sceneBody } from './sceneFixtures';

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
      { x1: 600, y1: 300, x2: 600, y2: 370, open: true },
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

  it('draws nothing without doors', () => {
    const surface = new RecordingSurface();
    createDoorsLayer().draw(surface, frame(playerScene()));
    expect(surface.calls).toEqual([]);
  });
});
