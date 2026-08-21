import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  DesignV2Scope,
  MobilePage,
  ProgressIndicator,
  StickyBottomActions,
} from "../../design-v2";
import {
  createAIWeeklyPlanDraft,
  createCycleFromWeeklyPlan,
  ensureCurrentUserId,
  getOnboardingCycleConflicts,
  getUserSettings,
  updateTrainingProfileSettings,
  updateUserOnboarding,
  updateUserProfile,
} from "../../services/api";
import {
  createOnboardingDraft,
  createOnboardingRecovery,
  mergeOnboardingStepIntoCanonical,
  restoreOnboardingSession,
} from "./onboardingDraft";
import { isOnboardingFrontendEnabled } from "./featureFlags";
import { isOnboardingComplete } from "./OnboardingGate";
import {
  clearOnboardingRecovery,
  loadOnboardingRecovery,
  saveOnboardingRecovery,
} from "./onboardingStorage";
import {
  validateAboutYou,
  validateFinalStep,
  hasValidOnboardingCardioRole,
  validateMuscleStep,
  validateSetupStep,
  validateTrainingStep,
} from "./onboardingValidation";
import {
  getCycleBuilderPath,
  getCycleDetailsPath,
} from "../multiWeek/routes";
import { toTrainingProfilePayload } from "../settings/settingsMappers";
import AboutYouStep from "./steps/AboutYouStep";
import AdditionalContextStep from "./steps/AdditionalContextStep";
import MuscleFocusStep from "./steps/MuscleFocusStep";
import ProfileSummaryPanel from "./ProfileSummaryPanel";
import OnboardingConflictModal from "./OnboardingConflictModal";
import OnboardingGenerationLoader from "./OnboardingGenerationLoader";
import OnboardingProgramResult from "./OnboardingProgramResult";
import TrainingSetupStep from "./steps/TrainingSetupStep";
import TrainingStep from "./steps/TrainingStep";
import { buildProfileSummaryItems } from "./profileSummary";
import useOnboardingGenerationProgress from "./useOnboardingGenerationProgress";
import { resolvePreferredTrainingDays } from "./trainingDayDefaults";
import "./onboarding.css";

const TOTAL_STEPS = 5;
const INITIAL_PROGRAM_FLOW = {
  phase: "step",
  generationId: null,
  generationStartedAt: null,
  window: null,
  conflicts: [],
  weeklyPlan: null,
  trainingDays: null,
  cycle: null,
  failedStage: null,
  completionDestination: "result",
  error: "",
};

