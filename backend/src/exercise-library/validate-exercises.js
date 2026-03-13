const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;

const exercisesPath = path.join(BASE_DIR, 'exercises.json');
const schemaPath = path.join(BASE_DIR, 'exercise-schema.json');
const enumsPath = path.join(BASE_DIR, 'exercise-enums.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Impossible de lire ${filePath}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatValue(value) {
  if (typeof value === 'string') return `"${value}"`;
  return JSON.stringify(value);
}

function addIssue(issues, severity, scope, message) {
  issues.push({ severity, scope, message });
}

function validateType({ value, typeSpec, fieldName, enums, issues, scope }) {
  if (typeSpec === 'string') {
    if (typeof value !== 'string') {
      addIssue(issues, 'error', scope, `${fieldName} doit être une string.`);
      return;
    }
    return;
  }

  if (typeSpec === 'boolean') {
    if (typeof value !== 'boolean') {
      addIssue(issues, 'error', scope, `${fieldName} doit être un boolean.`);
    }
    return;
  }

  if (typeSpec === 'integer') {
    if (!Number.isInteger(value)) {
      addIssue(issues, 'error', scope, `${fieldName} doit être un entier.`);
    }
    return;
  }

  if (typeSpec === 'string[]') {
    if (!Array.isArray(value)) {
      addIssue(issues, 'error', scope, `${fieldName} doit être un array de string.`);
      return;
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string') {
        addIssue(issues, 'error', scope, `${fieldName}[${index}] doit être une string.`);
      }
    });
    return;
  }

  if (typeSpec.startsWith('enum:')) {
    const enumName = typeSpec.slice('enum:'.length);
    const allowedValues = enums[enumName];

    if (!Array.isArray(allowedValues)) {
      addIssue(issues, 'error', scope, `Enum introuvable dans exercise-enums.json: ${enumName}`);
      return;
    }

    if (!allowedValues.includes(value)) {
      addIssue(
        issues,
        'error',
        scope,
        `${fieldName} a une valeur invalide ${formatValue(value)}. Valeurs permises: ${allowedValues.join(', ')}`
      );
    }
    return;
  }

  if (typeSpec.startsWith('enum[]:')) {
    const enumName = typeSpec.slice('enum[]:'.length);
    const allowedValues = enums[enumName];

    if (!Array.isArray(allowedValues)) {
      addIssue(issues, 'error', scope, `Enum introuvable dans exercise-enums.json: ${enumName}`);
      return;
    }

    if (!Array.isArray(value)) {
      addIssue(issues, 'error', scope, `${fieldName} doit être un array.`);
      return;
    }

    value.forEach((item, index) => {
      if (!allowedValues.includes(item)) {
        addIssue(
          issues,
          'error',
          scope,
          `${fieldName}[${index}] a une valeur invalide ${formatValue(item)}. Valeurs permises: ${allowedValues.join(', ')}`
        );
      }
    });
    return;
  }

  if (typeSpec.startsWith('record<') && typeSpec.endsWith('>')) {
    if (!isPlainObject(value)) {
      addIssue(issues, 'error', scope, `${fieldName} doit être un objet clé/valeur.`);
      return;
    }

    const inner = typeSpec.slice('record<'.length, -1);
    const [keyEnumNameRaw, valueEnumNameRaw] = inner.split(',').map((part) => part.trim());
    const keyAllowedValues = enums[keyEnumNameRaw];
    const valueAllowedValues = enums[valueEnumNameRaw];

    if (!Array.isArray(keyAllowedValues)) {
      addIssue(issues, 'error', scope, `Enum introuvable dans exercise-enums.json: ${keyEnumNameRaw}`);
      return;
    }

    if (!Array.isArray(valueAllowedValues)) {
      addIssue(issues, 'error', scope, `Enum introuvable dans exercise-enums.json: ${valueEnumNameRaw}`);
      return;
    }

    for (const [key, entryValue] of Object.entries(value)) {
      if (!keyAllowedValues.includes(key)) {
        addIssue(
          issues,
          'error',
          scope,
          `${fieldName} contient une clé invalide ${formatValue(key)}. Clés permises: ${keyAllowedValues.join(', ')}`
        );
      }

      if (!valueAllowedValues.includes(entryValue)) {
        addIssue(
          issues,
          'error',
          scope,
          `${fieldName}.${key} a une valeur invalide ${formatValue(entryValue)}. Valeurs permises: ${valueAllowedValues.join(', ')}`
        );
      }
    }
    return;
  }

  addIssue(issues, 'error', scope, `Type non géré dans le validateur pour ${fieldName}: ${typeSpec}`);
}

