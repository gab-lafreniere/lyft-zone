import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ManualProgramProvider,
  useManualProgram,
} from "../../context/ManualProgramContext";
import { mapBuilderPayloadToProgramDraft } from "../../features/weeklyPlans/mappers";
import {
  createAIWeeklyPlanDraft,
  getUserSettings,
  openOrCreateWeeklyPlanEditDraft,
  updateWeeklyPlanDraft,
} from "../../services/api";
import AIWeeklyPlanBuilder from "../AIWeeklyPlanBuilder";

jest.mock("../../features/weeklyPlans/mappers", () => ({
  ...jest.requireActual("../../features/weeklyPlans/mappers"),
  mapBuilderPayloadToProgramDraft: jest.fn(),
}));

jest.mock("../../services/api", () => ({
  createAIWeeklyPlanDraft: jest.fn(),
  getUserSettings: jest.fn(),
  openOrCreateWeeklyPlanEditDraft: jest.fn(),
  updateWeeklyPlanDraft: jest.fn(),
}));

jest.mock("../../features/settings/SettingsDrawer", () => ({
  __esModule: true,
  default: function MockSettingsDrawer({ isOpen, onClose }) {
    return isOpen ? (
      <div role="dialog" aria-label="Training Profile settings">
        <p>Training Profile settings</p>
        <button type="button" onClick={onClose}>
          Fermer les réglages
        </button>
      </div>
    ) : null;
  },
}));

const FEATURE_FLAG = "REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND";
const originalFeatureFlag = process.env[FEATURE_FLAG];

const settingsResponse = {
  meta: {
    hasTrainingProfile: true,
  },
  trainingProfile: {
    profile: {
      primaryGoal: "HYPERTROPHY",
      experience: "intermediate",
      availability: {
        sessionsPerWeek: 4,
        durationPerSession: 60,
      },
      musclePriorities: {
        primaryFocus: "chest",
        secondaryFocuses: ["back"],
      },
      environment: {
        equipmentPreset: "full_gym",
        availableEquipment: ["bodyweight", "dumbbells"],
      },
    },
  },
};

const generatedDraft = {
  weeklyPlanParentId: "weekly_parent_ai_1",
  weeklyPlanVersionId: "weekly_version_ai_1",
  name: "Hypertrophie équilibrée",
  status: "PUBLISHED",
  source: "ai",
  metrics: {
    totalExercises: 11,
    strengthSets: 30,
    averageDurationMinutes: 50,
    averageTUTMinutes: 17,
    weeklyMuscleDistribution: [
      {
        key: "chest",
        label: "Chest",
        rawSets: 16,
        percentage: 53,
      },
      {
        key: "back",
        label: "Back",
        rawSets: 14,
        percentage: 47,
      },
    ],
  },
  presentation: {
    title: "Hypertrophie équilibrée",
    summary:
      "Un split équilibré qui priorise le haut des pectoraux et le dos.",
    weeklyStructure: ["Upper A", "Lower A"],
    musclePriorities: ["upper_chest", "back"],
    constraintNotes: ["Use pain-free ranges of motion."],
    progression: "Add repetitions before increasing load.",
    coachingNotes: ["Keep technique consistent."],
  },
};

const editableDraft = {
  weeklyPlanParentId: "weekly_parent_ai_1",
  weeklyPlanVersionId: "weekly_version_draft_2",
  status: "DRAFT",
  source: "ai",
  updatedAt: "2026-07-26T12:00:00.000Z",
  builderPayload: {
    programName: "Hypertrophie équilibrée",
    sessionsPerWeek: 2,
    workouts: [],
  },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function controlledError(code, details = null, status = 503) {
  const error = new Error("Internal provider message");
  error.code = code;
  error.details = details;
  error.status = status;
  return error;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="current-location">{location.pathname}</output>
      <output data-testid="current-location-state">
        {JSON.stringify(location.state)}
      </output>
    </>
  );
}

function ManualStateProbe() {
  const { draftMetadata, programDraft } = useManualProgram();

  return (
    <output data-testid="manual-state">
      {JSON.stringify({
        weeklyPlanParentId: draftMetadata.weeklyPlanParentId,
        weeklyPlanVersionId: draftMetadata.weeklyPlanVersionId,
        source: draftMetadata.source,
        programName: programDraft.programName,
      })}
    </output>
  );
}

