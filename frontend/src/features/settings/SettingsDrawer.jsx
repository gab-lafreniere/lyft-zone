import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../../ui/Button";
import {
  getUserSettings,
  updateTrainingProfileSettings,
} from "../../services/api";
import SettingsMenuScreen from "./SettingsMenuScreen";
import SettingsReadonlyScreen from "./SettingsReadonlyScreen";
import SettingsStackHeader from "./SettingsStackHeader";
import TrainingProfileSectionScreen from "./TrainingProfileSectionScreen";
import {
  SETTINGS_ROOT_ITEMS,
  TRAINING_PROFILE_MENU_ITEMS,
  findSettingsRootItem,
  findTrainingProfileMenuItem,
  getTrainingProfileHasErrors,
  getTrainingProfileSectionErrorMap,
} from "./settingsOptions";
import {
  createRootNavigationStack,
  getCurrentScreen,
  isTrainingProfileScreen,
  popScreenEntry,
  pushScreenEntry,
  SETTINGS_SCREEN_IDS,
} from "./settingsNavigation";
import {
  areTrainingProfilesEqual,
  createTrainingProfileDraft,
  deepClone,
  formatReadonlyValue,
  mapApiErrorDetails,
  toTrainingProfilePayload,
} from "./settingsMappers";
import { validateTrainingProfileDraft } from "./settingsValidation";

function ReadonlyRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0 last:pb-0">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function StatusBanner({ tone = "neutral", title, children }) {
  const toneClasses =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div className={["rounded-[20px] border px-4 py-3", toneClasses].join(" ")}>
      {title ? <p className="text-sm font-bold">{title}</p> : null}
      <div className={title ? "mt-1 text-sm" : "text-sm"}>{children}</div>
    </div>
  );
}

function formatBooleanLabel(value) {
  return value ? "On" : "Off";
}

