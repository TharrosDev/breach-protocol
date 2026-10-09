// App shell (plan Phase 5). Mounts every screen once on the page root and runs the flow between them:
// menu -> brief -> play -> pause (settings) -> debrief -> menu. It owns the live settings and bindings, applies the
// colour-blind palette to <html>, and starts and stops the match (app/game.ts), which runs in the stage element.
import '../ui/tokens.css';
import '../ui/hud/hud.css';
import './shell.css';
import type { MatchResult } from '../sim/match';
import type { Settings } from '../persist/schema';
import { loadBindings, loadLoadout, loadSettings, saveSettings } from '../persist/store';
import { Bindings } from '../input/bindings';
import { createFocusScope } from '../ui/focus';
import type { FocusScope, ScreenHandle } from '../ui/contracts';
import {
  createBriefScreen,
  createDebriefScreen,
  createLoadoutScreen,
  createMenuScreen,
  createPauseScreen,
  createSettingsScreen,
  type SettingsChange,
} from '../ui/screens';
import type { FocusLike } from '../ui/screens/model';
import { startGame, type GameHandle, type LiveSettings } from './game';

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

function liveFrom(settings: Settings, bindings: Bindings): LiveSettings {
  return { settings, bindings };
}

// The colour-blind palette is a token switch on <html> (tokens.css). The HUD root keeps its own attribute in sync
// through the match (game.ts).
function applyColour(doc: Document, settings: Settings): void {
  doc.documentElement.dataset.colour = settings.colorblind ? 'colourblind' : 'normal';
}

export function mountShell(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const stage = doc.createElement('div');
  stage.className = 'stage';
  root.replaceChildren(stage);

  let live = liveFrom(loadSettings(), new Bindings(loadBindings()));
  applyColour(doc, live.settings);
  let game: GameHandle | null = null;
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
      loadout: loadLoadout(),
      bindings: live.bindings.toJSON(),
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
      loadout: loadLoadout(),
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
      loadout: loadLoadout(),
      onDone: () => {
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
      },
      focus,
    }),
  );
  const pause = mount((focus) =>
    createPauseScreen({
      loadout: loadLoadout(),
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

  const all: readonly ScreenHandle[] = [menu, brief, loadout, settings, pause, debrief];

  // Shows one screen and hides the others. A null target hides them all (the match is on screen).
  function showScreen(target: ScreenHandle | null): void {
    for (const s of all) {
      if (s !== target && s.visible) s.hide();
    }
    target?.show();
  }

  function openMenu(): void {
    menu.refresh({ loadout: loadLoadout(), bindings: live.bindings.toJSON() });
    showScreen(menu);
  }

  function openBrief(): void {
    brief.refresh(loadLoadout());
    showScreen(brief);
  }

  function openLoadout(): void {
    loadout.refresh(loadLoadout());
    showScreen(loadout);
  }

  function openSettings(from: 'menu' | 'pause'): void {
    settingsOpenedFrom = from;
    settings.refresh({ settings: live.settings, bindings: live.bindings.toJSON() });
    showScreen(settings);
  }

  function openPause(): void {
    pause.refresh(loadLoadout());
    showScreen(pause);
  }

  // Changes saved by the match itself (the auto-downgrade) go through here, so the live copy and storage agree.
  function patchSettings(patch: Partial<Settings>): void {
    const next = { ...live.settings, ...patch };
    saveSettings(next);
    live = liveFrom(next, live.bindings);
    applyColour(doc, next);
  }

  function onMatchOver(result: MatchResult): void {
    showScreen(null);
    debrief.present(result);
  }

  function startMatch(): void {
    game?.dispose();
    game = null;
    showScreen(null);
    game = startGame(stage, {
      debug: new URLSearchParams(location.search).has('debug'),
      loadout: loadLoadout(),
      live: () => live,
      patchSettings,
      onPause: () => {
        openPause();
      },
      onResume: () => {
        showScreen(null);
      },
      onOver: onMatchOver,
    });
  }

  function abortMatch(): void {
    game?.dispose();
    game = null;
    openMenu();
  }

  openMenu();
}
