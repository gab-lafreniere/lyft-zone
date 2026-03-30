import { useLocation } from "react-router-dom";
import { useManualProgram } from "./ManualProgramContext";
import { useMultiWeekProgram } from "./MultiWeekProgramContext";

export function useEditableProgram() {
  const location = useLocation();
  const manualContext = useManualProgram();
  const multiWeekContext = useMultiWeekProgram();

  if (
    location.pathname.startsWith("/program/cycles/") &&
    multiWeekContext &&
    (multiWeekContext.draftMetadata?.cycleId || multiWeekContext.programDraft?.weeks?.length)
  ) {
    return multiWeekContext;
  }

  return manualContext;
}
