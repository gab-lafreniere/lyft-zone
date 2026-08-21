import "@testing-library/jest-dom";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getAIWeeklyPlanGenerationProgress } from "../../../services/api";
import useOnboardingGenerationProgress from "../useOnboardingGenerationProgress";

jest.mock("../../../services/api", () => ({
  getAIWeeklyPlanGenerationProgress: jest.fn(),
}));

function Harness({
  phase,
  sessionsPerWeek = 5,
  durationPerSession = 90,
}) {
  const progress = useOnboardingGenerationProgress(
    phase,
    sessionsPerWeek,
    durationPerSession
  );
  const [terminalStatus, setTerminalStatus] = useState("waiting");
  return (
    <div>
      <button type="button" onClick={() => progress.beginAI("generation_test")}>Start AI</button>
      <button
        type="button"
        onClick={() => progress.waitForAICompletion().then(setTerminalStatus)}
      >
        Wait for AI
      </button>
      <button type="button" onClick={progress.markWeeklyPlanReady}>Mark weekly ready</button>
      <button type="button" onClick={progress.markSuccess}>Mark success</button>
      <output data-testid="visual-percent">{progress.percent}</output>
      <output data-testid="target-percent">{progress.targetPercent}</output>
      <output data-testid="terminal-status">{terminalStatus}</output>
      <span data-testid="display-stage">{progress.displayStage}</span>
      <span data-testid="completion-exiting">
        {String(progress.isCompletionExiting)}
      </span>
      <span data-testid="completion-ready">
        {String(progress.completionReady)}
      </span>
      <p>{progress.message.title}</p>
      <p>{progress.message.description}</p>
    </div>
  );
}

afterEach(() => jest.resetAllMocks());

test("polling starts for an AI attempt and aborts when the phase changes", async () => {
  let capturedSignal;
  getAIWeeklyPlanGenerationProgress.mockImplementation(
    (_generationId, { signal }) => {
      capturedSignal = signal;
      return new Promise(() => {});
    }
  );

  const view = render(<Harness phase="generating" />);
  fireEvent.click(screen.getByRole("button", { name: "Start AI" }));

  await waitFor(() =>
    expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalledWith(
      "generation_test",
      { signal: expect.any(AbortSignal) }
    )
  );
  expect(capturedSignal.aborted).toBe(false);

  view.rerender(<Harness phase="converting" />);
  expect(capturedSignal.aborted).toBe(true);
});

