import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import SettingsDrawer from "../features/settings/SettingsDrawer";
import AIBuilderResult from "../features/weeklyPlans/aiBuilder/AIBuilderResult";
import { isAIWeeklyPlanFrontendEnabled } from "../features/weeklyPlans/featureFlags";
import { resolveBackTarget } from "../features/weeklyPlans/navigation";
import { getWeeklyPlansPath } from "../features/weeklyPlans/routes";
import {
  createAIWeeklyPlanDraft,
  getUserSettings,
  updateTrainingProfileAvailability,
} from "../services/api";
import Button from "../ui/Button";

const LOADING_MESSAGE_INTERVAL_MS = 3500;
const EMPTY_AVAILABILITY_OPTIONS = Object.freeze({});
const EMPTY_AVAILABILITY_VALUES = Object.freeze([]);

const LOADING_MESSAGES = [
  "Analyzing your Training Profile",
  "Selecting compatible exercises",
  "Organizing your sessions",
  "Checking volume and duration",
  "Reviewing program quality",
];

const PROFILE_ERROR_MESSAGES = {
  PROFILE_NOT_READY:
    "Complete your Training Profile before generating a program.",
  UNSUPPORTED_PROFILE_SCHEMA_VERSION:
    "Your Training Profile uses a version that is not yet supported. Open it to update your profile.",
  EMPTY_EXERCISE_POOL:
    "No compatible exercises were found for your Training Profile. Review your profile and try again.",
  AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL:
    "Your primary goal is not yet supported by the AI Builder. Review your Training Profile to continue.",
};

const RETRYABLE_ERROR_CODES = new Set([
  "AI_WEEKLY_PLAN_GENERATION_TIMEOUT",
  "AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE",
  "AI_WEEKLY_PLAN_MODEL_UNAVAILABLE",
  "AI_WEEKLY_PLAN_PROVIDER_RATE_LIMITED",
  "AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE",
  "AI_WEEKLY_PLAN_INVALID_OUTPUT",
  "AI_WEEKLY_PLAN_REPAIR_FAILED",
]);

const VALUE_LABELS = {
  HYPERTROPHY: "Hypertrophy",
  STRENGTH: "Strength",
  MIXED: "Mixed",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  full_gym: "Full gym",
  commercial_gym: "Commercial gym",
  minimal_home: "Minimal home equipment",
  gym: "Gym",
  home: "Home",
  ai: "AI",
};

function formatProfileValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }

  if (VALUE_LABELS[value]) {
    return VALUE_LABELS[value];
  }

  const normalized = String(value).replaceAll("_", " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getPublicGenerationError(error) {
  const code = error?.code || null;

  if (PROFILE_ERROR_MESSAGES[code]) {
    return {
      kind: "profile",
      message: PROFILE_ERROR_MESSAGES[code],
    };
  }

  if (code === "AI_WEEKLY_PLAN_BUILDER_DISABLED") {
    return {
      kind: "disabled",
      message: "The AI Builder is temporarily unavailable.",
    };
  }

  if (RETRYABLE_ERROR_CODES.has(code)) {
    return {
      kind: "retryable",
      message: "We couldn't finish generating your program. You can try again.",
    };
  }

  if (error?.status === null || error?.status === undefined) {
    return {
      kind: "network",
      message:
        "The connection was interrupted during generation. Your program may still have been created.",
    };
  }

  return {
    kind: "unknown",
    message: "We can't generate your program right now. Try again later.",
  };
}

function getAvailability(settings) {
  const availability = settings?.trainingProfile?.profile?.availability || {};
  return {
    sessionsPerWeek: availability.sessionsPerWeek ?? null,
    durationPerSession: availability.durationPerSession ?? null,
  };
}

function areAvailabilityValuesEqual(left, right) {
  return (
    left?.sessionsPerWeek === right?.sessionsPerWeek &&
    left?.durationPerSession === right?.durationPerSession
  );
}

function getAdjacentValues(allowedValues, currentValue) {
  const values = Array.isArray(allowedValues) ? allowedValues : [];
  const index = values.indexOf(currentValue);

  if (index >= 0) {
    return {
      previous: index > 0 ? values[index - 1] : null,
      next: index < values.length - 1 ? values[index + 1] : null,
      isAllowed: true,
    };
  }

  return {
    previous: values.filter((value) => value < currentValue).at(-1) ?? null,
    next: values.find((value) => value > currentValue) ?? null,
    isAllowed: false,
  };
}