function hasDuplicates(arr) {
  return new Set(arr).size !== arr.length;
}

function getDuplicates(arr) {
  const counts = new Map();
  const duplicates = [];
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  for (const [item, count] of counts.entries()) {
    if (count > 1) duplicates.push(item);
  }
  return duplicates;
}

function validateExercise(exercise, index, schema, enums, issues) {
  const scope = `exercise[${index}]${exercise && exercise.name ? ` ${exercise.name}` : ''}`;

  if (!isPlainObject(exercise)) {
    addIssue(issues, 'error', scope, `Chaque entrée doit être un objet JSON.`);
    return;
  }

  const requiredFields = schema.requiredFields || [];
  const optionalFields = schema.optionalFields || [];
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  const fieldTypes = schema.fieldTypes || {};

  for (const field of requiredFields) {
    if (!(field in exercise)) {
      addIssue(issues, 'error', scope, `Champ requis manquant: ${field}`);
    }
  }

  for (const field of Object.keys(exercise)) {
    if (!allowedFields.has(field)) {
      addIssue(issues, 'warning', scope, `Champ non prévu par le schema: ${field}`);
    }
  }

  for (const [fieldName, typeSpec] of Object.entries(fieldTypes)) {
    if (fieldName in exercise) {
      validateType({
        value: exercise[fieldName],
        typeSpec,
        fieldName,
        enums,
        issues,
        scope,
      });
    }
  }

  if (typeof exercise.exerciseId === 'string') {
    if (!exercise.exerciseId.startsWith('exr_')) {
      addIssue(issues, 'error', scope, `exerciseId doit commencer par exr_.`);
    }

    if (!/^exr_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(exercise.exerciseId)) {
      addIssue(issues, 'error', scope, `exerciseId doit respecter le snake_case.`);
    }
  }

  const arrayMinOneFields = ['equipmentNeeded', 'bodyParts', 'targetMuscles'];  for (const fieldName of arrayMinOneFields) {
    if (fieldName in exercise) {
      if (!Array.isArray(exercise[fieldName]) || exercise[fieldName].length < 1) {
        addIssue(issues, 'error', scope, `${fieldName} doit contenir au moins 1 item.`);
      }
    }
  }

  if (Array.isArray(exercise.targetMuscles) && hasDuplicates(exercise.targetMuscles)) {
    addIssue(
      issues,
      'error',
      scope,
      `targetMuscles contient des doublons: ${getDuplicates(exercise.targetMuscles).join(', ')}`
    );
  }

  if (Array.isArray(exercise.secondaryMuscles) && hasDuplicates(exercise.secondaryMuscles)) {
    addIssue(
      issues,
      'error',
      scope,
      `secondaryMuscles contient des doublons: ${getDuplicates(exercise.secondaryMuscles).join(', ')}`
    );
  }

  if (Array.isArray(exercise.targetMuscles) && Array.isArray(exercise.secondaryMuscles)) {
    const overlap = exercise.targetMuscles.filter((muscle) => exercise.secondaryMuscles.includes(muscle));
    if (overlap.length > 0) {
      addIssue(
        issues,
        'error',
        scope,
        `targetMuscles et secondaryMuscles ne doivent pas se chevaucher. Chevauchement: ${[...new Set(overlap)].join(', ')}`
      );
    }
  }

  if (isPlainObject(exercise.muscleActivation)) {
    const targetMuscles = Array.isArray(exercise.targetMuscles) ? exercise.targetMuscles : [];
    const secondaryMuscles = Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [];
    const allowedActivationKeys = new Set([...targetMuscles, ...secondaryMuscles]);

    for (const key of Object.keys(exercise.muscleActivation)) {
      if (!allowedActivationKeys.has(key)) {
        addIssue(
          issues,
          'error',
          scope,
          `muscleActivation contient la clé ${key}, qui n'existe ni dans targetMuscles ni dans secondaryMuscles.`
        );
      }
    }

    for (const targetMuscle of targetMuscles) {
      if (!(targetMuscle in exercise.muscleActivation)) {
        addIssue(
          issues,
          'error',
          scope,
          `Chaque targetMuscle doit exister dans muscleActivation. Manquant: ${targetMuscle}`
        );
      }
    }

    const hasPrimaryActivation = targetMuscles.some(
      (muscle) => exercise.muscleActivation[muscle] === 1.0
    );

    if (targetMuscles.length > 0 && !hasPrimaryActivation) {
      addIssue(
        issues,
        'error',
        scope,
        `Au moins un target muscle doit avoir une activation de 1.0.`
      );
    }
  }

  if ('fatigueScore' in exercise) {
    if (!Number.isInteger(exercise.fatigueScore) || exercise.fatigueScore < 1 || exercise.fatigueScore > 5) {
      addIssue(issues, 'error', scope, `fatigueScore doit être un entier entre 1 et 5.`);
    }
  }

  if (Array.isArray(exercise.aliases) && hasDuplicates(exercise.aliases)) {
    addIssue(
      issues,
      'warning',
      scope,
      `aliases contient des doublons: ${getDuplicates(exercise.aliases).join(', ')}`
    );
  }

  if (Array.isArray(exercise.keywords) && hasDuplicates(exercise.keywords)) {
    addIssue(
      issues,
      'warning',
      scope,
      `keywords contient des doublons: ${getDuplicates(exercise.keywords).join(', ')}`
    );
  }
}

