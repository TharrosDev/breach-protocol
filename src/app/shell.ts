// App shell (plan Phase 5). Mounts every screen once on the page root and runs the flow between them:
// menu -> brief -> play -> pause (settings) -> debrief -> menu. It owns the live settings and bindings, applies the
// colour-blind palette to <html>, and starts and stops the match (app/game.ts), which runs in the stage element.
import '../ui/tokens.css';
import '../ui/hud/hud.css';
import './shell.css';
import type { MatchResult } from '../sim/match';
import type { Loadout, Settings } from '../persist/schema';
import {
  loadBindings,
  loadLoadout,
  loadProfile,
  loadSettings,
  saveProfile,
  saveSettings,
} from '../persist/store';
import type { Profile } from '../persist/profile';
import { rankFromXp } from '../content/progression';
import { dayKey } from '../progress/challenges';
import { applyMatch, profileForDay, type MatchReport } from '../progress/career';
import type { MatchStats } from '../progress/tally';
import { enforceUnlocks } from '../progress/unlocks';
import { startPadNav } from '../input/pad-nav';
import { Bindings } from '../input/bindings';
import { createFocusScope } from '../ui/focus';
import type { FocusScope, ScreenHandle } from '../ui/contracts';
import {
  createBriefScreen,
  createCareerScreen,
  createDebriefScreen,
  createLoadoutScreen,
  createMenuScreen,
  createPauseScreen,
  createSettingsScreen,
  type SettingsChange,
} from '../ui/screens';
import type { FocusLike } from '../ui/screens/model';
import type { GameHandle, LiveSettings } from './game';
import { AppSound } from './sound';

// A screen is built before its element exists, so its focus scope is bound right after the factory returns. Until
// then the screen gets a stand-in. Escape is handled by each screen (screens/index.ts), so the scope's handler is a
// no-op and Escape is not bound twice.
function deferredFocus(): { focus: FocusLike; bind(element: HTMLElement): void } {
  let scope: FocusScope | null = null;
  return {
    focus: {
      activate: () => {
        scope?.activate();
      },
      deactivate: () => {
        scope?.deactivate();
      },
      focusFirst: () => {
        scope?.focusFirst();
      },
    },
    bind: (element) => {
      scope = createFocusScope(element, {
        onEscape: () => {
          // Handled by the screen (see the note above).
        },
      });
    },
  };
}

// The match code (the renderer, Three.js and every effect) is a separate chunk, loaded the first time it is needed and
// fetched in the background once the menu is up. The menu itself needs none of it, so the page is interactive sooner.
let gameModule: Promise<typeof import('./game')> | null = null;
function loadGame(): Promise<typeof import('./game')> {
  gameModule ??= import('./game').catch((err: unknown) => {
    // Let the next launch try again.
    gameModule = null;
    throw err;
  });
  return gameModule;
}

function liveFrom(settings: Settings, bindings: Bindings): LiveSettings {
  return { settings, bindings };
}

// The colour-blind palette is a token switch on <html> (tokens.css). The HUD root keeps its own attribute in sync
// through the match (game.ts).
function applyColour(doc: Document, settings: Settings): void {
  doc.documentElement.dataset.colour = settings.colorblind ? 'colourblind' : 'normal';
  // Reduced motion also turns off the screen transitions (shell.css).
  doc.documentElement.dataset.motion = settings.reducedMotion ? 'reduced' : 'normal';
}