function createGenerationId() {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `generation_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function resetResultScroll(mainElement) {
  let element = mainElement;
  while (element) {
    element.scrollTop = 0;
    element.scrollLeft = 0;
    element = element.parentElement;
  }
  if (document.scrollingElement) {
    document.scrollingElement.scrollTop = 0;
    document.scrollingElement.scrollLeft = 0;
  }
  window.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
}

function parseRequestedStep(searchParams) {
  const value = Number(searchParams.get("step"));
  return Number.isInteger(value) && value >= 1 && value <= TOTAL_STEPS
    ? value
    : null;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadState, setLoadState] = useState({ status: "loading", error: "" });
  const [userId, setUserId] = useState("");
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [profile, setProfile] = useState(null);
  const [step, setStep] = useState(1);
  const [lastCompletedStep, setLastCompletedStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasMovementLimitations, setHasMovementLimitations] = useState(false);
  const [programFlow, setProgramFlow] = useState(INITIAL_PROGRAM_FLOW);
  const pageMainRef = useRef(null);
  const mountedRef = useRef(true);
  const generationInFlightRef = useRef(false);
  const generationRequestControllerRef = useRef(null);
  const pendingRecoveryRef = useRef(null);
  const recoveryDispatchStartedRef = useRef(false);
  const generationProgress = useOnboardingGenerationProgress(
    programFlow.phase,
    draft?.availability?.sessionsPerWeek,
    draft?.availability?.durationPerSession
  );
  const enabled = isOnboardingFrontendEnabled();
  const availabilityOptions = settings?.trainingProfile?.options?.availability || {
    sessionsPerWeek: [],
    durationPerSession: [],
  };

  const safeSetProgramFlow = useCallback((nextProgramFlow) => {
    if (mountedRef.current) {
      setProgramFlow(nextProgramFlow);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRequestControllerRef.current?.abort();
    };
  }, []);

  const initialize = useCallback(async () => {
    setLoadState({ status: "loading", error: "" });
    try {
      const currentUserId = await ensureCurrentUserId();
      const currentSettings = await getUserSettings();

      if (isOnboardingComplete(currentSettings)) {
        navigate("/", { replace: true });
        return;
      }

      const recovery = loadOnboardingRecovery(currentUserId);
      const session = restoreOnboardingSession(currentSettings, recovery);
      const beginResponse = await updateUserOnboarding({ action: "BEGIN" });
      const begunOnboarding = beginResponse?.onboarding || currentSettings.meta?.onboarding;
      const begunLastCompletedStep = Number(
        Math.max(
          session.lastCompletedStep,
          Number(begunOnboarding?.lastCompletedStep || 0)
        )
      );
      const resumeStep = Math.min(
        TOTAL_STEPS,
        Math.max(session.step, begunLastCompletedStep + 1)
      );

      setUserId(currentUserId);
      setSettings(currentSettings);
      setDraft(session.draft);
      setProfile(session.profile);
      setStep(resumeStep);
      setLastCompletedStep(begunLastCompletedStep);
      setHasMovementLimitations(
        (session.draft?.movementConstraints?.painIssues || []).length > 0 ||
          (session.draft?.movementConstraints?.manualBlockedExerciseIds || []).length > 0
      );
      const recoveredGeneration = recovery?.generation;
      if (recoveredGeneration) {
        const recoveredContext = {
          ...INITIAL_PROGRAM_FLOW,
          generationId: recoveredGeneration.generationId,
          generationStartedAt: recoveredGeneration.startedAt,
          trainingDays: recoveredGeneration.trainingDays,
          window: recoveredGeneration.window || null,
          conflicts: recoveredGeneration.conflicts || [],
          recoveryPhase: recoveredGeneration.phase,
        };
        if (recoveredGeneration.phase === "confirmation") {
          safeSetProgramFlow({ ...recoveredContext, phase: "confirmation" });
        } else {
          pendingRecoveryRef.current = recoveredContext;
          recoveryDispatchStartedRef.current = false;
          safeSetProgramFlow({
            ...recoveredContext,
            phase: recoveredGeneration.phase === "checking"
              ? "checking"
              : "generating",
          });
        }
      }
      navigate(`/onboarding?step=${resumeStep}`, { replace: true });
      setLoadState({ status: "loaded", error: "" });
    } catch (error) {
      setLoadState({
        status: "error",
        error: error?.message || "Unable to start onboarding.",
      });
    }
  }, [navigate, safeSetProgramFlow]);

  useEffect(() => {
    if (enabled) {
      initialize();
    }
  }, [enabled, initialize]);

  useEffect(() => {
    if (
      programFlow.phase === "completing" &&
      generationProgress.completionReady
    ) {
      safeSetProgramFlow((current) => current.phase === "completing"
        ? { ...current, phase: "success" }
        : current);
    }
  }, [generationProgress.completionReady, programFlow.phase, safeSetProgramFlow]);

  useLayoutEffect(() => {
    if (programFlow.phase === "success") {
      resetResultScroll(pageMainRef.current);
    }
  }, [programFlow.phase]);

  useEffect(() => {
    if (loadState.status !== "loaded") {
      return;
    }

    const requestedStep = parseRequestedStep(searchParams);
    const maximumStep = Math.min(TOTAL_STEPS, lastCompletedStep + 1);
    if (requestedStep && requestedStep <= maximumStep) {
      if (requestedStep !== step) {
        setStep(requestedStep);
        setFieldErrors({});
        setSaveError("");
      }
      return;
    }

    setSearchParams({ step: String(step) }, { replace: true });
  }, [lastCompletedStep, loadState.status, searchParams, setSearchParams, step]);

  useEffect(() => {
    if (
      loadState.status === "loaded" &&
      userId &&
      draft &&
      profile &&
      lastCompletedStep < 2
    ) {
      saveOnboardingRecovery(
        userId,
        createOnboardingRecovery({ draft, profile, step })
      );
    }
  }, [draft, lastCompletedStep, loadState.status, profile, step, userId]);

  useEffect(() => {
    if (
      loadState.status !== "loaded" ||
      !pendingRecoveryRef.current ||
      recoveryDispatchStartedRef.current
    ) {
      return;
    }

    recoveryDispatchStartedRef.current = true;
    const recoveredContext = pendingRecoveryRef.current;
    pendingRecoveryRef.current = null;
    generationProgress.reset();
    runGenerationOperation(async () => {
      if (recoveredContext.recoveryPhase === "checking") {
        await checkConflictsAndContinue(recoveredContext);
      } else {
        await generateWeeklyPlan(recoveredContext);
      }
    });
    // Recovery is dispatched once from the state populated by initialize().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState.status]);

  if (!enabled) {
    return <Navigate to="/" replace />;
  }

  function updateDraft(nextDraft) {
    setDraft({ ...nextDraft, primaryGoal: "HYPERTROPHY" });
    setFieldErrors({});
    setSaveError("");
  }

  function updateProfile(nextProfile) {
    setProfile(nextProfile);
    setFieldErrors({});
    setSaveError("");
  }

  function moveToStep(nextStep, completedStep) {
    const nextLastCompletedStep = Math.max(lastCompletedStep, completedStep);
    setLastCompletedStep(nextLastCompletedStep);
    setStep(nextStep);
    setSearchParams({ step: String(nextStep) });
    setFieldErrors({});
    setSaveError("");
  }

  async function saveAboutYou() {
    const validation = validateAboutYou({
      profile,
      experience: draft.experience,
    });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }

    const profilePayload = {
      displayName: profile.displayName,
    };
    if (profile.demographicsStatus !== "LOCKED") {
      profilePayload.age = Number(profile.age);
      profilePayload.sex = profile.sex;
    }

    const response = await updateUserProfile(profilePayload);
    const savedProfile = response.profile || {};
    const nextProfile = {
      ...profile,
      ...savedProfile,
      displayName: savedProfile.displayName || profile.displayName.trim(),
      age: savedProfile.currentAge ?? savedProfile.age ?? profile.age,
      sex: savedProfile.sex || profile.sex,
      demographicsStatus:
        savedProfile.demographicsStatus || profile.demographicsStatus,
    };
    const lifecycleResponse = await updateUserOnboarding({
      action: "ADVANCE",
      lastCompletedStep: 1,
    });

    setProfile(nextProfile);
    moveToStep(2, lifecycleResponse?.onboarding?.lastCompletedStep ?? 1);
  }

  async function saveCanonicalStep(completedStep) {
    let draftToSave = draft;
    if (lastCompletedStep >= 2) {
      const latestSettings = await getUserSettings();
      draftToSave = mergeOnboardingStepIntoCanonical(
        createOnboardingDraft(latestSettings),
        draft,
        completedStep
      );
    }
    const payload = toTrainingProfilePayload(draftToSave);
    const response = await updateTrainingProfileSettings(payload);
    const authoritativeDraft = createOnboardingDraft(response);
    const lifecycleResponse = await updateUserOnboarding({
      action: "ADVANCE",
      lastCompletedStep: completedStep,
    });

    setSettings(response);
    setDraft(authoritativeDraft);
    if (completedStep >= 2) {
      clearOnboardingRecovery(userId);
    }
    moveToStep(
      Math.min(TOTAL_STEPS, completedStep + 1),
      lifecycleResponse?.onboarding?.lastCompletedStep ?? completedStep
    );
  }

  async function saveFinalTrainingProfile() {
    const latestSettings = await getUserSettings();
    const draftToSave = mergeOnboardingStepIntoCanonical(
      createOnboardingDraft(latestSettings),
      draft,
      5
    );
    const payload = toTrainingProfilePayload(draftToSave);
    const response = await updateTrainingProfileSettings(payload);
    const authoritativeDraft = createOnboardingDraft(response);

    if (mountedRef.current) {
      setSettings(response);
      setDraft(authoritativeDraft);
    }
    return response;
  }

  function persistGenerationRecovery(context, phase) {
    if (!userId || !draft || !profile || !context.generationId) {
      return;
    }
    saveOnboardingRecovery(userId, {
      ...createOnboardingRecovery({ draft, profile, step }),
      generation: {
        generationId: context.generationId,
        startedAt: context.generationStartedAt,
        trainingDays: context.trainingDays,
        phase,
        window: context.window,
        conflicts: context.conflicts || [],
      },
    });
  }

  async function runGenerationOperation(operation) {
    if (generationInFlightRef.current) {
      return;
    }
    generationInFlightRef.current = true;
    try {
      await operation();
    } finally {
      generationInFlightRef.current = false;
    }
  }

  async function completeOnboardingLifecycle(context, destination = "result") {
    safeSetProgramFlow({
      ...context,
      phase: "completing",
      failedStage: null,
      completionDestination: destination,
      error: "",
    });
    if (destination === "home") {
      clearOnboardingRecovery(userId);
    } else {
      persistGenerationRecovery(context, "completing");
    }

    try {
      await updateUserOnboarding({ action: "COMPLETE" });
      if (!mountedRef.current) {
        return;
      }
      clearOnboardingRecovery(userId);
      if (destination === "home") {
        navigate("/", { replace: true });
        return;
      }
      generationProgress.markSuccess();
    } catch (error) {
      safeSetProgramFlow({
        ...context,
        phase: "error",
        failedStage: "completion",
        completionDestination: destination,
        error: error?.message || "Your program is ready, but onboarding could not be completed.",
      });
    }
  }

  async function convertWeeklyPlan(context) {
    const convertingContext = {
      ...context,
      phase: "converting",
      failedStage: null,
      error: "",
    };
    safeSetProgramFlow(convertingContext);
    persistGenerationRecovery(convertingContext, "converting");
    try {
      const cycle = await createCycleFromWeeklyPlan({
        weeklyPlanParentId: context.weeklyPlan.weeklyPlanParentId,
        weeklyPlanVersionId: context.weeklyPlan.weeklyPlanVersionId,
        name: context.weeklyPlan.name,
        startDate: context.window.startDate,
        durationWeeks: 6,
        workoutDayAssignments: context.trainingDays.map((scheduledDay, index) => ({
          workoutOrderIndex: index + 1,
          scheduledDay,
        })),
        conflictWindow: context.window,
        confirmedConflicts: context.conflicts,
      });
      if (!mountedRef.current) {
        return;
      }
      generationProgress.markCycleReady();
      await completeOnboardingLifecycle({ ...context, cycle }, "result");
    } catch (error) {
      if (error?.code === "CYCLE_CONFLICT_CONFIRMATION_REQUIRED" && error?.details) {
        const confirmationContext = {
          ...context,
          phase: "confirmation",
          window: error.details.window,
          conflicts: error.details.conflicts || [],
          failedStage: null,
          error: "",
        };
        safeSetProgramFlow(confirmationContext);
        persistGenerationRecovery(confirmationContext, "confirmation");
        return;
      }
      safeSetProgramFlow({
        ...context,
        phase: "error",
        failedStage: "conversion",
        error: error?.message || "Your weekly plan was saved, but the training cycle could not be created.",
      });
    }
  }

  async function generateWeeklyPlan(context) {
    const generatingContext = {
      ...context,
      phase: "generating",
      failedStage: null,
      error: "",
    };
    safeSetProgramFlow(generatingContext);
    persistGenerationRecovery(generatingContext, "generating");
    generationProgress.beginAI(context.generationId);
    try {
      let controller = new AbortController();
      generationRequestControllerRef.current = controller;
      let weeklyPlan;
      try {
        weeklyPlan = await createAIWeeklyPlanDraft({
          generationId: context.generationId,
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.code !== "AI_GENERATION_IN_PROGRESS") {
          throw error;
        }
        const terminalStatus = await generationProgress.waitForAICompletion();
        if (terminalStatus !== "SUCCEEDED") {
          throw new Error(
            terminalStatus === "FAILED"
              ? "We couldn't generate your weekly plan."
              : "Program generation was interrupted."
          );
        }
        controller = new AbortController();
        generationRequestControllerRef.current = controller;
        weeklyPlan = await createAIWeeklyPlanDraft({
          generationId: context.generationId,
          signal: controller.signal,
        });
      }
      if (!mountedRef.current) {
        return;
      }
      if (generationRequestControllerRef.current === controller) {
        generationRequestControllerRef.current = null;
      }
      generationProgress.stopAI();
      generationProgress.markWeeklyPlanReady();
      await convertWeeklyPlan({ ...context, weeklyPlan });
    } catch (error) {
      generationRequestControllerRef.current = null;
      if (!mountedRef.current) {
        return;
      }
      generationProgress.stopAI();
      safeSetProgramFlow({
        ...context,
        phase: "error",
        failedStage: "ai",
        error: error?.message || "We couldn't generate your weekly plan.",
      });
    }
  }

  async function checkConflictsAndContinue(context) {
    const checkingContext = {
      ...context,
      phase: "checking",
      window: null,
      conflicts: [],
      failedStage: null,
      error: "",
    };
    safeSetProgramFlow(checkingContext);
    persistGenerationRecovery(checkingContext, "checking");
    try {
      const preview = await getOnboardingCycleConflicts();
      if (!mountedRef.current) {
        return;
      }
      const nextContext = {
        ...checkingContext,
        window: preview.window,
        conflicts: preview.conflicts || [],
      };
      if (nextContext.conflicts.length > 0) {
        safeSetProgramFlow({ ...nextContext, phase: "confirmation" });
        persistGenerationRecovery(nextContext, "confirmation");
      } else {
        await generateWeeklyPlan(nextContext);
      }
    } catch (error) {
      safeSetProgramFlow({
        ...checkingContext,
        phase: "error",
        failedStage: "checking",
        error: error?.message || "We couldn't check your training cycle schedule.",
      });
    }
  }

  async function beginProgramGeneration() {
    await runGenerationOperation(async () => {
      generationProgress.reset();
      const generationId = programFlow.generationId || createGenerationId();
      const generationStartedAt = programFlow.generationStartedAt || new Date().toISOString();
      safeSetProgramFlow({
        ...programFlow,
        generationId,
        generationStartedAt,
      });
      const settingsResponse = await saveFinalTrainingProfile();
      if (!mountedRef.current) {
        return;
      }
      const availability = settingsResponse?.trainingProfile?.profile?.availability || {};
      const trainingDays = resolvePreferredTrainingDays(
        availability.preferredTrainingDays,
        availability.sessionsPerWeek
      );
      await checkConflictsAndContinue({
        ...INITIAL_PROGRAM_FLOW,
        generationId,
        generationStartedAt,
        trainingDays,
      });
    });
  }

  async function handleConflictConfirm() {
    await runGenerationOperation(async () => {
      if (programFlow.weeklyPlan) {
        await convertWeeklyPlan(programFlow);
      } else {
        await generateWeeklyPlan(programFlow);
      }
    });
  }

  async function handleConflictCancel() {
    await completeOnboardingLifecycle(programFlow, "home");
  }

  async function handleProgramRetry() {
    await runGenerationOperation(async () => {
      if (programFlow.failedStage === "checking") {
        await checkConflictsAndContinue(programFlow);
      } else if (programFlow.failedStage === "ai") {
        await generateWeeklyPlan(programFlow);
      } else if (programFlow.failedStage === "conversion") {
        await convertWeeklyPlan(programFlow);
      } else if (programFlow.failedStage === "completion") {
        await completeOnboardingLifecycle(
          programFlow,
          programFlow.completionDestination || "result"
        );
      }
    });
  }

  async function handleContinue() {
    if (isSaving) {
      return;
    }

    let validation;
    if (step === 1) {
      validation = validateAboutYou({ profile, experience: draft.experience });
    } else if (step === 2) {
      validation = validateTrainingStep(draft, availabilityOptions);
    } else if (step === 3) {
      validation = validateMuscleStep(draft, availabilityOptions);
    } else if (step === 4) {
      validation = validateSetupStep(draft);
    } else {
      validation = validateFinalStep(
        draft,
        availabilityOptions,
        hasMovementLimitations
      );
    }

    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors || {});
      setSaveError((validation.formErrors || [])[0] || "");
      return;
    }

    setIsSaving(true);
    setFieldErrors({});
    setSaveError("");
    try {
      if (step === 1) {
        await saveAboutYou();
      } else if (step < TOTAL_STEPS) {
        await saveCanonicalStep(step);
      } else {
        await beginProgramGeneration();
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      const nextErrors = {};
      (Array.isArray(error?.details) ? error.details : []).forEach((issue) => {
        if (issue?.path && !nextErrors[issue.path]) {
          nextErrors[issue.path] = issue.message;
        }
      });
      setFieldErrors(nextErrors);
      setSaveError(error?.message || "Unable to save. Your changes are still here.");
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  function handleBack() {
    if (step <= 1 || isSaving || programFlow.phase !== "step") {
      return;
    }
    const previousStep = step - 1;
    setStep(previousStep);
    setSearchParams({ step: String(previousStep) });
    setFieldErrors({});
    setSaveError("");
  }

  function renderStep() {
    if (step === 1) {
      return (
        <AboutYouStep
          profile={profile}
          experience={draft.experience}
          onProfileChange={updateProfile}
          onExperienceChange={(experience) => updateDraft({ ...draft, experience })}
          fieldErrors={fieldErrors}
          disabled={isSaving}
        />
      );
    }
    if (step === 2) {
      return (
        <TrainingStep
          draft={draft}
          availabilityOptions={availabilityOptions}
          onChange={updateDraft}
          fieldErrors={fieldErrors}
          disabled={isSaving}
        />
      );
    }
    if (step === 3) {
      return (
        <MuscleFocusStep
          draft={draft}
          availabilityOptions={availabilityOptions}
          onChange={updateDraft}
          fieldErrors={fieldErrors}
          disabled={isSaving}
        />
      );
    }
    if (step === 4) {
      return (
        <TrainingSetupStep
          draft={draft}
          onChange={updateDraft}
          fieldErrors={fieldErrors}
          disabled={isSaving}
        />
      );
    }
    return (
      <AdditionalContextStep
        draft={draft}
        onChange={updateDraft}
        hasMovementLimitations={hasMovementLimitations}
        onMovementLimitationsChange={setHasMovementLimitations}
        fieldErrors={fieldErrors}
        disabled={isSaving}
      />
    );
  }

  function renderProgramFlow() {
    if (["checking", "generating", "converting", "completing"].includes(programFlow.phase)) {
      return (
        <OnboardingGenerationLoader
          stage={programFlow.phase}
          percent={generationProgress.percent}
          message={generationProgress.message}
          profile={draft}
          isExiting={generationProgress.isCompletionExiting}
        />
      );
    }

    if (programFlow.phase === "success") {
      const cycleId = programFlow.cycle?.cycleId || programFlow.cycle?.cycle?.id;
      return (
        <OnboardingProgramResult
          weeklyPlan={programFlow.weeklyPlan}
          cycle={programFlow.cycle}
          profile={draft}
          onModify={() => navigate(getCycleBuilderPath(cycleId))}
          onDetails={() => navigate(getCycleDetailsPath(cycleId))}
        />
      );
    }

    if (programFlow.phase === "error") {
      return (
        <section className="mx-auto grid max-w-md gap-4 py-20 text-center">
          <h1 className="font-lz-v2-display text-2xl font-bold text-lz-v2-text-strong">
            We couldn&apos;t finish your program
          </h1>
          <p className="text-sm leading-6 text-lz-v2-danger" role="alert">
            {programFlow.error}
          </p>
          <Button onClick={handleProgramRetry}>Try again</Button>
        </section>
      );
    }

    return (
      <>
        {renderStep()}
        {saveError ? (
          <p className="mt-6 text-sm font-semibold text-lz-v2-danger" role="alert">
            {saveError}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <DesignV2Scope>
      <MobilePage
        className={`lz-onboarding-page${step === TOTAL_STEPS ? " lz-onboarding-page--final" : ""}${["checking", "generating", "converting", "completing"].includes(programFlow.phase) ? " lz-onboarding-page--generation" : ""}${programFlow.phase === "success" ? " lz-onboarding-page--result" : ""}`}
        hasStickyActions={
          loadState.status === "loaded" &&
          (programFlow.phase === "step" || programFlow.phase === "success")
        }
        mainProps={{ ref: pageMainRef }}
        header={
          programFlow.phase === "step" ? <>
            <ProgressIndicator
              className="lz-onboarding-progress-top"
              value={step}
              min={0}
              max={TOTAL_STEPS}
              label="Onboarding progress"
            />
            <div className="mx-auto w-full max-w-[640px] px-5 py-4 sm:px-12">
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  className="min-h-11 min-w-11 rounded-full text-left text-sm font-bold text-lz-v2-text-muted disabled:opacity-0"
                  onClick={handleBack}
                  disabled={step <= 1 || isSaving || programFlow.phase !== "step"}
                  aria-label="Go to previous onboarding step"
                >
                  Back
                </button>
                <p className="font-lz-v2-display text-lg font-bold uppercase text-lz-v2-text-strong">
                  Lyft <span className="text-lz-v2-action">Zone</span>
                </p>
                <span className="w-11 text-right text-xs font-bold text-lz-v2-text-muted">
                  {step}/{TOTAL_STEPS}
                </span>
              </div>
            </div>
          </> : (
            <div className="lz-onboarding-brand-header">
              <p className="font-lz-v2-display text-lg font-bold uppercase text-lz-v2-text-strong">
                Lyft <span className="text-lz-v2-action">Zone</span>
              </p>
            </div>
          )
        }
      >
        {loadState.status === "error" ? (
          <div className="mx-auto grid max-w-md gap-4 py-20 text-center">
            <h1 className="font-lz-v2-display text-2xl font-bold text-lz-v2-text-strong">
              We couldn&apos;t start onboarding
            </h1>
            <p className="text-lz-v2-text-muted" role="alert">{loadState.error}</p>
            <Button onClick={initialize}>Try again</Button>
          </div>
        ) : loadState.status === "loaded" && draft && profile ? (
          renderProgramFlow()
        ) : (
          <p className="py-20 text-center text-lz-v2-text-muted" role="status">
            Preparing your profile…
          </p>
        )}
      </MobilePage>

      {loadState.status === "loaded" && programFlow.phase === "step" ? (
        <StickyBottomActions
          aria-label="Onboarding actions"
          className={step === TOTAL_STEPS ? "lz-onboarding-final-actions" : ""}
          innerClassName={step === TOTAL_STEPS ? "lz-onboarding-final-actions__inner" : ""}
        >
          {step === TOTAL_STEPS && draft ? (
            <ProfileSummaryPanel items={buildProfileSummaryItems(draft)} />
          ) : null}
          <Button
            size="lg"
            className="lz-onboarding-continue"
            disabled={step === TOTAL_STEPS && !hasValidOnboardingCardioRole(draft)}
            isLoading={isSaving}
            loadingLabel={step === TOTAL_STEPS ? "Preparing..." : "Saving..."}
            onClick={handleContinue}
          >
            {step === TOTAL_STEPS ? "Generate my program" : "Continue"}
          </Button>
        </StickyBottomActions>
      ) : null}

      {loadState.status === "loaded" && programFlow.phase === "confirmation" ? (
        <OnboardingConflictModal
          conflicts={programFlow.conflicts}
          onCancel={handleConflictCancel}
          onConfirm={handleConflictConfirm}
          isBusy={isSaving}
        />
      ) : null}
    </DesignV2Scope>
  );
}
