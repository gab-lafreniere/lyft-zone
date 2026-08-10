import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  DesignV2Scope,
  MobilePage,
  ProgressIndicator,
  StickyBottomActions,
} from "../../design-v2";
import {
  ensureCurrentUserId,
  getUserSettings,
  updateTrainingProfileSettings,
  updateUserOnboarding,
  updateUserProfile,
} from "../../services/api";
import { isAIWeeklyPlanFrontendEnabled } from "../weeklyPlans/featureFlags";
import { getAIWeeklyPlanBuilderPath } from "../weeklyPlans/routes";
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
import { toTrainingProfilePayload } from "../settings/settingsMappers";
import AboutYouStep from "./steps/AboutYouStep";
import AdditionalContextStep from "./steps/AdditionalContextStep";
import MuscleFocusStep from "./steps/MuscleFocusStep";
import ProfileSummaryPanel from "./ProfileSummaryPanel";
import TrainingSetupStep from "./steps/TrainingSetupStep";
import TrainingStep from "./steps/TrainingStep";
import { buildProfileSummaryItems } from "./profileSummary";
import "./onboarding.css";

const TOTAL_STEPS = 5;

function getCompletionPath() {
  return isAIWeeklyPlanFrontendEnabled()
    ? getAIWeeklyPlanBuilderPath()
    : "/program";
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
  const enabled = isOnboardingFrontendEnabled();
  const availabilityOptions = settings?.trainingProfile?.options?.availability || {
    sessionsPerWeek: [],
    durationPerSession: [],
  };

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
      navigate(`/onboarding?step=${resumeStep}`, { replace: true });
      setLoadState({ status: "loaded", error: "" });
    } catch (error) {
      setLoadState({
        status: "error",
        error: error?.message || "Unable to start onboarding.",
      });
    }
  }, [navigate]);

  useEffect(() => {
    if (enabled) {
      initialize();
    }
  }, [enabled, initialize]);

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

  async function completeOnboarding() {
    const latestSettings = await getUserSettings();
    const draftToSave = mergeOnboardingStepIntoCanonical(
      createOnboardingDraft(latestSettings),
      draft,
      5
    );
    const payload = toTrainingProfilePayload(draftToSave);
    const response = await updateTrainingProfileSettings(payload);
    const authoritativeDraft = createOnboardingDraft(response);
    await updateUserOnboarding({ action: "COMPLETE" });

    setSettings(response);
    setDraft(authoritativeDraft);
    clearOnboardingRecovery(userId);
    navigate(getCompletionPath(), { replace: true });
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
        await completeOnboarding();
      }
    } catch (error) {
      const nextErrors = {};
      (Array.isArray(error?.details) ? error.details : []).forEach((issue) => {
        if (issue?.path && !nextErrors[issue.path]) {
          nextErrors[issue.path] = issue.message;
        }
      });
      setFieldErrors(nextErrors);
      setSaveError(error?.message || "Unable to save. Your changes are still here.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleBack() {
    if (step <= 1 || isSaving) {
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

  return (
    <DesignV2Scope>
      <MobilePage
        className={`lz-onboarding-page${step === TOTAL_STEPS ? " lz-onboarding-page--final" : ""}`}
        hasStickyActions={loadState.status === "loaded"}
        header={
          <>
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
                  disabled={step <= 1 || isSaving}
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
          </>
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
          <>
            {renderStep()}
            {saveError ? (
              <p className="mt-6 text-sm font-semibold text-lz-v2-danger" role="alert">
                {saveError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="py-20 text-center text-lz-v2-text-muted" role="status">
            Preparing your profile…
          </p>
        )}
      </MobilePage>

      {loadState.status === "loaded" ? (
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
    </DesignV2Scope>
  );
}