function renderBuilder({
  entry = "/program/ai-builder",
  withManualContext = false,
} = {}) {
  const router = (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/program/ai-builder"
          element={<AIWeeklyPlanBuilder />}
        />
        <Route path="/program/all" element={<p>Liste des programmes</p>} />
        <Route path="/program/all/:programId" element={<p>Détail du programme</p>} />
        <Route path="/program" element={<p>Accueil Program</p>} />
        <Route path="/origine-personnalisee" element={<p>Origine personnalisée</p>} />
        <Route
          path="/program/manual-builder"
          element={<p>Manual Builder route</p>}
        />
      </Routes>
      <LocationProbe />
      {withManualContext ? <ManualStateProbe /> : null}
    </MemoryRouter>
  );

  return render(<ManualProgramProvider>{router}</ManualProgramProvider>);
}

beforeEach(() => {
  process.env[FEATURE_FLAG] = "true";
  jest.clearAllMocks();
  getUserSettings.mockReturnValue(new Promise(() => {}));
  createAIWeeklyPlanDraft.mockResolvedValue(generatedDraft);
  openOrCreateWeeklyPlanEditDraft.mockResolvedValue(editableDraft);
  mapBuilderPayloadToProgramDraft.mockImplementation(
    jest.requireActual(
      "../../features/weeklyPlans/mappers"
    ).mapBuilderPayloadToProgramDraft
  );
});

afterEach(() => {
  jest.useRealTimers();

  if (originalFeatureFlag === undefined) {
    delete process.env[FEATURE_FLAG];
  } else {
    process.env[FEATURE_FLAG] = originalFeatureFlag;
  }
});

test("affiche un état indisponible lorsque le feature flag est désactivé", () => {
  process.env[FEATURE_FLAG] = "false";

  renderBuilder();

  expect(
    screen.getByText("AI weekly plan generation is currently unavailable.")
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Générer mon programme" })
  ).not.toBeInTheDocument();
});

test("ne charge ni les settings ni la génération lorsque le flag est désactivé", () => {
  process.env[FEATURE_FLAG] = "false";

  renderBuilder();

  expect(getUserSettings).not.toHaveBeenCalled();
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});

test("affiche l'état initial et le bouton explicite de génération", () => {
  renderBuilder();

  expect(
    screen.getByRole("heading", { name: "AI Weekly Plan Builder" })
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Générer mon programme" })
  ).toBeEnabled();
});

test("affiche le header sticky avec sa flèche et retourne vers Program par défaut", () => {
  renderBuilder();

  const header = screen.getByRole("banner");
  expect(header).toHaveClass("sticky", "top-0");
  expect(
    within(header).getByRole("heading", { name: "AI Weekly Plan Builder" })
  ).toBeInTheDocument();
  const backButton = within(header).getByRole("button", { name: "Back" });
  expect(within(backButton).getByText("arrow_back")).toBeInTheDocument();
  expect(
    within(header).queryByText(/L’AI prépare un programme hebdomadaire/)
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/L’AI prépare un programme hebdomadaire/)
  ).toBeInTheDocument();

  fireEvent.click(backButton);

  expect(screen.getByTestId("current-location")).toHaveTextContent("/program");
});

