const fs = require("fs");
const path = require("path");

function loadExercisesSeed() {
  const seedPath = path.join(__dirname, "../../data/exercises.seed.json");
  const raw = fs.readFileSync(seedPath, "utf8");
  const items = JSON.parse(raw);

  const byId = new Map();
  const bodyParts = new Set();
  const equipments = new Set();
  const types = new Set();
  const muscles = new Set();

  for (const ex of items) {
    byId.set(ex.id, ex);

    for (const v of ex.bodyParts || []) bodyParts.add(v);
    for (const v of ex.equipments || []) equipments.add(v);
    if (ex.exerciseType) types.add(ex.exerciseType);

    for (const v of ex.targetMuscles || []) muscles.add(v);
    for (const v of ex.secondaryMuscles || []) muscles.add(v);
  }

  return {
    items,
    byId,
    filters: {
      bodyParts: Array.from(bodyParts).sort(),
      equipments: Array.from(equipments).sort(),
      exerciseTypes: Array.from(types).sort(),
      muscles: Array.from(muscles).sort(),
    },
  };
}

module.exports = { loadExercisesSeed };