export function mountShell(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const stage = doc.createElement('div');
  stage.className = 'stage';
  root.replaceChildren(stage);

  let live = liveFrom(loadSettings(), new Bindings(loadBindings()));
  applyColour(doc, live.settings);
  // One sound per page. Its graph is made on the first gesture (see onFirstGesture below).
  const sound = new AppSound(live.settings);
  let game: GameHandle | null = null;
  // The profile (XP, stats, challenges). The challenge list rolls over when the local date changes.
  const today = (): string => dayKey(new Date());
  let profile: Profile = profileForDay(loadProfile(), today());
  const rank = (): number => rankFromXp(profile.xp).rank;
  // The saved loadout, with anything the rank has not unlocked yet put back to the defaults.
  const currentLoadout = (): Loadout => enforceUnlocks(loadLoadout(), rank());
  let settingsOpenedFrom: 'menu' | 'pause' = 'menu';

  // Each screen is mounted once, appended to the page root, and never rebuilt. The handlers below only run on user
  // input, after every screen exists, so they may refer to screens declared further down.
  const mount = <S extends ScreenHandle & { readonly element: HTMLElement }>(
    make: (focus: FocusLike) => S,
  ): S => {
    const deferred = deferredFocus();
    const screen = make(deferred.focus);
    deferred.bind(screen.element);
    root.append(screen.element);
    return screen;
  };

  const menu = mount((focus) =>
    createMenuScreen({
      loadout: currentLoadout(),
      bindings: live.bindings.toJSON(),
      profile,
      day: today,
      onCareer: () => {
        openCareer();
      },
      onDeploy: () => {
        openBrief();
      },
      onLoadout: () => {
        openLoadout();
      },
      onSettings: () => {
        openSettings('menu');
      },
      focus,
    }),
  );
  const brief = mount((focus) =>
    createBriefScreen({
      loadout: currentLoadout(),
      onLaunch: () => {
        startMatch();
      },
      onBack: () => {
        openMenu();
      },
      focus,
    }),
  );
  const loadout = mount((focus) =>
    createLoadoutScreen({
      loadout: currentLoadout(),
      profile,
      onDone: () => {
        openMenu();
      },
      focus,
    }),
  );
  const career = mount((focus) =>
    createCareerScreen({
      profile,
      day: today,
      onBack: () => {
        openMenu();
      },
      focus,
    }),
  );
  const settings = mount((focus) =>
    createSettingsScreen({
      settings: live.settings,
      bindings: live.bindings.toJSON(),
      onBack: () => {
        if (settingsOpenedFrom === 'pause') openPause();
        else openMenu();
      },
      onChange: (next: SettingsChange) => {
        live = liveFrom(next.settings, new Bindings(next.bindings));
        applyColour(doc, live.settings);
        // Volume and mute take effect at once, on the master bus.
        sound.setLevels(live.settings);
      },
      focus,
    }),
  );
  const pause = mount((focus) =>
    createPauseScreen({
      loadout: currentLoadout(),
      onResume: () => {
        game?.resume();
      },
      onSettings: () => {
        openSettings('pause');
      },
      onAbort: () => {
        abortMatch();
      },
      focus,
    }),
  );
  const debrief = mount((focus) =>
    createDebriefScreen({
      onRedeploy: () => {
        startMatch();
      },
      onMenu: () => {
        abortMatch();
      },
      focus,
    }),
  );

  const all: readonly ScreenHandle[] = [menu, brief, loadout, career, settings, pause, debrief];

  // Shows one screen and hides the others. A null target hides them all (the match is on screen).
  function showScreen(target: ScreenHandle | null): void {
    for (const s of all) {
      if (s !== target && s.visible) s.hide();
    }
    target?.show();
  }

  function openMenu(): void {
    menu.refresh({ loadout: currentLoadout(), bindings: live.bindings.toJSON(), profile });
    showScreen(menu);
  }

  function openBrief(): void {
    brief.refresh(currentLoadout());
    showScreen(brief);
  }

  function openLoadout(): void {
    loadout.refresh(loadLoadout(), profile);
    showScreen(loadout);
  }

  function openCareer(): void {
    career.refresh(profile);
    showScreen(career);
  }

  function openSettings(from: 'menu' | 'pause'): void {
    settingsOpenedFrom = from;
    settings.refresh({ settings: live.settings, bindings: live.bindings.toJSON() });
    showScreen(settings);
  }

  function openPause(): void {
    pause.refresh(currentLoadout());
    showScreen(pause);
  }

  // Changes saved by the match itself (the auto-downgrade) go through here, so the live copy and storage agree.
  function patchSettings(patch: Partial<Settings>): void {
    const next = { ...live.settings, ...patch };
    saveSettings(next);
    live = liveFrom(next, live.bindings);
    applyColour(doc, next);
  }

  // A finished match pays XP: the profile is updated and saved, and the debrief shows what it earned.
  function onMatchOver(result: MatchResult, stats: MatchStats): void {
    let report: MatchReport | null = null;
    try {
      const applied = applyMatch(profile, stats, today());
      profile = applied.profile;
      report = applied.report;
      saveProfile(profile);
    } catch (err) {
      // Progress must never stop the debrief from showing.
      console.warn('Could not record match progress.', err);
    }
    showScreen(null);
    debrief.present(result, report);
  }

  // Bumped by every launch and abort, so a slow chunk load cannot start a match the player has already left.
  let launchId = 0;

  function startMatch(): void {
    game?.dispose();
    game = null;
    showScreen(null);
    launchId += 1;
    const mine = launchId;
    const loadout = currentLoadout();
    loadGame()
      .then(({ startGame }) => {
        if (mine !== launchId) return;
        game = startGame(stage, {
          debug: new URLSearchParams(location.search).has('debug'),
          loadout,
          live: () => live,
          patchSettings,
          sound,
          onPause: () => {
            openPause();
          },
          onResume: () => {
            showScreen(null);
          },
          onOver: onMatchOver,
        });
      })
      .catch((err: unknown) => {
        console.error('The match could not start.', err);
        if (mine === launchId) openMenu();
      });
  }

  function abortMatch(): void {
    launchId += 1;
    game?.dispose();
    game = null;
    openMenu();
  }

  // A click or key press on the page makes the audio graph (the first call only), and resumes it while it is not
  // running. The menu is the first screen, so in practice that is a menu or brief gesture.
  const onGesture = (): void => {
    sound.unlock();
  };
  root.addEventListener('pointerdown', onGesture, true);
  root.addEventListener('keydown', onGesture, true);

  // Gamepad menu navigation runs whenever no match is in play.
  startPadNav(window, () => game === null || game.state() !== 'play');

  openMenu();

  // Fetch the match chunk while the player reads the menu, so Launch does not wait for it. A failure here is ignored:
  // Launch tries again and reports it.
  const prefetch = (): void => {
    void loadGame().catch(() => undefined);
  };
  // requestIdleCallback is missing in some browsers (Safari), hence the check on the window object.
  const idleHost: { requestIdleCallback?: (cb: () => void) => number } = window;
  if (idleHost.requestIdleCallback !== undefined) idleHost.requestIdleCallback(prefetch);
  else window.setTimeout(prefetch, 600);
}
