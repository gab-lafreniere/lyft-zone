import { useEffect, useState } from "react";
import { fetchExercises, savePlan } from "../services/api";

import ExerciseGrid from "../components/ExerciseGrid";
import SelectedExercisesPanel from "../components/SelectedExercisesPanel";
import PlanBuilder from "../components/PlanBuilder";

export default function Program() {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedExercises, setSelectedExercises] = useState([]);
  const [savedPlans, setSavedPlans] = useState([]);
  const [showPlanBuilder, setShowPlanBuilder] = useState(false);

  useEffect(() => {
    const loadExercises = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchExercises();
        setExercises(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message || "Failed to load exercises. Please try again.");
        console.error("Error loading exercises:", err);
      } finally {
        setLoading(false);
      }
    };

    loadExercises();
  }, []);

  const handleSelectExercise = (exercise) => {
    const isSelected = selectedExercises.some((ex) => ex.name === exercise.name);

    if (isSelected) {
      setSelectedExercises(selectedExercises.filter((ex) => ex.name !== exercise.name));
    } else {
      setSelectedExercises([...selectedExercises, exercise]);
    }
  };

  const handleRemoveSelectedExercise = (exerciseName) => {
    setSelectedExercises(selectedExercises.filter((ex) => ex.name !== exerciseName));
  };

  const handleSavePlan = async (programPayload) => {
    try {
      const data = await savePlan(programPayload);
      setSavedPlans([...savedPlans, data]);
      alert(`Plan "${programPayload.name}" a été enregistré.`);
    } catch (err) {
      console.error("Error saving plan:", err);
      alert(err.message || "Erreur lors de l’enregistrement du plan.");
    }
  };

  // Auto-scroll propre sans <script>
  useEffect(() => {
    if (showPlanBuilder) {
      const el = document.getElementById("plan-builder");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showPlanBuilder]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Program</h1>

      {loading && (
        <div className="rounded-2xl bg-white p-4 shadow-soft">
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-accent" />
          <p className="mt-3 text-sm text-ink/70">Loading exercises…</p>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-900">Unable to load</div>
          <div className="mt-1 text-sm text-red-700">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && exercises.length > 0 && (
        <>
          <div className="rounded-2xl bg-white p-4 shadow-soft">
            <div className="text-sm font-semibold">Exercise Library</div>
            <p className="mt-1 text-sm text-ink/70">
              Select exercises to add to your training plan.
            </p>
          </div>

          <ExerciseGrid
            exercises={exercises}
            selectedExercises={selectedExercises}
            onSelectExercise={handleSelectExercise}
          />

          {selectedExercises.length > 0 && (
            <>
              <div className="rounded-2xl bg-white p-4 shadow-soft">
                <SelectedExercisesPanel
                  exercises={selectedExercises}
                  onRemove={handleRemoveSelectedExercise}
                />

                <button
                  onClick={() => setShowPlanBuilder(true)}
                  className="mt-3 w-full rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white"
                >
                  Go to Plan Builder
                </button>
              </div>

              {showPlanBuilder && (
                <div id="plan-builder" className="rounded-2xl bg-white p-4 shadow-soft">
                  <PlanBuilder selectedExercises={selectedExercises} onSavePlan={handleSavePlan} />
                </div>
              )}
            </>
          )}
        </>
      )}

      {!loading && !error && exercises.length === 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-soft">
          <p className="text-sm text-ink/70">No exercises available.</p>
        </div>
      )}
    </div>
  );
}
