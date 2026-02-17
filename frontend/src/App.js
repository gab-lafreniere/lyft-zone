import { useState, useEffect } from 'react';
import { fetchExercises, savePlan } from './services/api';
import ExerciseGrid from './components/ExerciseGrid';
import SelectedExercisesPanel from './components/SelectedExercisesPanel';
import PlanBuilder from './components/PlanBuilder';

/**
 * App Component
 * 
 * Main application component that:
 * - Fetches exercises from the backend API on mount
 * - Manages selected exercises and plan draft state
 * - Displays exercise library, selection panel, and plan builder
 * - Coordinates between all components
 */
function App() {
  // State for exercises data, loading, and errors
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // State for plan building
  const [selectedExercises, setSelectedExercises] = useState([]);
  const [savedPlans, setSavedPlans] = useState([]);
  const [showPlanBuilder, setShowPlanBuilder] = useState(false);

  // Fetch exercises when component mounts
  useEffect(() => {
    const loadExercises = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchExercises();
        setExercises(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message || 'Failed to load exercises. Please try again.');
        console.error('Error loading exercises:', err);
      } finally {
        setLoading(false);
      }
    };

    loadExercises();
  }, []);

  /**
   * Handle exercise selection/deselection
   * Prevents duplicates by checking if exercise already exists
   */
  const handleSelectExercise = (exercise) => {
    const isSelected = selectedExercises.some((ex) => ex.name === exercise.name);

    if (isSelected) {
      // Deselect: remove the exercise
      setSelectedExercises(
        selectedExercises.filter((ex) => ex.name !== exercise.name)
      );
    } else {
      // Select: add the exercise
      setSelectedExercises([...selectedExercises, exercise]);
    }
  };

  /**
   * Handle removing an exercise from the selected list
   */
  const handleRemoveSelectedExercise = (exerciseName) => {
    setSelectedExercises(
      selectedExercises.filter((ex) => ex.name !== exerciseName)
    );
  };

  /**
   * Handle saving a plan: envoie le programme au backend (Phase 1 Program + TrainingSessions)
   */
  const handleSavePlan = async (programPayload) => {
    try {
      const data = await savePlan(programPayload);
      setSavedPlans([...savedPlans, data]);
      alert(`Plan "${programPayload.name}" a été enregistré.`);
    } catch (err) {
      console.error('Error saving plan:', err);
      alert(err.message || 'Erreur lors de l’enregistrement du plan.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Lyft-Zone
              </h1>
              <p className="text-gray-600 mt-1">
                Build your perfect training plan
              </p>
            </div>
            {selectedExercises.length > 0 && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Selected Exercises</p>
                <p className="text-2xl font-bold text-blue-600">
                  {selectedExercises.length}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600 text-lg">Loading exercises...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-800 font-semibold mb-2">
              Unable to Load Exercises
            </p>
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Exercise Library and Selection */}
        {!loading && !error && exercises.length > 0 && (
          <>
            {/* Section 1: Exercise Library */}
            <div className="mb-12">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">
                  Exercise Library
                </h2>
                <p className="text-gray-600 mt-2">
                  Select exercises to add to your training plan
                </p>
              </div>

              <ExerciseGrid
                exercises={exercises}
                selectedExercises={selectedExercises}
                onSelectExercise={handleSelectExercise}
              />
            </div>

            {/* Section 2: Selected Exercises & Plan Builder */}
            {selectedExercises.length > 0 && (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                  {/* Sidebar: Selected Exercises */}
                  <div className="lg:col-span-1">
                    <SelectedExercisesPanel
                      exercises={selectedExercises}
                      onRemove={handleRemoveSelectedExercise}
                    />
                  </div>

                  {/* Main: Plan Summary */}
                  <div className="lg:col-span-2">
                    <div className="bg-white rounded-lg shadow-md p-6 sticky top-24">
                      <h3 className="text-xl font-bold text-gray-900 mb-4">
                        Ready to Build?
                      </h3>
                      <p className="text-gray-600 mb-6">
                        You have selected {selectedExercises.length} exercise
                        {selectedExercises.length !== 1 ? 's' : ''} and are ready to create your
                        training plan.
                      </p>
                      <button
                        onClick={() => setShowPlanBuilder(true)}
                        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold transition-colors"
                      >
                        📋 Go to Plan Builder
                      </button>
                      <p className="text-xs text-gray-500 mt-4">
                        Scroll down to the Plan Builder section below.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Section 3: Plan Builder */}
                {showPlanBuilder && (
                  <div id="plan-builder" className="mb-12 scroll-mt-20">
                    <PlanBuilder
                      selectedExercises={selectedExercises}
                      onSavePlan={handleSavePlan}
                    />
                  </div>
                )}

                {/* Auto-scroll to plan builder */}
                {showPlanBuilder && (
                  <script>
                    {document
                      .getElementById('plan-builder')
                      ?.scrollIntoView({ behavior: 'smooth' })}
                  </script>
                )}
              </>
            )}
          </>
        )}

        {/* Empty State */}
        {!loading && !error && exercises.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">
              No exercises available at the moment.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
