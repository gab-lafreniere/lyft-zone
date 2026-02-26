import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";

import HomeDashboard from "../pages/HomeDashboard";
import Program from "../pages/Program";
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
