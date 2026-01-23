/**
 * TrainingDayBuilder Component
 * 
 * Allows configuration of a single training day:
 * - Add exercises to the day
 * - Set number of sets, reps, tempo, and RIR for each exercise
 * - Remove exercises from the day
 */

import { useState } from 'react';

const TrainingDayBuilder = ({
  dayNumber,
  dayName,
  selectedExercises,
  dayExercises,
  onUpdateDayExercises,
  onRemoveDay,
}) => {
  // State for the exercise being added
  const [selectedExerciseName, setSelectedExerciseName] = useState('');

  // Get exercises already added to this day
  const addedExerciseNames = dayExercises.map((ex) => ex.name);

  // Get available exercises (not already in this day)
  const availableExercises = selectedExercises.filter(
    (ex) => !addedExerciseNames.includes(ex.name)
  );

  // Handle adding an exercise to the day
  const handleAddExercise = () => {
    if (!selectedExerciseName) return;

    const exercise = selectedExercises.find(
      (ex) => ex.name === selectedExerciseName
    );
    if (!exercise) return;

    const newDayExercise = {
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      equipment: exercise.equipment,
      sets: 3,
      reps: '8-10',
      tempo: exercise.tempo,
      rir: 2,
    };

    onUpdateDayExercises([...dayExercises, newDayExercise]);
    setSelectedExerciseName('');
  };

  // Handle updating an exercise in the day
  const handleUpdateExercise = (index, field, value) => {
    const updated = [...dayExercises];
    updated[index] = { ...updated[index], [field]: value };
    onUpdateDayExercises(updated);
  };

  // Handle removing an exercise from the day
  const handleRemoveExercise = (index) => {
    onUpdateDayExercises(dayExercises.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border-l-4 border-blue-500">
      {/* Day Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900">{dayName}</h3>
          <p className="text-sm text-gray-600">
            {dayExercises.length} exercise{dayExercises.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={onRemoveDay}
          className="px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-semibold transition-colors"
        >
          Remove Day
        </button>
      </div>

      {/* Add Exercise Section */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Add Exercise to {dayName}
        </label>
        <div className="flex gap-2">
          <select
            value={selectedExerciseName}
            onChange={(e) => setSelectedExerciseName(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">Select an exercise...</option>
            {availableExercises.map((exercise) => (
              <option key={exercise.name} value={exercise.name}>
                {exercise.name} ({exercise.muscleGroup})
              </option>
            ))}
          </select>
          <button
            onClick={handleAddExercise}
            disabled={!selectedExerciseName}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
          >
            Add
          </button>
        </div>
        {availableExercises.length === 0 && selectedExercises.length > 0 && (
          <p className="text-xs text-yellow-700 mt-2">
            All selected exercises have been added to this day.
          </p>
        )}
      </div>

      {/* Exercises in Day */}
      {dayExercises.length > 0 ? (
        <div className="space-y-4">
          {dayExercises.map((exercise, index) => (
            <div
              key={index}
              className="p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              {/* Exercise Name */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-semibold text-gray-900">
                    {index + 1}. {exercise.name}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    {exercise.muscleGroup} • {exercise.equipment}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveExercise(index)}
                  className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-semibold transition-colors"
                >
                  Remove
                </button>
              </div>

              {/* Exercise Configuration */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Sets */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Sets
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={exercise.sets}
                    onChange={(e) =>
                      handleUpdateExercise(
                        index,
                        'sets',
                        parseInt(e.target.value)
                      )
                    }
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Reps */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Reps
                  </label>
                  <input
                    type="text"
                    value={exercise.reps}
                    onChange={(e) =>
                      handleUpdateExercise(index, 'reps', e.target.value)
                    }
                    placeholder="e.g., 8-10"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Tempo */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Tempo
                  </label>
                  <input
                    type="text"
                    value={exercise.tempo}
                    onChange={(e) =>
                      handleUpdateExercise(index, 'tempo', e.target.value)
                    }
                    placeholder="e.g., 2-1-2"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* RIR */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    RIR
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={exercise.rir}
                    onChange={(e) =>
                      handleUpdateExercise(index, 'rir', parseInt(e.target.value))
                    }
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-500 text-sm">No exercises added to this day yet.</p>
        </div>
      )}
    </div>
  );
};

export default TrainingDayBuilder;