test("a transient polling failure resets after RUNNING and still resolves SUCCEEDED", async () => {
  jest.useFakeTimers();
  getAIWeeklyPlanGenerationProgress
    .mockRejectedValueOnce(new Error("Temporary network error"))
    .mockResolvedValueOnce({ status: "RUNNING", stage: "RESOLVING_EXERCISES" })
    .mockResolvedValueOnce({ status: "SUCCEEDED", stage: "SAVING_PROGRAM" });
  const view = render(<Harness phase="generating" />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Start AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Wait for AI" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("terminal-status")).toHaveTextContent("waiting");

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(screen.getByTestId("terminal-status")).toHaveTextContent("waiting");

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(screen.getByTestId("terminal-status")).toHaveTextContent("SUCCEEDED");
    expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("three consecutive polling failures resolve the waiter as unavailable", async () => {
  jest.useFakeTimers();
  getAIWeeklyPlanGenerationProgress.mockRejectedValue(
    new Error("Progress unavailable")
  );
  const view = render(<Harness phase="generating" />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Start AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Wait for AI" }));
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
    });

    expect(screen.getByTestId("terminal-status")).toHaveTextContent("UNAVAILABLE");
    expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalledTimes(3);

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("poll failures do not stop conservative loader animation before unavailability", async () => {
  jest.useFakeTimers();
  getAIWeeklyPlanGenerationProgress.mockRejectedValue(
    new Error("Progress unavailable")
  );
  const view = render(<Harness phase="generating" />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Start AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Wait for AI" }));
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(Number(screen.getByTestId("visual-percent").textContent))
      .toBeGreaterThan(0);
    expect(screen.getByTestId("terminal-status")).toHaveTextContent("waiting");
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("RESOLVING_EXERCISES rotates truthful stage messages every five seconds", async () => {
  jest.useFakeTimers();
  let resolveFirstProgress;
  getAIWeeklyPlanGenerationProgress.mockImplementation(
    () => new Promise((resolve) => {
      if (!resolveFirstProgress) {
        resolveFirstProgress = resolve;
      }
    })
  );
  const view = render(<Harness phase="generating" sessionsPerWeek={3} />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Start AI" }));
    await waitFor(() =>
      expect(getAIWeeklyPlanGenerationProgress).toHaveBeenCalled()
    );
    await act(async () => {
      resolveFirstProgress({
        status: "RUNNING",
        stage: "RESOLVING_EXERCISES",
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId("display-stage")).not.toHaveTextContent(
      "RESOLVING_EXERCISES"
    );
    for (let step = 0; step < 60; step += 1) {
      if (
        screen.getByTestId("display-stage").textContent === "RESOLVING_EXERCISES"
      ) {
        break;
      }
      act(() => {
        jest.advanceTimersByTime(250);
      });
    }
    expect(screen.getByTestId("display-stage")).toHaveTextContent(
      "RESOLVING_EXERCISES"
    );
    expect(screen.getByText("Matching Your Exercises")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Completing Set Guidance")).toBeInTheDocument();
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("a backend stage update changes only the target and catches up without visible jumps", async () => {
  jest.useFakeTimers();
  let resolveProgress;
  getAIWeeklyPlanGenerationProgress.mockImplementation(
    () => new Promise((resolve) => {
      resolveProgress = resolve;
    })
  );
  const view = render(<Harness phase="generating" />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Start AI" }));
    await waitFor(() => expect(resolveProgress).toEqual(expect.any(Function)));
    await act(async () => {
      resolveProgress({ status: "RUNNING", stage: "RESOLVING_EXERCISES" });
      await Promise.resolve();
    });

    expect(Number(screen.getByTestId("visual-percent").textContent)).toBe(0);
    act(() => {
      jest.advanceTimersByTime(16);
    });
    const firstVisual = Number(
      screen.getByTestId("visual-percent").textContent
    );
    expect(firstVisual).toBeGreaterThan(0);
    expect(firstVisual).toBeLessThanOrEqual(1);
    expect(Number(screen.getByTestId("target-percent").textContent))
      .toBeGreaterThanOrEqual(62);
    expect(screen.getByTestId("display-stage")).toHaveTextContent(
      "PROFILE_SETUP"
    );

    let previous = firstVisual;
    for (let index = 0; index < 40; index += 1) {
      act(() => {
        jest.advanceTimersByTime(16);
      });
      const current = Number(
        screen.getByTestId("visual-percent").textContent
      );
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current - previous).toBeLessThanOrEqual(1);
      previous = current;
    }
    act(() => {
      jest.advanceTimersByTime(9000);
    });
    expect(screen.getByTestId("display-stage")).toHaveTextContent(
      "RESOLVING_EXERCISES"
    );
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("finalization runway continues when converting changes to completing", () => {
  jest.useFakeTimers();
  const view = render(<Harness phase="generating" />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Mark weekly ready" }));
    expect(Number(screen.getByTestId("visual-percent").textContent)).toBe(96);
    expect(Number(screen.getByTestId("target-percent").textContent)).toBe(96);
    view.rerender(<Harness phase="converting" />);
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    const convertingTarget = Number(
      screen.getByTestId("target-percent").textContent
    );
    expect(convertingTarget).toBeGreaterThan(97);
    expect(convertingTarget).toBeLessThan(98);

    view.rerender(<Harness phase="completing" />);
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    const completingTarget = Number(
      screen.getByTestId("target-percent").textContent
    );
    expect(completingTarget).toBeGreaterThan(98);
    expect(completingTarget).toBeLessThan(99);
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("a fast run stays visible for 2.5 seconds before success can target 100", () => {
  jest.useFakeTimers();
  const view = render(<Harness phase="completing" />);

  try {
    fireEvent.click(screen.getByRole("button", { name: "Start AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark success" }));

    act(() => {
      jest.advanceTimersByTime(2499);
    });
    expect(Number(screen.getByTestId("target-percent").textContent))
      .toBeLessThan(100);
    expect(screen.getByTestId("completion-ready")).toHaveTextContent("false");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(Number(screen.getByTestId("target-percent").textContent)).toBe(100);
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("true success animates to 100, holds, then exits before becoming ready", () => {
  jest.useFakeTimers();
  const view = render(<Harness phase="completing" />);

  try {
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    const beforeSuccess = Number(
      screen.getByTestId("visual-percent").textContent
    );
    expect(beforeSuccess).toBeGreaterThan(98);
    expect(beforeSuccess).toBeLessThan(99);
    expect(screen.getByTestId("completion-ready")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "Mark success" }));
    expect(Number(screen.getByTestId("visual-percent").textContent))
      .toBe(beforeSuccess);
    expect(Number(screen.getByTestId("target-percent").textContent)).toBe(100);

    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(Number(screen.getByTestId("visual-percent").textContent))
      .toBeLessThan(100);

    act(() => {
      jest.advanceTimersByTime(256);
    });
    expect(Number(screen.getByTestId("visual-percent").textContent)).toBe(100);
    expect(screen.getByTestId("completion-exiting")).toHaveTextContent("false");
    expect(screen.getByTestId("completion-ready")).toHaveTextContent("false");

    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(screen.getByTestId("completion-exiting")).toHaveTextContent("false");
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("completion-exiting")).toHaveTextContent("true");
    expect(screen.getByTestId("completion-ready")).toHaveTextContent("false");

    act(() => {
      jest.advanceTimersByTime(180);
    });
    expect(screen.getByTestId("completion-ready")).toHaveTextContent("true");
  } finally {
    view.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
