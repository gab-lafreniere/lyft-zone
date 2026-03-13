const fs = require("fs");
const path = require("path");

const EXERCISE_LIBRARY_DIR = path.join(__dirname, "..", "src", "exercise-library");
const exercisesPath = path.join(EXERCISE_LIBRARY_DIR, "exercises.json");
const enumsPath = path.join(EXERCISE_LIBRARY_DIR, "exercise-enums.json");
const schemaPath = path.join(EXERCISE_LIBRARY_DIR, "exercise-schema.json");
const templatePath = path.join(EXERCISE_LIBRARY_DIR, "exercise-template.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toSnakeCaseId(name) {
  return `exr_${String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")}`;
}

function isValidExerciseId(id) {
  return typeof id === "string" && /^exr_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id);
}

function hasDuplicates(arr) {
  return new Set(arr).size !== arr.length;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    throw new Error(
      "Tu dois fournir le chemin du batch. Exemple: node scripts/validate-and-merge-batch.js generated-batches/batch-001.json"
    );
  }

  const batchArg = args[0];
  const options = {
    batchPath: path.isAbsolute(batchArg)
      ? batchArg
      : path.join(__dirname, "..", batchArg),
    dryRun: args.includes("--dry-run"),
  };

  return options;
}

function getAllowedFields(schema, template) {
  const required = Array.isArray(schema.requiredFields) ? schema.requiredFields : [];
  const optional = Array.isArray(schema.optionalFields) ? schema.optionalFields : [];
  const templateFields = isPlainObject(template) ? Object.keys(template) : [];
  return new Set([...required, ...optional, ...templateFields]);
}

function validateFieldTypes(exercise, schema) {
  const errors = [];
  const fieldTypes = schema.fieldTypes || {};

  for (const [field, type] of Object.entries(fieldTypes)) {
    const value = exercise[field];

    if (value === undefined) {
      continue;
    }

    if (type === "string" && typeof value !== "string") {
      errors.push(`${field} doit être une string.`);
      continue;
    }

    if (type === "string[]" && !Array.isArray(value)) {
      errors.push(`${field} doit être un array de strings.`);
      continue;
    }

    if (type === "boolean" && typeof value !== "boolean") {
      errors.push(`${field} doit être un boolean.`);
      continue;
    }

    if (type === "integer" && !Number.isInteger(value)) {
      errors.push(`${field} doit être un integer.`);
      continue;
    }

    if (type.startsWith("enum:")) {
      if (typeof value !== "string") {
        errors.push(`${field} doit être une string.`);
      }
      continue;
    }

    if (type.startsWith("enum[]:")) {
      if (!Array.isArray(value)) {
        errors.push(`${field} doit être un array.`);
      }
      continue;
    }

    if (type.startsWith("record<")) {
      if (!isPlainObject(value)) {
        errors.push(`${field} doit être un objet clé/valeur.`);
      }
      continue;
    }
  }

  return errors;
}

