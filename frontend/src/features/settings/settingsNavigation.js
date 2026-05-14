export const SETTINGS_SCREEN_IDS = {
  ROOT: "settings-root",
  SECTION: "settings-section",
  TRAINING_PROFILE_MENU: "training-profile-menu",
  TRAINING_PROFILE_SECTION: "training-profile-section",
};

export function createScreen(id, params = {}) {
  return { id, params };
}

export function createRootNavigationStack() {
  return [createScreen(SETTINGS_SCREEN_IDS.ROOT)];
}

export function getCurrentScreen(navigationStack) {
  if (!Array.isArray(navigationStack) || navigationStack.length === 0) {
    return createScreen(SETTINGS_SCREEN_IDS.ROOT);
  }

  return navigationStack[navigationStack.length - 1];
}

export function pushScreenEntry(navigationStack, id, params = {}) {
  return [...(navigationStack || createRootNavigationStack()), createScreen(id, params)];
}

export function popScreenEntry(navigationStack) {
  if (!Array.isArray(navigationStack) || navigationStack.length <= 1) {
    return createRootNavigationStack();
  }

  return navigationStack.slice(0, -1);
}

export function isTrainingProfileScreen(screen) {
  return (
    screen?.id === SETTINGS_SCREEN_IDS.TRAINING_PROFILE_MENU ||
    screen?.id === SETTINGS_SCREEN_IDS.TRAINING_PROFILE_SECTION
  );
}