test("la flèche du header respecte l'origine de navigation personnalisée", () => {
  renderBuilder({
    entry: {
      pathname: "/program/ai-builder",
      state: { from: "/origine-personnalisee" },
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByTestId("current-location")).toHaveTextContent(
    "/origine-personnalisee"
  );
  expect(screen.getByText("Origine personnalisée")).toBeInTheDocument();
});

test("affiche le résumé non autoritatif du Training Profile chargé", async () => {
  getUserSettings.mockResolvedValue(settingsResponse);
  renderBuilder();

  expect(await screen.findByText("Hypertrophie")).toBeInTheDocument();
  expect(screen.getByText("Intermédiaire")).toBeInTheDocument();
  expect(screen.getByText("4 par semaine")).toBeInTheDocument();
  expect(screen.getByText("60 min par séance")).toBeInTheDocument();
  expect(screen.getByText("Chest, Back")).toBeInTheDocument();
  expect(screen.getByText("Salle complète")).toBeInTheDocument();
  expect(
    screen.getByText("Résumé indicatif des informations enregistrées.")
  ).toBeInTheDocument();
});

test("signale un profil incomplet sans bloquer localement la génération", async () => {
  getUserSettings.mockResolvedValue({
    meta: { hasTrainingProfile: false },
    trainingProfile: { profile: {} },
  });

  renderBuilder();

  expect(
    await screen.findByText(/Training Profile semble incomplet/)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Générer mon programme" })
  ).toBeEnabled();
});

test("une erreur settings reste publique et ne révèle aucun détail technique", async () => {
  getUserSettings.mockRejectedValue(
    new Error("provider raw prompt stack generationContext")
  );

  renderBuilder();

  expect(
    await screen.findByText(/Le résumé du profil est indisponible/)
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/provider raw|prompt|stack|generationContext/i)
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Générer mon programme" })
  ).toBeEnabled();
});

test("ne lance aucune génération automatiquement au montage", async () => {
  getUserSettings.mockResolvedValue(settingsResponse);
  renderBuilder();

  await screen.findByText("Hypertrophie");
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});

test("un clic lance exactement une requête de génération", () => {
  const request = deferred();
  createAIWeeklyPlanDraft.mockReturnValue(request.promise);
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledWith();
});

test("désactive l'action de génération pendant la requête", () => {
  createAIWeeklyPlanDraft.mockReturnValue(deferred().promise);
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(
    screen.getByRole("button", { name: "Génération en cours" })
  ).toBeDisabled();
});

test("un double clic ne lance qu'une seule requête", () => {
  createAIWeeklyPlanDraft.mockReturnValue(deferred().promise);
  renderBuilder();
  const generateButton = screen.getByRole("button", {
    name: "Générer mon programme",
  });

  fireEvent.click(generateButton);
  fireEvent.click(generateButton);

  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
});

test("fait progresser honnêtement les messages UX pendant l'attente", () => {
  jest.useFakeTimers();
  createAIWeeklyPlanDraft.mockReturnValue(deferred().promise);
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  expect(
    screen.getByText("Analyse de ton profil d’entraînement")
  ).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(3500);
  });
  expect(
    screen.getByText("Sélection des exercices compatibles")
  ).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(10500);
  });
  expect(
    screen.getByText("Validation de la qualité du programme")
  ).toBeInTheDocument();
  expect(
    screen.getByText(/ne représentent pas l’état technique exact du backend/)
  ).toBeInTheDocument();
});

test("n'affiche aucun pourcentage ni progression déterministe", () => {
  createAIWeeklyPlanDraft.mockReturnValue(deferred().promise);
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument();
  expect(screen.queryByText(/étape \d+ sur \d+/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

test("affiche uniquement les métriques et la présentation publique", async () => {
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(
    await screen.findByRole("heading", { name: "Hypertrophie équilibrée" })
  ).toBeInTheDocument();
  expect(screen.getByText("11")).toBeInTheDocument();
  expect(screen.getByText("30")).toBeInTheDocument();
  expect(screen.getByText("50 min")).toBeInTheDocument();
  expect(screen.getByText("17 min")).toBeInTheDocument();
  expect(screen.getByText("Chest")).toBeInTheDocument();
  expect(screen.getByText("53%")).toBeInTheDocument();
  expect(
    screen.getByText("Un split équilibré qui priorise le haut des pectoraux et le dos.")
  ).toBeInTheDocument();
  expect(screen.getByText("Upper A")).toBeInTheDocument();
  expect(screen.getByText("Upper chest")).toBeInTheDocument();
  expect(screen.getByText("Add repetitions before increasing load.")).toBeInTheDocument();
  expect(screen.queryByText("Aperçu des séances")).not.toBeInTheDocument();
});

test("affiche les deux actions finales uniquement après un succès", async () => {
  const request = deferred();
  createAIWeeklyPlanDraft.mockReturnValue(request.promise);
  renderBuilder();

  expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "See details" })).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "See details" })).not.toBeInTheDocument();

  await act(async () => {
    request.resolve(generatedDraft);
    await request.promise;
  });

  expect(
    await screen.findByRole("button", { name: "Modify" })
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "See details" })).toBeInTheDocument();
});

