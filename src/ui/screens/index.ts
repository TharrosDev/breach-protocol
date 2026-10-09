// Entry point for the Phase 5 menu screens. Each factory returns a ScreenHandle plus its element. The caller appends
// the elements to the page once, then moves between them with show() and hide(). The stylesheet loads with the screens.
import './screens.css';

export { createMenuScreen, type MenuOptions, type MenuScreen } from './menu';
export { createBriefScreen, type BriefOptions, type BriefScreen } from './brief';
export { createLoadoutScreen, type LoadoutOptions, type LoadoutScreen } from './loadout';
export {
  createSettingsScreen,
  type SettingsChange,
  type SettingsOptions,
  type SettingsScreen,
} from './settings';
export { createPauseScreen, type PauseOptions, type PauseScreen } from './pause';
export { createDebriefScreen, type DebriefOptions, type DebriefScreen } from './debrief';

export {
  applyRebind,
  calcCmAds,
  calcCmPer360,
  calcText,
  controlRows,
  debriefHeading,
  keyLabel,
  loadoutGadgetToggle,
  loadoutTiles,
  scoreLineSample,
  tileValues,
  winConditionText,
  type BindingMap,
  type DebriefInput,
  type FocusLike,
} from './model';
