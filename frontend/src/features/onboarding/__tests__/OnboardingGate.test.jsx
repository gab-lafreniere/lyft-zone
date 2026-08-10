import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getUserSettings } from "../../../services/api";
import OnboardingGate from "../OnboardingGate";

jest.mock("../../../services/api", () => ({
  getUserSettings: jest.fn(),
}));

const FLAG = "REACT_APP_ENABLE_ONBOARDING_FRONTEND";
const originalFlag = process.env[FLAG];

function renderGate(initialPath = "/program") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/onboarding" element={<p>Onboarding page</p>} />
        <Route element={<OnboardingGate />}>
          <Route path="/program" element={<p>Program page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  jest.resetAllMocks();
  if (originalFlag === undefined) {
    delete process.env[FLAG];
  } else {
    process.env[FLAG] = originalFlag;
  }
});

test("rollout flag bypasses the gate without loading settings", () => {
  delete process.env[FLAG];
  renderGate();

  expect(screen.getByText("Program page")).toBeInTheDocument();
  expect(getUserSettings).not.toHaveBeenCalled();
});

test.each([
  ["new", { status: "NOT_STARTED", lastCompletedStep: 0, isComplete: false }],
  ["in progress", { status: "IN_PROGRESS", lastCompletedStep: 3, isComplete: false }],
])("redirects a %s user to onboarding", async (_label, onboarding) => {
  process.env[FLAG] = "true";
  getUserSettings.mockResolvedValue({ meta: { onboarding } });
  renderGate();

  expect(await screen.findByText("Onboarding page")).toBeInTheDocument();
  expect(screen.queryByText("Program page")).not.toBeInTheDocument();
});

test.each([
  ["completed", { status: "COMPLETED", lastCompletedStep: 5, isComplete: true }],
  [
    "valid legacy",
    {
      status: "COMPLETED",
      lastCompletedStep: 5,
      isComplete: true,
      isLegacyInferred: true,
    },
  ],
])("allows a %s user into the normal app", async (_label, onboarding) => {
  process.env[FLAG] = "true";
  getUserSettings.mockResolvedValue({ meta: { onboarding } });
  renderGate();

  expect(await screen.findByText("Program page")).toBeInTheDocument();
  expect(screen.queryByText("Onboarding page")).not.toBeInTheDocument();
});

test("keeps loading UI in place until completion state is known", async () => {
  process.env[FLAG] = "true";
  let resolveSettings;
  getUserSettings.mockReturnValue(
    new Promise((resolve) => {
      resolveSettings = resolve;
    })
  );
  renderGate();

  expect(screen.getByRole("status")).toHaveTextContent("Loading your profile");
  expect(screen.queryByText("Program page")).not.toBeInTheDocument();

  resolveSettings({
    meta: {
      onboarding: { status: "COMPLETED", lastCompletedStep: 5, isComplete: true },
    },
  });
  await waitFor(() => expect(screen.getByText("Program page")).toBeInTheDocument());
});

