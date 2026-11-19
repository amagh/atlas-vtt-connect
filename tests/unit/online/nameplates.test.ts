import { describe, expect, it } from 'vitest';
import type { InitiativeEntry, SceneSnapshot } from '@atlas-vtt/api-types';
import { UNKNOWN_CREATURE } from '../../../src/app/online/scene/projectPanels';
import { character, project, scene } from './lightingFixtures';

const entry = (tokenId: string, name: string, order: number): InitiativeEntry => ({ id: `e-${tokenId}`, tokenId, name, initiative: 10 - order, initiativeModifier: 0, imagePath: '', isActive: order === 0, isNPC: true, order });

/** An unlit scene with a hero showing its nameplate and a lich not, both in the open initiative list. */
function tavern(mapShowsNameplates?: boolean): SceneSnapshot {
  const base = scene({ enabled: false }, { tokens: { hero: character('hero', 140, 400), lich: character('lich', 280, 400, { name: 'Dread Lich', showNameplate: false }) } });
  return {
    ...base,
    initiativeTrackerOpen: true,
    initiative: { ...base.initiative, isActive: true, entries: [entry('hero', 'hero', 0), entry('lich', 'Dread Lich', 1)] },
    ...(mapShowsNameplates !== undefined ? { tokenSettings: { showNameplates: mapShowsNameplates } } : {}),
  } as SceneSnapshot;
}

describe('nameplates for players', () => {
  it('send a token\'s name only where its nameplate shows, and list a hidden one as an unknown creature', () => {
    const projected = project(tavern(), null);
    expect(projected.tokens.hero?.name).toBe('hero');
    expect(projected.tokens.lich?.name).toBeNull();
    expect(projected.initiative?.entries.map(({ name }) => name)).toEqual(['hero', UNKNOWN_CREATURE]);
  });

  it('show every name where the map shows every nameplate', () => {
    const projected = project(tavern(true), null);
    expect(projected.tokens.lich?.name).toBe('Dread Lich');
    expect(projected.initiative?.entries.map(({ name }) => name)).toEqual(['hero', 'Dread Lich']);
  });

  it('keep a hidden name out of every byte players get', () => {
    expect(JSON.stringify(project(tavern(false), null))).not.toContain('Dread Lich');
  });
});
