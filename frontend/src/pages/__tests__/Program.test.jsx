import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Program from "../Program";
import {
  createAIWeeklyPlanDraft,
  getProgramOverviewV2,
  getWeeklyPlans,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"),
  createAIWeeklyPlanDraft: jest.fn(),
  getProgramOverviewV2: jest.fn(),
  getWeeklyPlans: jest.fn(),
}));

const FEATURE_FLAG = "REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND";
const originalFeatureFlag = process.env[FEATURE_FLAG];

function LocationProbe() {
  const location = useLocation();

  return (
    <>
      <p data-testid="current-location">{location.pathname}</p>
      <p data-testid="current-location-state">
        {JSON.stringify(location.state)}
      </p>
    </>
  );
}

function renderProgram() {
  return render(
    <MemoryRouter initialEntries={["/program"]}>
      <Routes>
        <Route
          path="/program"
          element={
            <>
              <Program />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/program/ai-builder"
          element={
            <>
              <p>AI Builder route</p>
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/program/manual-new"
          element={
            <>
              <p>Manual New Program route</p>
              <LocationProbe />
            </>
          }
        />
        <Route path="/ai" element={<p>AI Coach route</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function renderLoadedProgram() {
  const renderResult = renderProgram();

  await waitFor(() => {
    expect(getWeeklyPlans).toHaveBeenCalledTimes(1);
    expect(getProgramOverviewV2).toHaveBeenCalledTimes(1);
  });

  return renderResult;
}

beforeEach(() => {
  jest.clearAllMocks();
  getWeeklyPlans.mockResolvedValue({ items: [] });
  getProgramOverviewV2.mockResolvedValue({
    activeProgramCard: null,
    cycleStructure: null,
    pastPrograms: [],
    timezone: "America/Toronto",
    upcomingPrograms: [],
  });
});

afterEach(() => {
  if (originalFeatureFlag === undefined) {
    delete process.env[FEATURE_FLAG];
  } else {
    process.env[FEATURE_FLAG] = originalFeatureFlag;
  }
});

test("le menu Program ouvre l'AI builder activé avec l'origine courante", async () => {
  process.env[FEATURE_FLAG] = "true";
  await renderLoadedProgram();

  expect(screen.getByRole("heading", { name: "Program" })).toBeInTheDocument();
  expect(screen.getByText("Cycle Structure")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create program" }));

  expect(
    screen.getByRole("menu", { name: "Create program options" })
  ).toBeInTheDocument();
  const aiBuilderOption = screen.getByRole("menuitem", {
    name: /AI builder$/,
  });
  expect(aiBuilderOption).toBeInTheDocument();

  fireEvent.click(aiBuilderOption);

  expect(screen.getByText("AI Builder route")).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent(
    "/program/ai-builder"
  );
  expect(screen.getByTestId("current-location-state")).toHaveTextContent(
    JSON.stringify({ from: "/program" })
  );
  expect(screen.queryByText("AI Coach route")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menu", { name: "Create program options" })
  ).not.toBeInTheDocument();
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});

test.each([
  ["absent", undefined],
  ["false", "false"],
])(
  "masque l'AI builder lorsque le feature flag est %s sans masquer Manual",
  async (_label, featureFlagValue) => {
    if (featureFlagValue === undefined) {
      delete process.env[FEATURE_FLAG];
    } else {
      process.env[FEATURE_FLAG] = featureFlagValue;
    }
    await renderLoadedProgram();

    fireEvent.click(screen.getByRole("button", { name: "Create program" }));

    expect(
      screen.queryByRole("menuitem", { name: /AI builder$/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Manual$/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create program" })
    ).toBeInTheDocument();
    expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
  }
);

test("conserve strictement la navigation Manual lorsque le flag est désactivé", async () => {
  process.env[FEATURE_FLAG] = "false";
  await renderLoadedProgram();

  fireEvent.click(screen.getByRole("button", { name: "Create program" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Manual$/ }));

  expect(screen.getByText("Manual New Program route")).toBeInTheDocument();
  expect(screen.getByTestId("current-location")).toHaveTextContent(
    "/program/manual-new"
  );
  expect(screen.getByTestId("current-location-state")).toHaveTextContent(
    JSON.stringify({
      from: "/program",
      returnTo: "/program",
    })
  );
  expect(createAIWeeklyPlanDraft).not.toHaveBeenCalled();
});