function validateExercise(exercise, context) {
  const {
    schema,
    template,
    enums,
    allExistingIds,
    allExistingNames,
    batchIdsSeen,
    batchNamesSeen,
  } = context;

  const errors = [];
  const allowedFields = getAllowedFields(schema, template);

  if (!isPlainObject(exercise)) {
    return ["Chaque entrée du batch doit être un objet JSON."];
  }

  for (const field of schema.requiredFields || []) {
    if (!(field in exercise)) {
      errors.push(`Champ requis manquant: ${field}`);
    }
  }

  for (const key of Object.keys(exercise)) {
    if (!allowedFields.has(key)) {
      errors.push(`Champ non autorisé: ${key}`);
    }
  }

  errors.push(...validateFieldTypes(exercise, schema));

  if (typeof exercise.exerciseId !== "string" || !exercise.exerciseId.trim()) {
    errors.push("exerciseId est requis et doit être une string non vide.");
  } else {
    if (!isValidExerciseId(exercise.exerciseId)) {
      errors.push(
        `exerciseId invalide: ${exercise.exerciseId}. Format attendu: exr_nom_en_snake_case`
      );
    }

    const expectedId = toSnakeCaseId(exercise.name);
    if (exercise.name && exercise.exerciseId !== expectedId) {
      errors.push(
        `exerciseId incohérent pour "${exercise.name}". Attendu: ${expectedId}, reçu: ${exercise.exerciseId}`
      );
    }

    if (allExistingIds.has(exercise.exerciseId)) {
      errors.push(`exerciseId déjà présent dans exercises.json: ${exercise.exerciseId}`);
    }

    if (batchIdsSeen.has(exercise.exerciseId)) {
      errors.push(`exerciseId en double dans le batch: ${exercise.exerciseId}`);
    }
  }

  if (typeof exercise.name !== "string" || !exercise.name.trim()) {
    errors.push("name est requis et doit être une string non vide.");
  } else {
    const normalizedName = normalizeName(exercise.name);

    if (allExistingNames.has(normalizedName)) {
      errors.push(`name déjà présent dans exercises.json: ${exercise.name}`);
    }

    if (batchNamesSeen.has(normalizedName)) {
      errors.push(`name en double dans le batch: ${exercise.name}`);
    }
  }

  if (
    exercise.equipmentCategory &&
    !enums.equipmentCategory.includes(exercise.equipmentCategory)
  ) {
    errors.push(`equipmentCategory invalide: ${exercise.equipmentCategory}`);
  }

  if (!Array.isArray(exercise.equipmentNeeded) || exercise.equipmentNeeded.length < 1) {
    errors.push("equipmentNeeded doit contenir au moins 1 item.");
  } else {
    for (const item of exercise.equipmentNeeded) {
      if (!enums.equipmentNeeded.includes(item)) {
        errors.push(`equipmentNeeded invalide: ${item}`);
      }
    }
  }

  if (
    exercise.movementPattern &&
    !enums.movementPattern.includes(exercise.movementPattern)
  ) {
    errors.push(`movementPattern invalide: ${exercise.movementPattern}`);
  }

  if (!Array.isArray(exercise.bodyParts) || exercise.bodyParts.length < 1) {
    errors.push("bodyParts doit contenir au moins 1 item.");
  } else {
    for (const item of exercise.bodyParts) {
      if (!enums.bodyParts.includes(item)) {
        errors.push(`bodyParts invalide: ${item}`);
      }
    }
  }

  if (!Array.isArray(exercise.muscleFocus) || exercise.muscleFocus.length < 1) {
    errors.push("muscleFocus doit contenir au moins 1 item.");
  } else {
    for (const item of exercise.muscleFocus) {
      if (!enums.muscleFocus.includes(item)) {
        errors.push(`muscleFocus invalide: ${item}`);
      }
    }
  }

  if (!Array.isArray(exercise.targetMuscles) || exercise.targetMuscles.length < 1) {
    errors.push("targetMuscles doit contenir au moins 1 item.");
  } else {
    for (const item of exercise.targetMuscles) {
      if (!enums.muscles.includes(item)) {
        errors.push(`targetMuscles invalide: ${item}`);
      }
    }

    if (hasDuplicates(exercise.targetMuscles)) {
      errors.push("targetMuscles ne doit pas contenir de doublons.");
    }
  }

  if (!Array.isArray(exercise.secondaryMuscles)) {
    errors.push("secondaryMuscles doit être un array.");
  } else {
    for (const item of exercise.secondaryMuscles) {
      if (!enums.muscles.includes(item)) {
        errors.push(`secondaryMuscles invalide: ${item}`);
      }
    }

    if (hasDuplicates(exercise.secondaryMuscles)) {
      errors.push("secondaryMuscles ne doit pas contenir de doublons.");
    }
  }

  if (Array.isArray(exercise.targetMuscles) && Array.isArray(exercise.secondaryMuscles)) {
    const overlap = exercise.targetMuscles.filter((muscle) =>
      exercise.secondaryMuscles.includes(muscle)
    );

    if (overlap.length > 0) {
      errors.push(
        `targetMuscles et secondaryMuscles ne doivent pas se chevaucher: ${overlap.join(", ")}`
      );
    }
  }

  if (exercise.mechanicType && !enums.mechanicType.includes(exercise.mechanicType)) {
    errors.push(`mechanicType invalide: ${exercise.mechanicType}`);
  }

  if (exercise.unilateralType && !enums.unilateralType.includes(exercise.unilateralType)) {
    errors.push(`unilateralType invalide: ${exercise.unilateralType}`);
  }

  if (exercise.difficulty && !enums.difficulty.includes(exercise.difficulty)) {
    errors.push(`difficulty invalide: ${exercise.difficulty}`);
  }

  if (exercise.trainingType && !enums.trainingType.includes(exercise.trainingType)) {
    errors.push(`trainingType invalide: ${exercise.trainingType}`);
  }

  if (exercise.status && !enums.status.includes(exercise.status)) {
    errors.push(`status invalide: ${exercise.status}`);
  }

  if (!Array.isArray(exercise.keywords)) {
    errors.push("keywords doit être un array.");
  } else if (!exercise.keywords.every((item) => typeof item === "string")) {
    errors.push("keywords doit contenir uniquement des strings.");
  }

  if (typeof exercise.overview !== "string") {
    errors.push("overview doit être une string.");
  }

  if (!Array.isArray(exercise.coachingCues)) {
    errors.push("coachingCues doit être un array.");
  } else if (!exercise.coachingCues.every((item) => typeof item === "string")) {
    errors.push("coachingCues doit contenir uniquement des strings.");
  }

  if (!Array.isArray(exercise.commonMistakes)) {
    errors.push("commonMistakes doit être un array.");
  } else if (!exercise.commonMistakes.every((item) => typeof item === "string")) {
    errors.push("commonMistakes doit contenir uniquement des strings.");
  }

  if (typeof exercise.isSupersetFriendly !== "boolean") {
    errors.push("isSupersetFriendly doit être un boolean.");
  }

  if (!Number.isInteger(exercise.fatigueScore)) {
    errors.push("fatigueScore doit être un integer.");
  } else if (exercise.fatigueScore < 1 || exercise.fatigueScore > 5) {
    errors.push("fatigueScore doit être entre 1 et 5.");
  }

  if (!isPlainObject(exercise.muscleActivation)) {
    errors.push("muscleActivation doit être un objet.");
  } else {
    const allowedActivationValues = new Set(enums.muscleActivationValues);
    const allowedMuscles = new Set([
      ...ensureArray(exercise.targetMuscles),
      ...ensureArray(exercise.secondaryMuscles),
    ]);

    for (const [muscle, activation] of Object.entries(exercise.muscleActivation)) {
      if (!allowedMuscles.has(muscle)) {
        errors.push(
          `Clé muscleActivation invalide ou absente de targetMuscles/secondaryMuscles: ${muscle}`
        );
      }

      if (!allowedActivationValues.has(activation)) {
        errors.push(
          `Valeur muscleActivation invalide pour ${muscle}: ${activation}. Valeurs permises: ${enums.muscleActivationValues.join(", ")}`
        );
      }
    }

    for (const muscle of ensureArray(exercise.targetMuscles)) {
      if (!(muscle in exercise.muscleActivation)) {
        errors.push(`Chaque targetMuscle doit exister dans muscleActivation: ${muscle}`);
      }
    }

    const hasPrimaryTarget = ensureArray(exercise.targetMuscles).some(
      (muscle) => exercise.muscleActivation[muscle] === 1.0
    );

    if (!hasPrimaryTarget) {
      errors.push("Au moins un targetMuscle doit avoir une activation de 1.0.");
    }
  }

  if (
    Array.isArray(exercise.aliases) &&
    !exercise.aliases.every((item) => typeof item === "string")
  ) {
    errors.push("aliases doit contenir uniquement des strings.");
  }

  if (errors.length === 0) {
    batchIdsSeen.add(exercise.exerciseId);
    batchNamesSeen.add(normalizeName(exercise.name));
  }

  return errors;
}