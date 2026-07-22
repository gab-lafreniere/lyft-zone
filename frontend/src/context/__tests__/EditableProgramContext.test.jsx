import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEditableProgram } from "../EditableProgramContext";
import { useManualProgram } from "../ManualProgramContext";
import { useMultiWeekProgram } from "../MultiWeekProgramContext";

jest.mock("../ManualProgramContext", () => ({
  useManualProgram: jest.fn(),
}));

jest.mock("../MultiWeekProgramContext", () => ({
  useMultiWeekProgram: jest.fn(),
}));

function wrapperAt(pathname) {
  return function RouterWrapper({ children }) {
    return <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>;
  };
}

describe("useEditableProgram", () => {
  const manualContext = { kind: "weekly" };
  const multiWeekContext = {
    kind: "multi-week",
    draftMetadata: { cycleId: "cycle_1" },
    programDraft: { weeks: [{ weekNumber: 1 }] },
  };

  beforeEach(() => {
    useManualProgram.mockReturnValue(manualContext);
    useMultiWeekProgram.mockReturnValue(multiWeekContext);
  });

  test("uses the weekly provider for the weekly workout editor", () => {
    const { result } = renderHook(() => useEditableProgram(), {
      wrapper: wrapperAt("/program/manual-builder/workout/workout_1"),
    });

    expect(result.current).toBe(manualContext);
  });

  test("keeps the multi-week provider for cycle builder workout routes", () => {
    const { result } = renderHook(() => useEditableProgram(), {
      wrapper: wrapperAt("/program/cycles/cycle_1/builder/week/2/workout/1"),
    });

    expect(result.current).toBe(multiWeekContext);
  });
});
