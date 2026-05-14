import {
  createRootNavigationStack,
  getCurrentScreen,
  popScreenEntry,
  pushScreenEntry,
  SETTINGS_SCREEN_IDS,
} from "../settingsNavigation";

describe("settingsNavigation", () => {
  test("creates a root stack by default", () => {
    const stack = createRootNavigationStack();

    expect(stack).toEqual([{ id: SETTINGS_SCREEN_IDS.ROOT, params: {} }]);
    expect(getCurrentScreen(stack)).toEqual({ id: SETTINGS_SCREEN_IDS.ROOT, params: {} });
  });

  test("pushes and pops screens without losing root", () => {
    const nextStack = pushScreenEntry(
      createRootNavigationStack(),
      SETTINGS_SCREEN_IDS.TRAINING_PROFILE_MENU
    );

    expect(getCurrentScreen(nextStack)).toEqual({
      id: SETTINGS_SCREEN_IDS.TRAINING_PROFILE_MENU,
      params: {},
    });
    expect(popScreenEntry(nextStack)).toEqual(createRootNavigationStack());
    expect(popScreenEntry(createRootNavigationStack())).toEqual(createRootNavigationStack());
  });
});
