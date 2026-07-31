import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import SettingsDrawer from "../features/settings/SettingsDrawer";
import AIBuilderResult from "../features/weeklyPlans/aiBuilder/AIBuilderResult";
import { isAIWeeklyPlanFrontendEnabled } from "../features/weeklyPlans/featureFlags";
import { resolveBackTarget } from "../features/weeklyPlans/navigation";
import { getWeeklyPlansPath } from "../features/weeklyPlans/routes";
import { createAIWeeklyPlanDraft, getUserSettings } from "../services/api";
import Button from "../ui/Button";

const LOADING_MESSAGE_INTERVAL_MS = 3500;

const LOADING_MESSAGES = [
  "Analyse de ton profil d’entraînement",
  "Sélection des exercices compatibles",
  "Organisation de tes séances",
  "Vérification du volume et de la durée",
  "Validation de la qualité du programme",
];

const PROFILE_ERROR_MESSAGES = {
  PROFILE_NOT_READY:
    "Ton Training Profile doit être complété avant de générer un programme.",
  UNSUPPORTED_PROFILE_SCHEMA_VERSION:
    "Ton Training Profile utilise une version qui n’est pas encore prise en charge. Ouvre-le pour le mettre à jour.",
  EMPTY_EXERCISE_POOL:
    "Aucun exercice compatible n’a été trouvé avec ton Training Profile. Revois ton profil avant de réessayer.",
  AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL:
    "Ton objectif principal n’est pas encore pris en charge par le générateur AI. Revois ton Training Profile pour continuer.",
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
  HYPERTROPHY: "Hypertrophie",
  STRENGTH: "Force",
  MIXED: "Mixte",
  beginner: "Débutant",
  intermediate: "Intermédiaire",
  advanced: "Avancé",
  full_gym: "Salle complète",
  commercial_gym: "Salle commerciale",
  minimal_home: "Équipement maison minimal",
  gym: "Salle",
  home: "Maison",
  ai: "AI",
};

function formatProfileValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Non renseigné";
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
      message: "Le générateur AI est temporairement indisponible.",
    };
  }

  if (RETRYABLE_ERROR_CODES.has(code)) {
    return {
      kind: "retryable",
      message:
        "La génération n’a pas pu être terminée. Tu peux lancer une nouvelle tentative.",
    };
  }

  if (error?.status === null || error?.status === undefined) {
    return {
      kind: "network",
      message:
        "La connexion a été interrompue pendant la génération. Le programme pourrait quand même avoir été créé.",
    };
  }

  return {
    kind: "unknown",
    message:
      "Impossible de générer le programme pour le moment. Réessaie plus tard.",
  };
}

function TrainingProfileSummary({ settingsState }) {
  if (settingsState.status === "loading") {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <div
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
        />
        Chargement du résumé…
      </div>
    );
  }

  if (settingsState.status === "unavailable") {
    return (
      <p className="text-sm leading-6 text-slate-500">
        Le résumé du profil est indisponible. Tu peux quand même demander au
        backend de vérifier ton profil et de préparer ton programme.
      </p>
    );
  }

  const settings = settingsState.data;
  const profile = settings?.trainingProfile?.profile || {};
  const availability = profile.availability || {};
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
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Ton Training Profile semble incomplet. Le backend effectuera la
          vérification finale au moment de la génération.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Objectif
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {formatProfileValue(profile.primaryGoal)}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Niveau
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {formatProfileValue(profile.experience)}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Séances
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {availability.sessionsPerWeek
              ? `${availability.sessionsPerWeek} par semaine`
              : "Non renseigné"}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Durée
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {availability.durationPerSession
              ? `${availability.durationPerSession} min par séance`
              : "Non renseigné"}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Priorités
          </dt>
          <dd className="mt-1 text-sm font-bold text-slate-800">
            {muscleFocuses.length
              ? muscleFocuses.map(formatProfileValue).join(", ")
              : "Non renseigné"}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Équipement
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [generationError, setGenerationError] = useState(null);
  const [generationResult, setGenerationResult] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const loadingTimerRef = useRef(null);
  const settingsRequestIdRef = useRef(0);

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
      }
    } catch {
      if (
        mountedRef.current &&
        settingsRequestIdRef.current === requestId
      ) {
        setSettingsState({ status: "unavailable", data: null });
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
    if (!isGenerating) {
      return;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isGenerating]);

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

    inFlightRef.current = true;
    setGenerationError(null);
    setGenerationResult(null);
    setIsGenerating(true);
    startLoadingMessages();

    try {
      const response = await createAIWeeklyPlanDraft();

      if (mountedRef.current) {
        setGenerationResult(response);
      }
    } catch (error) {
      if (mountedRef.current) {
        setGenerationError(getPublicGenerationError(error));
      }
    } finally {
      clearLoadingTimer();
      inFlightRef.current = false;

      if (mountedRef.current) {
        setIsGenerating(false);
      }
    }
  }, [clearLoadingTimer, isEnabled, startLoadingMessages]);

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
          L’AI prépare un programme hebdomadaire à partir du Training Profile
          enregistré. Le backend vérifiera toujours les règles de génération.
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
              Ton Training Profile
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Résumé indicatif des informations enregistrées.
            </p>
          </div>
          <TrainingProfileSummary settingsState={settingsState} />
        </section>

        {isGenerating ? (
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
              Ton programme est en préparation
            </h2>
            <p className="mt-2 text-sm font-semibold text-primary">
              {LOADING_MESSAGES[loadingMessageIndex]}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Ces messages décrivent l’attente; ils ne représentent pas l’état
              technique exact du backend.
            </p>
            <Button className="mt-5 w-full" disabled aria-label="Génération en cours">
              Génération en cours…
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
                Génération interrompue
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {generationError.message}
              </p>
            </div>

            {generationError.kind === "profile" ? (
              <Button className="w-full" onClick={() => setIsSettingsOpen(true)}>
                Revoir le Training Profile
              </Button>
            ) : null}

            {generationError.kind === "retryable" ? (
              <Button className="w-full" onClick={handleGenerate}>
                Réessayer
              </Button>
            ) : null}

            {generationError.kind === "network" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={() => navigate(getWeeklyPlansPath())}>
                  Vérifier mes programmes
                </Button>
                <Button variant="secondary" onClick={() => navigate(backTarget)}>
                  Retour
                </Button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-sm">
            <h2 className="text-lg font-bold">Prêt à créer ton programme?</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">
              La génération démarre uniquement lorsque tu le demandes.
            </p>
            <Button
              className="mt-5 w-full bg-primary"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              Générer mon programme
            </Button>
          </section>
        )}
      </main>

      <SettingsDrawer isOpen={isSettingsOpen} onClose={closeSettings} />
    </div>
  );
}
