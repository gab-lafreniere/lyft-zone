import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";

import HomeDashboard from "../pages/HomeDashboard";
import Program from "../pages/Program";
import AllPrograms from "../pages/AllPrograms";
import AllCycles from "../pages/AllCycles";
import ProgramDetails from "../pages/ProgramDetails";
import CycleProgramDetails from "../pages/CycleProgramDetails";
import ManualNewProgram from "../pages/ManualNewProgram";
import ManualBuilder from "../pages/ManualBuilder";
import ManualConvert from "../pages/ManualConvert";
import ManualWorkoutEditor from "../pages/ManualWorkoutEditor";
import ManualBuilderMulti from "../pages/ManualBuilderMulti";

import Train from "../pages/Train";
import Progress from "../pages/Progress";
import AICoach from "../pages/AICoach";
import Wizard from "../pages/Wizard/Wizard";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomeDashboard />} />
          <Route path="/program" element={<Program />} />
          <Route path="/program/all" element={<AllPrograms />} />
          <Route path="/program/cycles" element={<AllCycles />} />
          <Route path="/program/all/:programId" element={<ProgramDetails />} />
          <Route path="/program/cycles/:cycleId" element={<CycleProgramDetails />} />
          <Route path="/program/cycles/:cycleId/builder" element={<ManualBuilderMulti />} />
          <Route path="/program/cycles/:cycleId/builder/week/:weekNumber/workout/:orderIndex" element={<ManualWorkoutEditor />} />
          <Route path="/program/cycles/:cycleId/builder/workout/:workoutId" element={<ManualWorkoutEditor />} />
          <Route path="/program/manual-new" element={<ManualNewProgram />} />
          <Route path="/program/manual-builder" element={<ManualBuilder />} />
          <Route path="/program/manual-convert" element={<ManualConvert />} />
          <Route path="/program/manual-builder/workout/:workoutId" element={<ManualWorkoutEditor />} />
          <Route path="/program/manual-builder-multi" element={<ManualBuilderMulti />} />
          <Route path="/train" element={<Train />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/ai" element={<AICoach />} />
        </Route>

        <Route path="/wizard" element={<Wizard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
