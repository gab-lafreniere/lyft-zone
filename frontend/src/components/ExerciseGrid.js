/**
 * ExerciseGrid Component
 * 
 * Displays a responsive grid of exercise cards and provides
 * filtering options by muscle group and difficulty.
 * Handles exercise selection for plan building.
 */

import { useState, useMemo } from 'react';
import ExerciseCard from './ExerciseCard';

const ExerciseGrid = ({ exercises, selectedExercises, onSelectExercise }) => {
  // State for filtering
  const [selectedMuscle, setSelectedMuscle] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);

  // Get unique muscle groups and difficulties from exercises
  const muscleGroups = useMemo(
    () => [...new Set(exercises.map((ex) => ex.muscleGroup))].sort(),
    [exercises]
  );

  const difficulties = useMemo(
    () =>
      [
        ...new Set(exercises.map((ex) => ex.difficulty?.toLowerCase())),
      ].sort(),
    [exercises]
  );

  // Filter exercises based on selected filters
  const filteredExercises = useMemo(() => {
    return exercises.filter((exercise) => {
      const matchesMuscle =
        !selectedMuscle || exercise.muscleGroup === selectedMuscle;
      const matchesDifficulty =
        !selectedDifficulty ||
        exercise.difficulty?.toLowerCase() === selectedDifficulty;

      return matchesMuscle && matchesDifficulty;
    });
  }, [exercises, selectedMuscle, selectedDifficulty]);

  return (
    <div className="w-full">
      {/* Filter Section */}
      <div className="mb-8 space-y-4">
        {/* Muscle Group Filter */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Filter by Muscle Group
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedMuscle(null)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedMuscle === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              All Muscles
            </button>
            {muscleGroups.map((muscle) => (
              <button
                key={muscle}
                onClick={() => setSelectedMuscle(muscle)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedMuscle === muscle
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                {muscle}
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty Filter */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Filter by Difficulty
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedDifficulty(null)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedDifficulty === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              All Levels
            </button>
            {difficulties.map((difficulty) => (
              <button
                key={difficulty}
                onClick={() => setSelectedDifficulty(difficulty)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                  selectedDifficulty === difficulty
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                {difficulty}
              </button>
            ))}
          </div>
        </div>

        {/* Exercise Count */}
        <p className="text-sm text-gray-600">
          Showing {filteredExercises.length} of {exercises.length} exercises
        </p>
      </div>

      {/* Grid Layout */}
      {filteredExercises.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExercises.map((exercise, index) => (
            <ExerciseCard
              key={index}
              exercise={exercise}
              isSelected={selectedExercises.some((ex) => ex.name === exercise.name)}
              onSelect={onSelectExercise}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">
            No exercises found with the selected filters.
          </p>
        </div>
      )}
    </div>
  );
};

export default ExerciseGrid;
