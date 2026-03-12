const fs = require("fs");
const path = require("path");

const EXERCISE_LIBRARY_DIR = path.join(__dirname, "..", "src", "exercise-library");
const seedPath = path.join(EXERCISE_LIBRARY_DIR, "exercise-seed-list-2.json");
const exercisesPath = path.join(EXERCISE_LIBRARY_DIR, "exercises.json");

const DEFAULT_BATCH_SIZE = 10;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    size: DEFAULT_BATCH_SIZE,
    priority: null,
    json: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--size" || arg === "-s") {
      const next = Number(args[i + 1]);
      if (!Number.isInteger(next) || next <= 0) {
        throw new Error("La valeur de --size doit être un entier positif.");
      }
      options.size = next;
      i += 1;
      continue;
    }

    if (arg === "--priority" || arg === "-p") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("Tu dois fournir une valeur après --priority.");
      }
      options.priority = next;
      i += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Argument non reconnu: ${arg}`);
  }

  return options;
}

function getPriorityKeys(seedData, requestedPriority) {
  const available = Object.keys(seedData).filter((key) => Array.isArray(seedData[key]));

  if (!requestedPriority) {
    return available;
  }

  const normalized = requestedPriority.startsWith("priority_")
    ? requestedPriority
    : `priority_${requestedPriority}`;

  if (!available.includes(normalized)) {
    throw new Error(
      `Priorité introuvable: ${requestedPriority}. Priorités disponibles: ${available.join(", ")}`
    );
  }

  return [normalized];
}

function main() {
  const { size, priority, json } = parseArgs();

  if (!fs.existsSync(seedPath)) {
    throw new Error(`Fichier introuvable: ${seedPath}`);
  }

  if (!fs.existsSync(exercisesPath)) {
    throw new Error(`Fichier introuvable: ${exercisesPath}`);
  }

  const seed = readJson(seedPath);
  const exercises = readJson(exercisesPath);

  if (!Array.isArray(exercises)) {
    throw new Error("exercises.json doit contenir un array JSON.");
  }

  const doneNames = new Set(exercises.map((exercise) => normalizeName(exercise.name)));

  const priorityKeys = getPriorityKeys(seed, priority);

  const queue = [];
  const seenSeedNames = new Set();

  for (const key of priorityKeys) {
    for (const rawName of seed[key]) {
      const name = String(rawName || "").trim();
      const normalized = normalizeName(name);

      if (!name || seenSeedNames.has(normalized)) {
        continue;
      }

      seenSeedNames.add(normalized);

      if (doneNames.has(normalized)) {
        continue;
      }

      queue.push({
        priority: key,
        name,
      });
    }
  }

  const nextBatch = queue.slice(0, size);

  if (json) {
    process.stdout.write(`${JSON.stringify(nextBatch, null, 2)}\n`);
    return;
  }

  if (nextBatch.length === 0) {
    console.log("Aucun exercice restant à générer pour la sélection demandée.");
    return;
  }

  console.log(`Prochain batch de ${nextBatch.length} exercice(s):\n`);

  nextBatch.forEach((item, index) => {
    console.log(`${index + 1}. [${item.priority}] ${item.name}`);
  });

  console.log("\nJSON:");
  console.log(JSON.stringify(nextBatch, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`Erreur: ${error.message}`);
  process.exit(1);
}