function AvailabilityStepper({
  label,
  value,
  allowedValues,
  onChange,
  disabled,
  formatValue,
}) {
  const adjacent = getAdjacentValues(allowedValues, value);

  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => adjacent.previous != null && onChange(adjacent.previous)}
          disabled={disabled || adjacent.previous == null}
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span className="material-symbols-outlined" aria-hidden="true">remove</span>
        </button>
        <output
          aria-live="polite"
          className="min-w-0 flex-1 text-center text-sm font-bold text-slate-900"
        >
          {formatValue(value)}
        </output>
        <button
          type="button"
          onClick={() => adjacent.next != null && onChange(adjacent.next)}
          disabled={disabled || adjacent.next == null}
          aria-label={`Increase ${label.toLowerCase()}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span className="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
      </div>
      {!adjacent.isAllowed ? (
        <p className="mt-2 text-xs font-medium leading-5 text-amber-700">
          Select an available value before generating.
        </p>
      ) : null}
    </div>
  );
}

function TrainingProfileSummary({
  settingsState,
  draftAvailability,
  availabilityOptions,
  onAvailabilityChange,
  controlsDisabled,
  onRetryLoad,
  onOpenSettings,
}) {
  if (settingsState.status === "loading") {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <div
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
        />
        Loading your Training Profile…
      </div>
    );
  }

  if (settingsState.status === "unavailable") {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-6 text-slate-500">
          We couldn't load your Training Profile.
        </p>
        <Button type="button" variant="secondary" onClick={onRetryLoad}>
          Try loading again
        </Button>
      </div>
    );
  }

  const settings = settingsState.data;
  const profile = settings?.trainingProfile?.profile || {};
  const priorities = profile.musclePriorities || {};
  const environment = profile.environment || {};
  const muscleFocuses = [
    priorities.primaryFocus,
    ...(priorities.secondaryFocuses || []),
  ].filter(Boolean);
  const equipmentValue =
    environment.equipmentPreset ||
    (environment.availableEquipment || []).slice(0, 3).join(", ");

  return (
    <div className="space-y-4">
      {settings?.meta?.hasTrainingProfile === false ? (
        <div className="space-y-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p>
            Your Training Profile is incomplete. Complete it in Settings before
            generating a program.
          </p>
          <Button type="button" variant="secondary" onClick={onOpenSettings}>
            Open Training Profile
          </Button>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Goal
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {formatProfileValue(profile.primaryGoal)}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Experience
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {formatProfileValue(profile.experience)}
          </dd>
        </div>
        <AvailabilityStepper
          label="Sessions per week"
          value={draftAvailability?.sessionsPerWeek}
          allowedValues={availabilityOptions?.sessionsPerWeek}
          onChange={(value) => onAvailabilityChange("sessionsPerWeek", value)}
          disabled={controlsDisabled}
          formatValue={(value) =>
            value == null ? "Not provided" : `${value} sessions per week`
          }
        />
        <AvailabilityStepper
          label="Duration per session"
          value={draftAvailability?.durationPerSession}
          allowedValues={availabilityOptions?.durationPerSession}
          onChange={(value) => onAvailabilityChange("durationPerSession", value)}
          disabled={controlsDisabled}
          formatValue={(value) =>
            value == null ? "Not provided" : `${value} min per session`
          }
        />
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Priorities
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {muscleFocuses.length
              ? muscleFocuses.map(formatProfileValue).join(", ")
              : "Not provided"}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Equipment
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {formatProfileValue(equipmentValue)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function AIWeeklyPlanBuilder() {
  const navigate = useNavigate();
  const location = useLocation();
  const isEnabled = isAIWeeklyPlanFrontendEnabled();
  const [settingsState, setSettingsState] = useState({
    status: "loading",
    data: null,
  });
  const [savedAvailability, setSavedAvailability] = useState(null);
  const [draftAvailability, setDraftAvailability] = useState(null);
  const [submissionStage, setSubmissionStage] = useState(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [generationError, setGenerationError] = useState(null);
  const [generationResult, setGenerationResult] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const loadingTimerRef = useRef(null);
  const settingsRequestIdRef = useRef(0);
  const isSubmitting = submissionStage !== null;
  const availabilityOptions =
    settingsState.data?.trainingProfile?.options?.availability ||
    EMPTY_AVAILABILITY_OPTIONS;
  const sessionsValues =
    availabilityOptions.sessionsPerWeek || EMPTY_AVAILABILITY_VALUES;
  const durationValues =
    availabilityOptions.durationPerSession || EMPTY_AVAILABILITY_VALUES;
  const hasValidAvailability =
    sessionsValues.includes(draftAvailability?.sessionsPerWeek) &&
    durationValues.includes(draftAvailability?.durationPerSession);
  const hasTrainingProfile =
    settingsState.data?.meta?.hasTrainingProfile !== false;
  const canGenerate =
    settingsState.status === "loaded" &&
    hasTrainingProfile &&
    hasValidAvailability &&
    !isSubmitting;

  const backTarget = useMemo(
    () => resolveBackTarget(location, "/program"),
    [location]
  );

  const clearLoadingTimer = useCallback(() => {
    if (loadingTimerRef.current !== null) {
      window.clearInterval(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, []);

  const loadSettings = useCallback(async () => {
    if (!isEnabled) {
      return;
    }

    const requestId = settingsRequestIdRef.current + 1;
    settingsRequestIdRef.current = requestId;

    if (mountedRef.current) {
      setSettingsState({ status: "loading", data: null });
    }

    try {
      const response = await getUserSettings();

      if (
        mountedRef.current &&
        settingsRequestIdRef.current === requestId
      ) {
        setSettingsState({ status: "loaded", data: response });
        const nextAvailability = getAvailability(response);
        setSavedAvailability(nextAvailability);
        setDraftAvailability(nextAvailability);
      }
    } catch {
      if (
        mountedRef.current &&
        settingsRequestIdRef.current === requestId
      ) {
        setSettingsState({ status: "unavailable", data: null });
        setSavedAvailability(null);
        setDraftAvailability(null);
      }
    }
  }, [isEnabled]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      settingsRequestIdRef.current += 1;
      clearLoadingTimer();
    };
  }, [clearLoadingTimer]);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    loadSettings();
  }, [isEnabled, loadSettings]);

  useEffect(() => {
    if (!isSubmitting) {
      return;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSubmitting]);

  const startLoadingMessages = useCallback(() => {
    clearLoadingTimer();
    setLoadingMessageIndex(0);
    loadingTimerRef.current = window.setInterval(() => {
      if (!mountedRef.current) {
        return;
      }

      setLoadingMessageIndex((currentIndex) =>
        Math.min(currentIndex + 1, LOADING_MESSAGES.length - 1)
      );
    }, LOADING_MESSAGE_INTERVAL_MS);
  }, [clearLoadingTimer]);

  const handleGenerate = useCallback(async () => {
    if (!isEnabled || inFlightRef.current) {
      return;
    }

    const selectionsAreValid =
      sessionsValues.includes(draftAvailability?.sessionsPerWeek) &&
      durationValues.includes(draftAvailability?.durationPerSession);
    if (!selectionsAreValid || settingsState.status !== "loaded") {
      setGenerationError({
        kind: "availability",
        message: "Select available session and duration values before generating.",
      });
      return;
    }

    inFlightRef.current = true;
    setGenerationError(null);
    setGenerationResult(null);
    let generationStarted = false;
    let availabilityWasSaved = false;

    try {
      if (!areAvailabilityValuesEqual(savedAvailability, draftAvailability)) {
        setSubmissionStage("saving");
        const settingsResponse = await updateTrainingProfileAvailability({
          sessionsPerWeek: draftAvailability.sessionsPerWeek,
          durationPerSession: draftAvailability.durationPerSession,
        });
        const authoritativeAvailability = getAvailability(settingsResponse);
        availabilityWasSaved = true;

        if (mountedRef.current) {
          setSettingsState({ status: "loaded", data: settingsResponse });
          setSavedAvailability(authoritativeAvailability);
          setDraftAvailability(authoritativeAvailability);
        }
      }

      generationStarted = true;
      setSubmissionStage("generating");
      startLoadingMessages();
      const response = await createAIWeeklyPlanDraft();

      if (mountedRef.current) {
        setGenerationResult(response);
      }
    } catch (error) {
      if (mountedRef.current) {
        if (!generationStarted) {
          setGenerationError({
            kind: "save",
            message:
              "Your Training Profile was not changed, and generation did not start. Review your selections and try again.",
          });
        } else {
          setGenerationError({
            ...getPublicGenerationError(error),
            availabilityWasSaved,
          });
        }
      }
    } finally {
      clearLoadingTimer();
      inFlightRef.current = false;

      if (mountedRef.current) {
        setSubmissionStage(null);
      }
    }
  }, [
    clearLoadingTimer,
    draftAvailability,
    durationValues,
    isEnabled,
    savedAvailability,
    sessionsValues,
    settingsState.status,
    startLoadingMessages,
  ]);

  const handleAvailabilityChange = useCallback((field, value) => {
    setDraftAvailability((current) => ({
      ...(current || {}),
      [field]: value,
    }));
    setGenerationError(null);
    setGenerationResult(null);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    loadSettings();
  }, [loadSettings]);

  if (!isEnabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 py-8">
        <h1 className="text-xl font-semibold tracking-tight">
          AI Weekly Plan Builder
        </h1>
        <p className="text-sm text-ink/70">
          AI weekly plan generation is currently unavailable.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-6 min-h-full bg-background-light text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-background-light/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-slate-700">
              arrow_back
            </span>
          </button>

          <h1 className="text-center text-lg font-bold tracking-tight">
            AI Weekly Plan Builder
          </h1>

          <div className="size-10" aria-hidden="true" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8 pb-12 sm:px-0">
        <p className="text-sm leading-6 text-slate-600">
          AI builds a weekly program from your saved Training Profile. You can
          adjust availability here; changes are saved only when you generate.
        </p>

        <section
          aria-labelledby="training-profile-summary-title"
          className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div>
            <h2
              id="training-profile-summary-title"
              className="text-base font-bold text-slate-900"
            >
              Your Training Profile
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Review the saved details used to build your program.
            </p>
          </div>
          <TrainingProfileSummary
            settingsState={settingsState}
            draftAvailability={draftAvailability}
            availabilityOptions={availabilityOptions}
            onAvailabilityChange={handleAvailabilityChange}
            controlsDisabled={isSubmitting}
            onRetryLoad={loadSettings}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </section>

        {submissionStage === "saving" ? (
          <section
            aria-live="polite"
            aria-busy="true"
            className="rounded-3xl border border-primary/20 bg-white p-6 text-center shadow-sm"
          >
            <div
              aria-hidden="true"
              className="mx-auto size-12 animate-spin rounded-full border-4 border-slate-100 border-t-primary"
            />
            <h2 className="mt-5 text-lg font-bold text-slate-900">
              Saving your availability
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your program will start generating after your Training Profile is updated.
            </p>
            <Button className="mt-5 w-full" disabled aria-label="Saving availability">
              Saving…
            </Button>
          </section>
        ) : submissionStage === "generating" ? (
          <section
            aria-live="polite"
            aria-busy="true"
            className="rounded-3xl border border-primary/20 bg-white p-6 text-center shadow-sm"
          >
            <div
              aria-hidden="true"
              className="mx-auto size-12 animate-spin rounded-full border-4 border-slate-100 border-t-primary"
            />
            <h2 className="mt-5 text-lg font-bold text-slate-900">
              Your program is being prepared
            </h2>
            <p className="mt-2 text-sm font-semibold text-primary">
              {LOADING_MESSAGES[loadingMessageIndex]}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              These messages describe what you’re waiting for; they do not
              represent the backend’s exact technical state.
            </p>
            <Button className="mt-5 w-full" disabled aria-label="Generation in progress">
              Generating…
            </Button>
          </section>
        ) : generationResult ? (
          <AIBuilderResult
            generationResult={generationResult}
            backTarget={backTarget}
          />
        ) : generationError ? (
          <section
            role="alert"
            className="space-y-4 rounded-3xl border border-red-200 bg-white p-5 shadow-sm"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {generationError.kind === "save"
                  ? "We couldn't save your availability"
                  : "Generation interrupted"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {generationError.message}
              </p>
              {generationError.availabilityWasSaved ? (
                <p className="mt-2 text-sm font-medium leading-6 text-emerald-700">
                  Your availability was saved to your Training Profile. You can
                  retry generation without saving it again.
                </p>
              ) : null}
            </div>

            {generationError.kind === "profile" ? (
              <Button className="w-full" onClick={() => setIsSettingsOpen(true)}>
                Review Training Profile
              </Button>
            ) : null}

            {["retryable", "save", "availability"].includes(generationError.kind) ? (
              <Button className="w-full" onClick={handleGenerate}>
                Try again
              </Button>
            ) : null}

            {generationError.kind === "network" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={() => navigate(getWeeklyPlansPath())}>
                  Check my programs
                </Button>
                <Button variant="secondary" onClick={() => navigate(backTarget)}>
                  Back
                </Button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-sm">
            <h2 className="text-lg font-bold">Ready to create your program?</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Your availability changes will be saved when generation starts.
            </p>
            <Button
              className="mt-5 w-full bg-primary"
              onClick={handleGenerate}
              disabled={!canGenerate}
            >
              Generate my program
            </Button>
          </section>
        )}
      </main>

      <SettingsDrawer isOpen={isSettingsOpen} onClose={closeSettings} />
    </div>
  );
}
