import type { MapId } from '../ids';
import { COMPOUND } from './compound';
import { SUBSTATION } from './substation';
import type { MapDef } from './types';

export const MAPS: Record<MapId, MapDef> = {
  compound: COMPOUND,
  substation: SUBSTATION,
};

export function getMap(id: MapId): MapDef {
  return MAPS[id];
}

// Brief-screen text. Legacy index.html:536 and index.html:551. MapDef has no description field.
export const MAP_DESCRIPTIONS: Record<MapId, string> = {
  compound: 'Three buildings, breachable walls, tight lanes.',
  substation: 'Open yard, shipping containers, a control hall, night.',
};
