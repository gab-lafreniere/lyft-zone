import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import AppRouter from "../AppRouter";
import { isAIWeeklyPlanFrontendEnabled } from "../../features/weeklyPlans/featureFlags";
import {
  getAIWeeklyPlanBuilderPath,
  getManualBuilderPath,
} from "../../features/weeklyPlans/routes";
import { getUserSettings } from "../../services/api";

jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"),
  createAIWeeklyPlanDraft: jest.fn(),
  getUserSettings: jest.fn(),
}));

beforeEach(() => {
  getUserSettings.mockResolvedValue({
    meta: { hasTrainingProfile: false },
    trainingProfile: { profile: {} },
  });
});

const FEATURE_FLAG = "REACT_APP_ENABLE_AI_WEEKLY_PLAN_FRONTEND";
const originalFeatureFlag = process.env[FEATURE_FLAG];

function renderAt(pathname) {
  window.history.pushState({}, "", pathname);
  return render(<AppRouter />);
}

afterEach(() => {
  if (originalFeatureFlag === undefined) {
    delete process.env[FEATURE_FLAG];
  } else {
    process.env[FEATURE_FLAG] = originalFeatureFlag;
  }
});

describe("weekly plan routes", () => {
  test("returns the centralized AI Builder path without changing the manual path", () => {
    expect(getAIWeeklyPlanBuilderPath()).toBe("/program/ai-builder");
    expect(getManualBuilderPath()).toBe("/program/manual-builder");
  });

  test("renders the AI Weekly Plan Builder on its dedicated route", async () => {
    process.env[FEATURE_FLAG] = "true";

    renderAt(getAIWeeklyPlanBuilderPath());

    expect(
      screen.getByRole("heading", { name: "AI Weekly Plan Builder" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Générer mon programme" })
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Training Profile semble incomplet/)
    ).toBeInTheDocument();
  });

  test("keeps /ai assigned to AI Coach", () => {
    process.env[FEATURE_FLAG] = "true";

    renderAt("/ai");

    expect(screen.getByRole("heading", { name: "AI Coach" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "AI Weekly Plan Builder" })
    ).not.toBeInTheDocument();
  });
});

describe("AI Weekly Plan frontend feature flag", () => {
  test("is disabled when the variable is absent", () => {
    delete process.env[FEATURE_FLAG];

    expect(isAIWeeklyPlanFrontendEnabled()).toBe(false);
  });

  test.each(["", "false", "1", "yes", "TRUE"])(
    "is disabled for the non-canonical value %j",
    (value) => {
      process.env[FEATURE_FLAG] = value;

      expect(isAIWeeklyPlanFrontendEnabled()).toBe(false);
    }
  );

  test("is enabled only for the exact value true", () => {
    process.env[FEATURE_FLAG] = "true";

    expect(isAIWeeklyPlanFrontendEnabled()).toBe(true);
  });

  test("renders the unavailable state when disabled", () => {
    delete process.env[FEATURE_FLAG];

    renderAt(getAIWeeklyPlanBuilderPath());

    expect(
      screen.getByText("AI weekly plan generation is currently unavailable.")
    ).toBeInTheDocument();
  });
});
