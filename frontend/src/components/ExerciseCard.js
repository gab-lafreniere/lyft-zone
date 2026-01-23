/**
 * ExerciseCard Component
 * 
 * Displays a single exercise with its image, name, muscle group,
 * equipment, difficulty level, and tempo information.
 * Includes a select/deselect button for building training plans.
 */

const ExerciseCard = ({ exercise, isSelected, onSelect }) => {
  // Determine badge color based on difficulty level
  const getDifficultyColor = (difficulty) => {
    switch (difficulty?.toLowerCase()) {
      case 'beginner':
        return 'bg-green-100 text-green-800';
      case 'intermediate':
        return 'bg-yellow-100 text-yellow-800';
      case 'hard':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div
      className={`rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-all duration-300 ${
        isSelected
          ? 'ring-2 ring-blue-600 bg-blue-50'
          : 'bg-white'
      }`}
    >
      {/* Exercise Image */}
      <div className="w-full h-48 bg-gray-200 overflow-hidden">
        <img
          src={exercise.imageUrl}
          alt={exercise.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback image if the URL fails to load
            e.target.src =
              'https://via.placeholder.com/300x300?text=Exercise';
          }}
        />
      </div>

      {/* Exercise Details */}
      <div className="p-4">
        {/* Exercise Name */}
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {exercise.name}
        </h3>

        {/* Muscle Group and Equipment Row */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-medium">
            {exercise.muscleGroup}
          </span>
          <span className="inline-block bg-purple-100 text-purple-800 px-2 py-1 rounded text-sm font-medium">
            {exercise.equipment}
          </span>
        </div>

        {/* Difficulty and Tempo Row */}
        <div className="flex gap-2 justify-between items-center mb-4">
          <span
            className={`inline-block px-2 py-1 rounded text-sm font-medium ${getDifficultyColor(
              exercise.difficulty
            )}`}
          >
            {exercise.difficulty?.charAt(0).toUpperCase() +
              exercise.difficulty?.slice(1)}
          </span>
          <span className="text-sm text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
            Tempo: {exercise.tempo}
          </span>
        </div>

        {/* Select Button */}
        <button
          onClick={() => onSelect(exercise)}
          className={`w-full py-2 px-3 rounded-lg font-semibold transition-colors ${
            isSelected
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isSelected ? '✓ Deselect' : 'Select'}
        </button>
      </div>
    </div>
  );
};

export default ExerciseCard;
