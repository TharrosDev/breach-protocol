import type { GadgetId } from './ids';

// Legacy GADGETS (index.html:511-517). Names and descriptions are the legacy wording.
export interface GadgetDef {
  name: string;
  uses: number;
  desc: string;
}

export const GADGETS: Record<GadgetId, GadgetDef> = {
  frag: { name: 'Frag', uses: 2, desc: 'Blast grenade. Hurts everything near it.' },
  flash: { name: 'Flashbang', uses: 2, desc: 'Blinds hostiles in view.' },
  smoke: { name: 'Smoke', uses: 2, desc: 'Cloud that hides you from enemy sight.' },
  medkit: { name: 'Medkit', uses: 2, desc: 'Restores 50 health.' },
  drone: { name: 'Recon Drone', uses: 1, desc: 'Flies ahead and spots hostiles.' },
  claymore: { name: 'Claymore', uses: 2, desc: 'Proximity mine. Blows when a hostile walks near.' },
  stim: { name: 'Stim Shot', uses: 2, desc: 'Run 25% faster and regenerate health for 8 s.' },
};