function validateGlobalRules(exercises, issues) {
  const idMap = new Map();
  const nameMap = new Map();

  exercises.forEach((exercise, index) => {
    if (exercise && typeof exercise.exerciseId === 'string') {
      if (!idMap.has(exercise.exerciseId)) idMap.set(exercise.exerciseId, []);
      idMap.get(exercise.exerciseId).push(index);
    }

    if (exercise && typeof exercise.name === 'string') {
      const normalizedName = exercise.name.trim().toLowerCase();
      if (!nameMap.has(normalizedName)) nameMap.set(normalizedName, []);
      nameMap.get(normalizedName).push(index);
    }
  });

  for (const [exerciseId, indexes] of idMap.entries()) {
    if (indexes.length > 1) {
      addIssue(
        issues,
        'error',
        'global',
        `exerciseId dupliqué: ${exerciseId}. Index: ${indexes.join(', ')}`
      );
    }
  }

  for (const [normalizedName, indexes] of nameMap.entries()) {
    if (indexes.length > 1) {
      addIssue(
        issues,
        'warning',
        'global',
        `name potentiellement dupliqué: ${normalizedName}. Index: ${indexes.join(', ')}`
      );
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--exercises') options.exercisesPath = args[i + 1];
    if (arg === '--schema') options.schemaPath = args[i + 1];
    if (arg === '--enums') options.enumsPath = args[i + 1];
  }

  return options;
}

function main() {
    const args = parseArgs();
  
    const finalExercisesPath = args.exercisesPath
      ? path.resolve(args.exercisesPath)
      : exercisesPath;
  
    const finalSchemaPath = args.schemaPath
      ? path.resolve(args.schemaPath)
      : schemaPath;
  
    const finalEnumsPath = args.enumsPath
      ? path.resolve(args.enumsPath)
      : enumsPath;
  
    if (!fs.existsSync(finalExercisesPath)) {
      throw new Error(`Fichier introuvable: ${finalExercisesPath}`);
    }
    if (!fs.existsSync(finalSchemaPath)) {
      throw new Error(`Fichier introuvable: ${finalSchemaPath}`);
    }
    if (!fs.existsSync(finalEnumsPath)) {
      throw new Error(`Fichier introuvable: ${finalEnumsPath}`);
    }
  
    const exercises = readJson(finalExercisesPath);
    const schema = readJson(finalSchemaPath);
    const enums = readJson(finalEnumsPath);
  
    if (!Array.isArray(exercises)) {
      throw new Error(`exercises.json doit contenir un array JSON à la racine.`);
    }
  
    const issues = [];
  
    exercises.forEach((exercise, index) => {
      validateExercise(exercise, index, schema, enums, issues);
    });
  
    validateGlobalRules(exercises, issues);
  
    const errors = issues.filter((issue) => issue.severity === 'error');
    const warnings = issues.filter((issue) => issue.severity === 'warning');
  
    console.log(`\nValidation terminée`);
    console.log(`Exercices analysés: ${exercises.length}`);
    console.log(`Erreurs: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}\n`);
  
    if (issues.length === 0) {
      console.log('Aucun problème détecté. exercises.json est conforme au schema actuel.');
      process.exit(0);
    }
  
    for (const issue of issues) {
      const prefix = issue.severity === 'error' ? 'ERROR' : 'WARN';
      console.log(`[${prefix}] [${issue.scope}] ${issue.message}`);
    }
  
    process.exit(errors.length > 0 ? 1 : 0);
  }

try {
  main();
} catch (error) {
  console.error(`\nÉchec de validation: ${error.message}`);
  process.exit(1);
}
