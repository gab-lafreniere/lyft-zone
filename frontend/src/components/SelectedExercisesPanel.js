/**
 * SelectedExercisesPanel Component
 * 
 * Displays the list of selected exercises with the ability to remove them.
 * Also shows a preview of what will be available for the plan builder.
 */

const SelectedExercisesPanel = ({ exercises, onRemove }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 sticky top-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          Selected Exercises
        </h2>
        <p className="text-gray-600 text-sm mt-1">
          {exercises.length} exercise{exercises.length !== 1 ? 's' : ''} selected
        </p>
      </div>

      {/* Selected Exercises List */}
      {exercises.length > 0 ? (
        <div className="space-y-3">
          {exercises.map((exercise, index) => (
            <div
              key={index}
              className="flex items-start justify-between bg-gray-50 p-3 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors"
            >
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">
                  {exercise.name}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {exercise.muscleGroup} • {exercise.equipment}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Difficulty: {exercise.difficulty} | Tempo: {exercise.tempo}
                </p>
              </div>
              <button
                onClick={() => onRemove(exercise.name)}
                className="ml-2 px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-semibold transition-colors flex-shrink-0"
                title="Remove exercise"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">
            No exercises selected yet.
          </p>
          <p className="text-gray-400 text-xs mt-2">
            Select exercises from the library above to begin building your plan.
          </p>
        </div>
      )}

      {/* Info Box */}
      {exercises.length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-900">
            <span className="font-semibold">Tip:</span> You'll assign these exercises to specific training days in the plan builder below.
          </p>
        </div>
      )}
    </div>
  );
};

export default SelectedExercisesPanel;
