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
  SETTINGS_ROOT_GROUPS,
  SETTINGS_ROOT_ITEMS,
  TRAINING_PROFILE_MENU_GROUPS,
  TRAINING_PROFILE_MENU_ITEMS,
  findSettingsRootItem,
  findTrainingProfileMenuItem,
  getTrainingProfileHasErrors,
  getTrainingProfileSectionErrorMap,
  resolveSettingsMenuGroups,
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
  mergeLocalIncompletePainIssues,
  serializePersistableTrainingProfileDraft,
  toTrainingProfilePayload,
} from "./settingsMappers";
import { validateTrainingProfileDraft } from "./settingsValidation";

const AUTOSAVE_DEBOUNCE_MS = 700;
const SAVED_FLASH_MS = 2500;

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

function serializeTrainingProfileDraft(trainingProfileDraft) {
  return serializePersistableTrainingProfileDraft(trainingProfileDraft);
}

function serializeRawTrainingProfileDraft(trainingProfileDraft) {
  return JSON.stringify(trainingProfileDraft || null);
}

export default function SettingsDrawer({ isOpen, onClose }) {
  const [settingsData, setSettingsData] = useState(null);
  const [trainingProfileDraft, setTrainingProfileDraft] = useState(null);
  const [initialTrainingProfileDraft, setInitialTrainingProfileDraft] = useState(null);
  const [navigationStack, setNavigationStack] = useState(createRootNavigationStack);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isAutoSavePending, setIsAutoSavePending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [autosaveError, setAutosaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formErrors, setFormErrors] = useState([]);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const autosaveTimerRef = useRef(null);
  const savedFlashTimerRef = useRef(null);
  const latestDraftRef = useRef(null);
  const inFlightSnapshotRef = useRef("");
  const queuedSnapshotRef = useRef("");
  const lastFailedSnapshotRef = useRef("");
  const closeAfterSaveRef = useRef(false);
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
  const settingsRootGroups = useMemo(
    () => resolveSettingsMenuGroups(SETTINGS_ROOT_GROUPS, SETTINGS_ROOT_ITEMS),
    []
  );
  const trainingProfileMenuGroups = useMemo(
    () => resolveSettingsMenuGroups(TRAINING_PROFILE_MENU_GROUPS, TRAINING_PROFILE_MENU_ITEMS),
    []
  );

  const hasUnsavedChanges = useMemo(
    () =>
      Boolean(trainingProfileDraft) &&
      Boolean(initialTrainingProfileDraft) &&
      !areTrainingProfilesEqual(trainingProfileDraft, initialTrainingProfileDraft),
    [initialTrainingProfileDraft, trainingProfileDraft]
  );

  const autosaveStatus = useMemo(() => {
    if (autosaveError) {
      return { label: "Could not save", tone: "error" };
    }

    if (isAutoSavePending || isAutoSaving) {
      return { label: "Saving...", tone: "neutral" };
    }

    if (showSavedFeedback && lastSavedAt) {
      return { label: "Saved", tone: "success" };
    }

    return null;
  }, [autosaveError, isAutoSavePending, isAutoSaving, lastSavedAt, showSavedFeedback]);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const clearSavedFlashTimer = useCallback(() => {
    if (savedFlashTimerRef.current) {
      window.clearTimeout(savedFlashTimerRef.current);
      savedFlashTimerRef.current = null;
    }
  }, []);

  const showSavedFlash = useCallback(() => {
    clearSavedFlashTimer();
    setShowSavedFeedback(true);
    savedFlashTimerRef.current = window.setTimeout(() => {
      setShowSavedFeedback(false);
      savedFlashTimerRef.current = null;
    }, SAVED_FLASH_MS);
  }, [clearSavedFlashTimer]);

  const clearUiFeedback = useCallback(() => {
    clearSavedFlashTimer();
    setAutosaveError("");
    setShowSavedFeedback(false);
  }, [clearSavedFlashTimer]);

  const clearValidationState = useCallback(() => {
    setFieldErrors({});
    setFormErrors([]);
  }, []);

  const clearAllTimers = useCallback(() => {
    clearAutosaveTimer();
    clearSavedFlashTimer();
  }, [clearAutosaveTimer, clearSavedFlashTimer]);

  const resetAutosaveRuntime = useCallback(() => {
    setIsAutoSavePending(false);
    setIsAutoSaving(false);
    inFlightSnapshotRef.current = "";
    queuedSnapshotRef.current = "";
    lastFailedSnapshotRef.current = "";
    closeAfterSaveRef.current = false;
  }, []);

  const resetToRoot = useCallback(() => {
    setNavigationStack(createRootNavigationStack());
  }, []);

  const finalizeClose = useCallback(() => {
    clearAllTimers();
    resetAutosaveRuntime();
    clearUiFeedback();
    onClose();
  }, [clearAllTimers, clearUiFeedback, onClose, resetAutosaveRuntime]);

  const discardLocalChanges = useCallback(() => {
    if (!initialTrainingProfileDraft) {
      return;
    }

    const baselineDraft = deepClone(initialTrainingProfileDraft);
    latestDraftRef.current = baselineDraft;
    setTrainingProfileDraft(baselineDraft);
    clearValidationState();
    clearUiFeedback();
    setLastSavedAt(null);
    clearAllTimers();
    resetAutosaveRuntime();
  }, [
    clearAllTimers,
    clearUiFeedback,
    clearValidationState,
    initialTrainingProfileDraft,
    resetAutosaveRuntime,
  ]);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    clearAllTimers();
    resetAutosaveRuntime();
    clearValidationState();
    clearUiFeedback();
    setLastSavedAt(null);

    try {
      const response = await getUserSettings();
      const nextDraft = createTrainingProfileDraft(response);

      latestDraftRef.current = nextDraft;
      setSettingsData(response);
      setTrainingProfileDraft(nextDraft);
      setInitialTrainingProfileDraft(deepClone(nextDraft));
      resetToRoot();
    } catch (error) {
      setLoadError(error?.message || "Unable to load settings.");
    } finally {
      setIsLoading(false);
    }
  }, [
    clearAllTimers,
    clearUiFeedback,
    clearValidationState,
    resetAutosaveRuntime,
    resetToRoot,
  ]);

  const runAutosave = useCallback(
    async ({ closeAfterSave = false } = {}) => {
      const currentDraft = latestDraftRef.current;
      const baselineSnapshot = serializeTrainingProfileDraft(initialTrainingProfileDraft);
      const currentSnapshot = serializeTrainingProfileDraft(currentDraft);
      const currentRawSnapshot = serializeRawTrainingProfileDraft(currentDraft);
      const shouldCloseAfterSave = closeAfterSave || closeAfterSaveRef.current;

      clearAutosaveTimer();
      setIsAutoSavePending(false);

      if (!currentDraft || currentSnapshot === baselineSnapshot) {
        if (shouldCloseAfterSave) {
          closeAfterSaveRef.current = false;
          finalizeClose();
        }
        return;
      }

      const validation = validateTrainingProfileDraft(currentDraft);
      if (!validation.ok) {
        if (shouldCloseAfterSave) {
          closeAfterSaveRef.current = false;
        }
        return;
      }

      if (currentSnapshot === lastFailedSnapshotRef.current) {
        if (shouldCloseAfterSave) {
          closeAfterSaveRef.current = false;
        }
        return;
      }

      if (inFlightSnapshotRef.current) {
        queuedSnapshotRef.current = currentSnapshot;
        if (closeAfterSave) {
          closeAfterSaveRef.current = true;
        }
        return;
      }

      if (closeAfterSave) {
        closeAfterSaveRef.current = true;
      }

      inFlightSnapshotRef.current = currentSnapshot;
      setIsAutoSaving(true);
      setAutosaveError("");
      setShowSavedFeedback(false);

      try {
        const response = await updateTrainingProfileSettings(
          toTrainingProfilePayload(currentDraft)
        );
        const responseDraft = createTrainingProfileDraft(response);
        const latestSnapshotNow = serializeTrainingProfileDraft(latestDraftRef.current);
        const latestRawSnapshotNow = serializeRawTrainingProfileDraft(latestDraftRef.current);
        const responseSnapshot = serializeTrainingProfileDraft(responseDraft);
        const hasNewerLocalDraft =
          latestSnapshotNow !== currentSnapshot || latestRawSnapshotNow !== currentRawSnapshot;
        const nextResponseDraft =
          latestRawSnapshotNow !== currentRawSnapshot
            ? mergeLocalIncompletePainIssues(responseDraft, latestDraftRef.current)
            : responseDraft;

        setSettingsData(response);
        setInitialTrainingProfileDraft(deepClone(responseDraft));
        setLastSavedAt(Date.now());
        lastFailedSnapshotRef.current = "";

        if (!hasNewerLocalDraft) {
          latestDraftRef.current = nextResponseDraft;
          setTrainingProfileDraft(nextResponseDraft);
          clearValidationState();
          clearUiFeedback();
          showSavedFlash();

          if (
            closeAfterSaveRef.current &&
            latestSnapshotNow === currentSnapshot &&
            responseSnapshot === serializeTrainingProfileDraft(responseDraft)
          ) {
            closeAfterSaveRef.current = false;
            finalizeClose();
            return;
          }
        } else {
          queuedSnapshotRef.current = latestSnapshotNow;
        }
      } catch (error) {
        const latestSnapshotNow = serializeTrainingProfileDraft(latestDraftRef.current);

        if (latestSnapshotNow === currentSnapshot) {
          const apiErrors = mapApiErrorDetails(error?.details);

          lastFailedSnapshotRef.current = currentSnapshot;
          setAutosaveError(error?.message || "Could not save");
          setShowSavedFeedback(false);
          setFieldErrors(apiErrors.fieldErrors);
          setFormErrors(apiErrors.formErrors);
          closeAfterSaveRef.current = false;
        }
      } finally {
        const nextQueuedSnapshot = queuedSnapshotRef.current;

        inFlightSnapshotRef.current = "";
        queuedSnapshotRef.current = "";
        setIsAutoSaving(false);

        if (
          nextQueuedSnapshot &&
          nextQueuedSnapshot !== serializeTrainingProfileDraft(initialTrainingProfileDraft) &&
          nextQueuedSnapshot !== lastFailedSnapshotRef.current
        ) {
          void runAutosave();
        }
      }
    },
    [
      clearAutosaveTimer,
      clearUiFeedback,
      clearValidationState,
      finalizeClose,
      initialTrainingProfileDraft,
      showSavedFlash,
    ]
  );

  useEffect(() => {
    latestDraftRef.current = trainingProfileDraft;
  }, [trainingProfileDraft]);

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    resetToRoot();
  }, [isOpen, resetToRoot]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!settingsData && !isLoading) {
      loadSettings();
    }
  }, [isLoading, isOpen, loadSettings, settingsData]);

  useEffect(() => {
    if (!isOpen || !trainingProfileDraft || !initialTrainingProfileDraft) {
      clearAutosaveTimer();
      setIsAutoSavePending(false);
      return;
    }

    if (inFlightSnapshotRef.current) {
      clearAutosaveTimer();
      setIsAutoSavePending(false);
      return;
    }

    const currentSnapshot = serializeTrainingProfileDraft(trainingProfileDraft);
    const baselineSnapshot = serializeTrainingProfileDraft(initialTrainingProfileDraft);

    if (currentSnapshot === baselineSnapshot) {
      clearAutosaveTimer();
      setIsAutoSavePending(false);
      return;
    }

    const validation = validateTrainingProfileDraft(trainingProfileDraft);
    if (!validation.ok || currentSnapshot === lastFailedSnapshotRef.current) {
      clearAutosaveTimer();
      setIsAutoSavePending(false);
      return;
    }

    clearAutosaveTimer();
    setIsAutoSavePending(true);
    autosaveTimerRef.current = window.setTimeout(() => {
      void runAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      clearAutosaveTimer();
      setIsAutoSavePending(false);
    };
  }, [
    clearAutosaveTimer,
    initialTrainingProfileDraft,
    isOpen,
    runAutosave,
    trainingProfileDraft,
  ]);

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  function handleDraftChange(nextDraft) {
    const nextSnapshot = serializeTrainingProfileDraft(nextDraft);
    const validation = validateTrainingProfileDraft(nextDraft);

    latestDraftRef.current = nextDraft;
    setTrainingProfileDraft(nextDraft);
    setFieldErrors(validation.fieldErrors);
    setFormErrors(validation.formErrors);
    setAutosaveError("");
    setShowSavedFeedback(false);

    if (inFlightSnapshotRef.current && nextSnapshot !== inFlightSnapshotRef.current) {
      queuedSnapshotRef.current = nextSnapshot;
    }
  }

  function pushScreen(id, params = {}) {
    setNavigationStack((currentStack) => pushScreenEntry(currentStack, id, params));
  }

  function popScreen() {
    setNavigationStack((currentStack) => popScreenEntry(currentStack));
  }

  function requestClose() {
    const validation = validateTrainingProfileDraft(trainingProfileDraft);
    const hasLocalValidationError = Boolean(trainingProfileDraft) && !validation.ok;

    if (!hasUnsavedChanges) {
      finalizeClose();
      return;
    }

    if (hasLocalValidationError || autosaveError) {
      const shouldDiscard = window.confirm(
        "You have changes that could not be saved. Close and discard them?"
      );

      if (!shouldDiscard) {
        return;
      }

      discardLocalChanges();
      finalizeClose();
      return;
    }

    if (isAutoSavePending || isAutoSaving) {
      void runAutosave({ closeAfterSave: true });
      return;
    }

    void runAutosave({ closeAfterSave: true });
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
    if (!isTrainingProfileScreen(currentScreen) || formErrors.length === 0) {
      return null;
    }

    return (
      <StatusBanner tone="error" title="Validation Issues">
        <ul className="list-disc pl-5">
          {formErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </StatusBanner>
    );
  }

  function renderAccountScreen() {
    const profile = settingsData?.account?.profile || {};

    return (
      <SettingsReadonlyScreen
        description="Read-only placeholders stay visible until account editing is available."
        showTitle={false}
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
        description="Read-only for V1. No AI Builder or coaching controls are added here."
        showTitle={false}
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
        description="Timing controls are visible but not editable in this version."
        showTitle={false}
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
      <SettingsReadonlyScreen description="Units are read-only in V1." showTitle={false}>
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
          meta: "Validation issues",
        }
        : autosaveError
          ? {
            meta: "Changes not saved",
          }
          : isAutoSavePending || isAutoSaving
            ? {
              meta: "Saving...",
            }
            : {},
    };

    return (
      <SettingsMenuScreen
        groups={settingsRootGroups}
        itemStateMap={rootItemStateMap}
        onSelect={handleRootItemSelect}
        showTitle={false}
        showIcons
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
          groups={trainingProfileMenuGroups}
          itemStateMap={itemStateMap}
          onSelect={handleTrainingProfileItemSelect}
          showTitle={false}
          showIcons={false}
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
          showTitle={false}
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
            status={autosaveStatus}
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
            <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="min-h-full px-4 py-5 md:px-6 md:py-7">{renderCurrentScreen()}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