test("Modify ouvre et hydrate le draft existant puis navigue vers le Manual Builder", async () => {
  renderBuilder({
    entry: {
      pathname: "/program/ai-builder",
      state: { from: "/onboarding/training-profile" },
    },
    withManualContext: true,
  });

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  const editButton = await screen.findByRole("button", { name: "Modify" });

  fireEvent.click(editButton);
  fireEvent.click(editButton);

  await waitFor(() =>
    expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledTimes(1)
  );
  expect(openOrCreateWeeklyPlanEditDraft).toHaveBeenCalledWith(
    "weekly_parent_ai_1"
  );
  await waitFor(() => {
    expect(mapBuilderPayloadToProgramDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("current-location")).toHaveTextContent(
      "/program/manual-builder"
    );
  });
  expect(mapBuilderPayloadToProgramDraft).toHaveBeenCalledWith(editableDraft);
  expect(screen.getByText("Manual Builder route")).toBeInTheDocument();
  expect(screen.getByTestId("current-location-state")).toHaveTextContent(
    JSON.stringify({
      from: "/program/all/weekly_parent_ai_1",
      returnTo: "/onboarding/training-profile",
    })
  );
  expect(screen.getByTestId("current-location-state")).not.toHaveTextContent(
    "/program/ai-builder"
  );
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    '"weeklyPlanParentId":"weekly_parent_ai_1"'
  );
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    '"weeklyPlanVersionId":"weekly_version_draft_2"'
  );
  expect(screen.getByTestId("manual-state")).toHaveTextContent('"source":"ai"');
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    '"programName":"Hypertrophie équilibrée"'
  );
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
  expect(updateWeeklyPlanDraft).not.toHaveBeenCalled();
});

test("See details ouvre la page normale du parent sans hydrater", async () => {
  renderBuilder({ withManualContext: true });
  const initialManualState = screen.getByTestId("manual-state").textContent;

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  fireEvent.click(await screen.findByRole("button", { name: "See details" }));

  expect(screen.getByTestId("current-location")).toHaveTextContent(
    "/program/all/weekly_parent_ai_1"
  );
  expect(screen.getByTestId("current-location-state")).toHaveTextContent(
    JSON.stringify({ from: "/program" })
  );
  expect(screen.getByText("Détail du programme")).toBeInTheDocument();
  expect(mapBuilderPayloadToProgramDraft).not.toHaveBeenCalled();
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    initialManualState
  );
  expect(openOrCreateWeeklyPlanEditDraft).not.toHaveBeenCalled();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(1);
});

test("n'affiche aucun audit ni champ interne de la réponse", async () => {
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  await screen.findByText("Généré avec AI");
  expect(
    screen.queryByText(
      /PRIVATE_|generationContext|poolSnapshot|provider|model|responseId|tokens|prompt|doctrine|review|repair|weekly_parent_ai_1|weekly_version_ai_1/i
    )
  ).not.toBeInTheDocument();
});

test("reste sur la page AI après un succès", async () => {
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  await screen.findByText("Hypertrophie équilibrée");
  expect(screen.getByTestId("current-location")).toHaveTextContent(
    "/program/ai-builder"
  );
});

test("ne hydrate ni ne modifie le contexte du Manual Builder après un succès", async () => {
  renderBuilder({ withManualContext: true });
  const initialManualState = screen.getByTestId("manual-state").textContent;

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  await screen.findByText("Hypertrophie équilibrée");
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    initialManualState
  );
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    '"weeklyPlanParentId":null'
  );
  expect(screen.getByTestId("manual-state")).toHaveTextContent(
    '"source":"manual"'
  );
});

test.each([
  "PROFILE_NOT_READY",
  "UNSUPPORTED_PROFILE_SCHEMA_VERSION",
  "EMPTY_EXERCISE_POOL",
  "AI_WEEKLY_PLAN_UNSUPPORTED_PRIMARY_GOAL",
])("l'erreur profil %s propose de revoir le Training Profile", async (code) => {
  createAIWeeklyPlanDraft.mockRejectedValue(
    controlledError(code, { prompt: "secret" }, 422)
  );
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  const reviewButton = await screen.findByRole("button", {
    name: "Revoir le Training Profile",
  });
  expect(reviewButton).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();

  fireEvent.click(reviewButton);
  expect(
    screen.getByRole("dialog", { name: "Training Profile settings" })
  ).toBeInTheDocument();
});

test("l'erreur builder désactivé n'offre pas de retry immédiat", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(
    controlledError("AI_WEEKLY_PLAN_BUILDER_DISABLED", null, 503)
  );
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(
    await screen.findByText("Le générateur AI est temporairement indisponible.")
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Modify" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "See details" })).not.toBeInTheDocument();
});

test.each([
  "AI_WEEKLY_PLAN_GENERATION_TIMEOUT",
  "AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE",
  "AI_WEEKLY_PLAN_MODEL_UNAVAILABLE",
  "AI_WEEKLY_PLAN_PROVIDER_RATE_LIMITED",
  "AI_WEEKLY_PLAN_INVALID_PROVIDER_RESPONSE",
  "AI_WEEKLY_PLAN_INVALID_OUTPUT",
  "AI_WEEKLY_PLAN_REPAIR_FAILED",
])("l'erreur contrôlée %s permet un retry manuel", async (code) => {
  createAIWeeklyPlanDraft.mockRejectedValue(controlledError(code));
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(
    await screen.findByRole("button", { name: "Réessayer" })
  ).toBeInTheDocument();
});

