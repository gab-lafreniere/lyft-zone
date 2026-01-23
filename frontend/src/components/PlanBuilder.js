/**
 * PlanBuilder Component
 * 
 * Allows users to create a training plan draft by:
 * - Setting plan name and structure (weeks, training days per week)
 * - Configuring individual training days
 * - Saving the plan draft
 */

import { useState } from 'react';
import TrainingDayBuilder from './TrainingDayBuilder';

const PlanBuilder = ({ selectedExercises, onSavePlan }) => {
  // Plan configuration
  const [planName, setPlanName] = useState('');
  const [weeks, setWeeks] = useState(6);
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState(3);

  // Plan days state
  const [planDays, setPlanDays] = useState(
    Array.from({ length: 3 }, (_, i) => ({
      dayNumber: i + 1,
      name: `Training Day ${i + 1}`,
      exercises: [],
    }))
  );

  // Handle updating training days per week
  const handleTrainingDaysChange = (newCount) => {
    setTrainingDaysPerWeek(newCount);

    if (newCount > planDays.length) {
      // Add new days
      const newDays = Array.from(
        { length: newCount - planDays.length },
        (_, i) => ({
          dayNumber: planDays.length + i + 1,
          name: `Training Day ${planDays.length + i + 1}`,
          exercises: [],
        })
      );
      setPlanDays([...planDays, ...newDays]);
    } else if (newCount < planDays.length) {
      // Remove days from the end
      setPlanDays(planDays.slice(0, newCount));
    }
  };

  // Handle updating a day's exercises
  const handleUpdateDayExercises = (dayIndex, exercises) => {
    const updated = [...planDays];
    updated[dayIndex] = { ...updated[dayIndex], exercises };
    setPlanDays(updated);
  };

  // Handle removing a day
  const handleRemoveDay = (dayIndex) => {
    const updated = planDays.filter((_, i) => i !== dayIndex);
    // Renumber the remaining days
    const renumbered = updated.map((day, i) => ({
      ...day,
      dayNumber: i + 1,
      name: `Training Day ${i + 1}`,
    }));
    setPlanDays(renumbered);
    setTrainingDaysPerWeek(renumbered.length);
  };

  // Validate the plan
  const validatePlan = () => {
    if (!planName.trim()) {
      alert('Please enter a plan name');
      return false;
    }

    if (selectedExercises.length === 0) {
      alert('Please select at least one exercise');
      return false;
    }

    // Check that each day has at least one exercise
    const daysWithoutExercises = planDays.filter(
      (day) => day.exercises.length === 0
    );
    if (daysWithoutExercises.length > 0) {
      alert(
        `Please add at least one exercise to each training day. Missing exercises in: ${daysWithoutExercises
          .map((d) => d.name)
          .join(', ')}`
      );
      return false;
    }

    return true;
  };

  // Handle saving the plan
  const handleSavePlan = () => {
    if (!validatePlan()) return;

    // Build the plan object
    const plan = {
      name: planName.trim(),
      weeks: parseInt(weeks),
      trainingDaysPerWeek: planDays.length,
      days: planDays.map((day) => ({
        dayNumber: day.dayNumber,
        name: day.name,
        exercises: day.exercises.map((ex) => ({
          name: ex.name,
          sets: ex.sets,
          reps: ex.reps,
          tempo: ex.tempo,
          rir: ex.rir,
        })),
      })),
    };

    // Log to console for review
    console.log('Plan Draft Ready to Save:', plan);

    // Call the parent callback
    onSavePlan(plan);
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow-lg p-6 md:p-8">
      {/* Section Title */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Build Your Plan</h2>
        <p className="text-gray-600 mt-2">
          Configure your training plan structure and assign exercises to each day
        </p>
      </div>

      {/* Plan Configuration */}
      <div className="bg-white rounded-lg p-6 mb-8 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Plan Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Plan Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Plan Name *
            </label>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="e.g., 6-Week Strength Plan"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Weeks */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Duration (Weeks)
            </label>
            <input
              type="number"
              min="1"
              max="52"
              value={weeks}
              onChange={(e) => setWeeks(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Training Days Per Week */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Training Days Per Week
            </label>
            <select
              value={trainingDaysPerWeek}
              onChange={(e) => handleTrainingDaysChange(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[2, 3, 4, 5, 6].map((num) => (
                <option key={num} value={num}>
                  {num} days/week
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          * = Required field
        </p>
      </div>

      {/* Check for Selected Exercises */}
      {selectedExercises.length === 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded mb-8">
          <p className="text-yellow-800 text-sm font-semibold">
            ⚠️ Please select at least one exercise from the library above to begin building your plan.
          </p>
        </div>
      )}

      {/* Training Days */}
      {selectedExercises.length > 0 && (
        <>
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Training Days ({planDays.length})
            </h3>
            <p className="text-sm text-gray-600">
              Add exercises to each training day and configure their volume (sets, reps, tempo, RIR)
            </p>
          </div>

          <div className="mb-8">
            {planDays.map((day, index) => (
              <TrainingDayBuilder
                key={index}
                dayNumber={day.dayNumber}
                dayName={day.name}
                selectedExercises={selectedExercises}
                dayExercises={day.exercises}
                onUpdateDayExercises={(exercises) =>
                  handleUpdateDayExercises(index, exercises)
                }
                onRemoveDay={() => handleRemoveDay(index)}
              />
            ))}
          </div>

          {/* Save Button */}
          <div className="flex gap-4 justify-center md:justify-end">
            <button
              onClick={handleSavePlan}
              disabled={!planName.trim() || selectedExercises.length === 0}
              className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold transition-colors text-lg"
            >
              Save Plan Draft
            </button>
          </div>

          {/* Info Box */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              <span className="font-semibold">📋 Tip:</span> Check the browser console (F12) after saving to see the complete plan object that will be sent to the backend in Phase 3.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default PlanBuilder;