export default function SettingsDrawer({ isOpen, onClose }) {
  const [settingsData, setSettingsData] = useState(null);
  const [trainingProfileDraft, setTrainingProfileDraft] = useState(null);
  const [initialTrainingProfileDraft, setInitialTrainingProfileDraft] = useState(null);
  const [navigationStack, setNavigationStack] = useState(createRootNavigationStack);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formErrors, setFormErrors] = useState([]);
  const [hasTriedSave, setHasTriedSave] = useState(false);
  const scrollContainerRef = useRef(null);

  const currentScreen = getCurrentScreen(navigationStack);
  const screenParams = currentScreen?.params || {};
  const canGoBack = currentScreen?.id !== SETTINGS_SCREEN_IDS.ROOT;
  const trainingProfileSectionErrorMap = useMemo(
    () => getTrainingProfileSectionErrorMap(fieldErrors),
    [fieldErrors]
  );
  const hasTrainingProfileErrors = useMemo(
    () => getTrainingProfileHasErrors(fieldErrors),
    [fieldErrors]
  );

  const hasUnsavedChanges = useMemo(
    () =>
      Boolean(trainingProfileDraft) &&
      Boolean(initialTrainingProfileDraft) &&
      !areTrainingProfilesEqual(trainingProfileDraft, initialTrainingProfileDraft),
    [initialTrainingProfileDraft, trainingProfileDraft]
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [isOpen, currentScreen?.id, screenParams.sectionId, screenParams.trainingProfileSectionId]);

  const clearFeedbackState = useCallback(() => {
    setFieldErrors({});
    setFormErrors([]);
    setSaveError("");
    setSaveSuccess("");
    setHasTriedSave(false);
  }, []);

  const resetToRoot = useCallback(() => {
    setNavigationStack(createRootNavigationStack());
  }, []);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    clearFeedbackState();

    try {
      const response = await getUserSettings();
      const nextDraft = createTrainingProfileDraft(response);

      setSettingsData(response);
      setTrainingProfileDraft(nextDraft);
      setInitialTrainingProfileDraft(deepClone(nextDraft));
      resetToRoot();
    } catch (error) {
      setLoadError(error?.message || "Unable to load settings.");
    } finally {
      setIsLoading(false);
    }
  }, [clearFeedbackState, resetToRoot]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    resetToRoot();

    if (!settingsData && !isLoading) {
      loadSettings();
    }
  }, [isLoading, isOpen, loadSettings, resetToRoot, settingsData]);

  function handleDraftChange(nextDraft) {
    setTrainingProfileDraft(nextDraft);
    setSaveError("");
    setSaveSuccess("");

    if (hasTriedSave) {
      const validation = validateTrainingProfileDraft(nextDraft);
      setFieldErrors(validation.fieldErrors);
      setFormErrors(validation.formErrors);
      return;
    }

    if (Object.keys(fieldErrors).length > 0 || formErrors.length > 0) {
      setFieldErrors({});
      setFormErrors([]);
    }
  }

  function handleCancelEdits() {
    if (!initialTrainingProfileDraft) {
      return;
    }

    setTrainingProfileDraft(deepClone(initialTrainingProfileDraft));
    clearFeedbackState();
  }

  async function handleSave() {
    if (!trainingProfileDraft) {
      return;
    }

    setHasTriedSave(true);
    setSaveError("");
    setSaveSuccess("");

    const validation = validateTrainingProfileDraft(trainingProfileDraft);
    setFieldErrors(validation.fieldErrors);
    setFormErrors(validation.formErrors);

    if (!validation.ok) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await updateTrainingProfileSettings(
        toTrainingProfilePayload(trainingProfileDraft)
      );
      const nextDraft = createTrainingProfileDraft(response);

      setSettingsData(response);
      setTrainingProfileDraft(nextDraft);
      setInitialTrainingProfileDraft(deepClone(nextDraft));
      setFieldErrors({});
      setFormErrors([]);
      setSaveSuccess("Training profile saved.");
      setHasTriedSave(false);
    } catch (error) {
      const apiErrors = mapApiErrorDetails(error?.details);

      setSaveError(error?.message || "Unable to save training profile.");
      setFieldErrors(apiErrors.fieldErrors);
      setFormErrors(apiErrors.formErrors);
    } finally {
      setIsSaving(false);
    }
  }

  function pushScreen(id, params = {}) {
    setNavigationStack((currentStack) => pushScreenEntry(currentStack, id, params));
  }

  function popScreen() {
    setNavigationStack((currentStack) => popScreenEntry(currentStack));
  }

  function requestClose() {
    if (isSaving) {
      return;
    }

    if (hasUnsavedChanges) {
      const shouldDiscard = window.confirm("Discard unsaved changes?");

      if (!shouldDiscard) {
        return;
      }

      if (initialTrainingProfileDraft) {
        setTrainingProfileDraft(deepClone(initialTrainingProfileDraft));
      }
    }

    clearFeedbackState();
    resetToRoot();
    onClose();
  }

  function handleRootItemSelect(item) {
    if (item.screenId === SETTINGS_SCREEN_IDS.TRAINING_PROFILE_MENU) {
      pushScreen(item.screenId);
      return;
    }

    pushScreen(item.screenId, { sectionId: item.id });
  }

  function handleTrainingProfileItemSelect(item) {
    pushScreen(item.screenId, { trainingProfileSectionId: item.id });
  }

  function renderTrainingProfileFeedback() {
    if (!isTrainingProfileScreen(currentScreen)) {
      return null;
    }

    return (
      <div className="space-y-3">
        {saveSuccess ? (
          <StatusBanner tone="success" title="Saved">
            {saveSuccess}
          </StatusBanner>
        ) : null}

        {saveError ? (
          <StatusBanner tone="error" title="Save Error">
            {saveError}
          </StatusBanner>
        ) : null}

        {formErrors.length > 0 ? (
          <StatusBanner tone="error" title="Validation Issues">
            <ul className="list-disc pl-5">
              {formErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </StatusBanner>
        ) : null}
      </div>
    );
  }

  function renderAccountScreen() {
    const profile = settingsData?.account?.profile || {};

    return (
      <SettingsReadonlyScreen
        eyebrow="Settings"
        title="Account"
        description="Read-only placeholders stay visible until account editing is available."
      >
        <div className="mb-5 flex items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
            <span className="material-symbols-outlined text-3xl">person</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {formatReadonlyValue(profile.name)}
            </p>
            <p className="text-sm text-slate-500">{formatReadonlyValue(profile.email)}</p>
          </div>
        </div>

        <dl>
          <ReadonlyRow label="Name" value={formatReadonlyValue(profile.name)} />
          <ReadonlyRow label="Email" value={formatReadonlyValue(profile.email)} />
          <ReadonlyRow label="Username" value={formatReadonlyValue(profile.username)} />
          <ReadonlyRow
            label="Profile Picture"
            value={formatReadonlyValue(profile.profilePicture)}
          />
        </dl>
      </SettingsReadonlyScreen>
    );
  }

  function renderAiCoachingScreen() {
    const aiCoaching = settingsData?.aiCoaching || {};

    return (
      <SettingsReadonlyScreen
        eyebrow="Settings"
        title="AI Coaching"
        description="Read-only for V1. No AI Builder or coaching controls are added here."
      >
        <dl>
          <ReadonlyRow label="Mode" value={formatReadonlyValue(aiCoaching.mode)} />
          <ReadonlyRow
            label="Autonomy Level"
            value={formatReadonlyValue(aiCoaching.autonomyLevel)}
          />
        </dl>
      </SettingsReadonlyScreen>
    );
  }

  function renderWorkoutExperienceScreen() {
    const workoutExperience = settingsData?.workoutExperience || {};

    return (
      <SettingsReadonlyScreen
        eyebrow="Settings"
        title="Workout Experience"
        description="Timing controls are visible but not editable in this version."
      >
        <dl>
          <ReadonlyRow
            label="Default Rest Timer"
            value={formatReadonlyValue(workoutExperience.defaultRestTimer)}
          />
          <ReadonlyRow
            label="Sound / Vibration Alerts"
            value={formatBooleanLabel(Boolean(workoutExperience.soundVibrationAlerts))}
          />
        </dl>
      </SettingsReadonlyScreen>
    );
  }

  function renderInterfaceScreen() {
    const units = settingsData?.interface?.units || {};

    return (
      <SettingsReadonlyScreen
        eyebrow="Settings"
        title="Interface"
        description="Units are read-only in V1."
      >
        <dl>
          <ReadonlyRow label="Weight Unit" value={formatReadonlyValue(units.weight)} />
          <ReadonlyRow label="Height Unit" value={formatReadonlyValue(units.height)} />
        </dl>
      </SettingsReadonlyScreen>
    );
  }

  function renderSettingsSectionScreen() {
    switch (screenParams.sectionId) {
      case "account":
        return renderAccountScreen();
      case "aiCoaching":
        return renderAiCoachingScreen();
      case "workoutExperience":
        return renderWorkoutExperienceScreen();
      case "interface":
        return renderInterfaceScreen();
      default:
        return null;
    }
  }

  function renderRootScreen() {
    const rootItemStateMap = {
      trainingProfile: hasTrainingProfileErrors
        ? {
            badge: "Error",
            meta: hasUnsavedChanges ? "Unsaved changes and validation issues" : "Validation issues",
          }
        : hasUnsavedChanges
          ? {
              meta: "Unsaved changes",
            }
          : {},
    };

    return (
      <SettingsMenuScreen
        eyebrow="Settings"
        title="Settings"
        description="Move through each area like a focused mobile app, without losing your current draft."
        items={SETTINGS_ROOT_ITEMS}
        itemStateMap={rootItemStateMap}
        onSelect={handleRootItemSelect}
      />
    );
  }

  function renderTrainingProfileMenuScreen() {
    const itemStateMap = TRAINING_PROFILE_MENU_ITEMS.reduce((accumulator, item) => {
      accumulator[item.id] = trainingProfileSectionErrorMap[item.id]
        ? { badge: "Error" }
        : {};
      return accumulator;
    }, {});

    return (
      <div className="space-y-6">
        {renderTrainingProfileFeedback()}
        <SettingsMenuScreen
          eyebrow="Training Profile"
          title="Training Profile"
          description="Each section opens as its own focused screen while keeping one shared draft and one shared save flow."
          items={TRAINING_PROFILE_MENU_ITEMS}
          itemStateMap={itemStateMap}
          onSelect={handleTrainingProfileItemSelect}
        />
      </div>
    );
  }

  function renderTrainingProfileSectionScreen() {
    const currentItem = findTrainingProfileMenuItem(screenParams.trainingProfileSectionId);

    if (!currentItem) {
      return null;
    }

    return (
      <div className="space-y-6">
        {renderTrainingProfileFeedback()}
        <TrainingProfileSectionScreen
          title={currentItem.label}
          description={currentItem.description}
          sectionId={currentItem.id}
          draft={trainingProfileDraft}
          onChange={handleDraftChange}
          fieldErrors={fieldErrors}
        />
      </div>
    );
  }

  function renderCurrentScreen() {
    switch (currentScreen?.id) {
      case SETTINGS_SCREEN_IDS.SECTION:
        return renderSettingsSectionScreen();
      case SETTINGS_SCREEN_IDS.TRAINING_PROFILE_MENU:
        return renderTrainingProfileMenuScreen();
      case SETTINGS_SCREEN_IDS.TRAINING_PROFILE_SECTION:
        return renderTrainingProfileSectionScreen();
      case SETTINGS_SCREEN_IDS.ROOT:
      default:
        return renderRootScreen();
    }
  }

  function getHeaderCopy() {
    if (currentScreen?.id === SETTINGS_SCREEN_IDS.TRAINING_PROFILE_SECTION) {
      const item = findTrainingProfileMenuItem(screenParams.trainingProfileSectionId);
      return {
        eyebrow: "Training Profile",
        title: item?.label || "Training Profile",
      };
    }

    if (currentScreen?.id === SETTINGS_SCREEN_IDS.TRAINING_PROFILE_MENU) {
      return {
        eyebrow: "Settings",
        title: "Training Profile",
      };
    }

    if (currentScreen?.id === SETTINGS_SCREEN_IDS.SECTION) {
      const item = findSettingsRootItem(screenParams.sectionId);
      return {
        eyebrow: "Settings",
        title: item?.label || "Settings",
      };
    }

    return {
      eyebrow: "Settings",
      title: "Settings",
    };
  }

  const headerCopy = getHeaderCopy();
  const showTrainingProfileFooter = isTrainingProfileScreen(currentScreen) && trainingProfileDraft;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        aria-label="Close settings overlay"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={requestClose}
      />

      <div className="absolute inset-0 bg-white shadow-2xl md:inset-4 md:mx-auto md:max-w-3xl md:rounded-3xl">
        <div className="flex h-full flex-col overflow-hidden">
          <SettingsStackHeader
            eyebrow={headerCopy.eyebrow}
            title={headerCopy.title}
            canGoBack={canGoBack}
            onBack={popScreen}
            onClose={requestClose}
          />

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="text-center">
                <div className="mx-auto mb-3 size-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
                <p className="text-sm font-medium text-slate-500">Loading settings...</p>
              </div>
            </div>
          ) : loadError ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div>
                  <p className="text-lg font-bold text-slate-900">Unable to load settings</p>
                  <p className="mt-2 text-sm text-slate-500">{loadError}</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={requestClose}>
                    Close
                  </Button>
                  <Button className="flex-1" onClick={loadSettings}>
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="min-h-full px-4 py-5 pb-32 md:px-6 md:py-7 md:pb-36">
                  {renderCurrentScreen()}
                </div>
              </div>

              {showTrainingProfileFooter ? (
                <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="text-xs font-medium text-slate-500">
                      {hasUnsavedChanges ? "You have unsaved changes." : "No unsaved changes."}
                    </div>

                    <div className="flex flex-col gap-3 md:flex-row">
                      <Button
                        variant="secondary"
                        onClick={handleCancelEdits}
                        disabled={!hasUnsavedChanges || isSaving}
                        className="w-full md:w-auto"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleSave}
                        disabled={!hasUnsavedChanges || isSaving}
                        className="w-full md:w-auto"
                      >
                        {isSaving ? (
                          <>
                            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Saving...
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