test("un retry manuel lance une nouvelle requête après la fin de la précédente", async () => {
  createAIWeeklyPlanDraft
    .mockRejectedValueOnce(
      controlledError("AI_WEEKLY_PLAN_PROVIDER_UNAVAILABLE")
    )
    .mockResolvedValueOnce(generatedDraft);
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  fireEvent.click(await screen.findByRole("button", { name: "Réessayer" }));

  expect(
    await screen.findByRole("heading", { name: "Hypertrophie équilibrée" })
  ).toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).toHaveBeenCalledTimes(2);
});

test("une erreur réseau ambiguë n'offre pas de retry et permet de vérifier les programmes", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(new TypeError("Failed to fetch"));
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(
    await screen.findByText(
      "La connexion a été interrompue pendant la génération. Le programme pourrait quand même avoir été créé."
    )
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier mes programmes" })
  );
  expect(screen.getByTestId("current-location")).toHaveTextContent(
    "/program/all"
  );
});

test("l'action Retour d'une erreur réseau respecte l'origine de navigation", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(new TypeError("Failed to fetch"));
  renderBuilder({
    entry: {
      pathname: "/program/ai-builder",
      state: { from: "/program" },
    },
  });

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retour" }));

  expect(screen.getByTestId("current-location")).toHaveTextContent("/program");
});

test("ne rend jamais error.details ni le message interne du provider", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(
    controlledError(
      "AI_WEEKLY_PLAN_INVALID_OUTPUT",
      {
        prompt: "secret prompt",
        providerResponse: "raw response",
        pointer: "/plan/workouts/0",
        generationContext: { private: true },
      },
      502
    )
  );
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  await screen.findByRole("button", { name: "Réessayer" });

  expect(
    screen.queryByText(
      /Internal provider message|secret prompt|raw response|\/plan\/workouts|generationContext/i
    )
  ).not.toBeInTheDocument();
});

test("une erreur HTTP inconnue affiche seulement un message générique", async () => {
  createAIWeeklyPlanDraft.mockRejectedValue(
    controlledError("UNEXPECTED_INTERNAL_CODE", { stack: "secret" }, 500)
  );
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  expect(
    await screen.findByText(
      "Impossible de générer le programme pour le moment. Réessaie plus tard."
    )
  ).toBeInTheDocument();
  expect(screen.queryByText(/UNEXPECTED_INTERNAL_CODE|secret/)).not.toBeInTheDocument();
});

test("nettoie le timer de messages au démontage", () => {
  jest.useFakeTimers();
  const clearIntervalSpy = jest.spyOn(window, "clearInterval");
  createAIWeeklyPlanDraft.mockReturnValue(deferred().promise);
  const { unmount } = renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  unmount();

  expect(clearIntervalSpy).toHaveBeenCalled();
  clearIntervalSpy.mockRestore();
});

test("ignore la résolution de la génération après démontage sans mise à jour invalide", async () => {
  const request = deferred();
  const consoleErrorSpy = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});
  createAIWeeklyPlanDraft.mockReturnValue(request.promise);
  const { unmount } = renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );
  unmount();

  await act(async () => {
    request.resolve(generatedDraft);
    await request.promise;
  });

  expect(consoleErrorSpy.mock.calls.flat().join(" ")).not.toMatch(
    /state update|unmounted component/i
  );
  consoleErrorSpy.mockRestore();
});

test("active puis retire l'avertissement beforeunload pendant la génération", async () => {
  const request = deferred();
  createAIWeeklyPlanDraft.mockReturnValue(request.promise);
  renderBuilder();

  fireEvent.click(
    screen.getByRole("button", { name: "Générer mon programme" })
  );

  const duringGeneration = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(duringGeneration);
  expect(duringGeneration.defaultPrevented).toBe(true);

  await act(async () => {
    request.resolve(generatedDraft);
    await request.promise;
  });
  await waitFor(() =>
    expect(screen.getByText("Hypertrophie équilibrée")).toBeInTheDocument()
  );

  const afterGeneration = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterGeneration);
  expect(afterGeneration.defaultPrevented).toBe(false);
});
