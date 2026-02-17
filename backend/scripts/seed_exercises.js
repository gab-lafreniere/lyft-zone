/**
 * Seed script
 * Lit data/exercisedb_raw.json et génère data/exercises.seed.json
 *
 * Usage:
 *   node scripts/seed_exercises.js
 * Options:
 *   --in=PATH
 *   --out=PATH
 */

const fs = require("fs");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    inPath: path.join(__dirname, "../data/exercisedb_raw.json"),
    outPath: path.join(__dirname, "../data/exercises.seed.json"),
  };

  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) continue;
    const key = arg.slice(2, eq).trim();
    const value = arg.slice(eq + 1).trim();
    if (key === "in") opts.inPath = value;
    if (key === "out") opts.outPath = value;
  }
  return opts;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function cleanStr(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = cleanStr(v);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function pickId(ex) {
  return cleanStr(ex.exerciseId) || cleanStr(ex.id) || cleanStr(ex._id) || null;
}

function normalizeExercise(ex) {
  const id = pickId(ex);
  if (!id) return null;

  const name = cleanStr(ex.name);
  if (!name) return null;

  const nowIso = new Date().toISOString();

  return {
    id, // ton id interne = id source
    source: "exercisedb_hobby",
    sourceId: id,

    name,
    imageUrl: cleanStr(ex.imageUrl),

    bodyParts: uniqStrings(asArray(ex.bodyParts)),
    equipments: uniqStrings(asArray(ex.equipments)),
    exerciseType: cleanStr(ex.exerciseType),

    targetMuscles: uniqStrings(asArray(ex.targetMuscles)),
    secondaryMuscles: uniqStrings(asArray(ex.secondaryMuscles)),
    keywords: uniqStrings(asArray(ex.keywords)),

    // champs internes pour phase 2 (enrichissement)
    meta: {
      movementType: null,
      tensionProfile: null,
      systemicFatigue: null,
      recommendedTempo: null,
      substitutes: [],
    },

    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.inPath)) {
    console.error(`Fichier introuvable: ${opts.inPath}`);
    process.exit(1);
  }

  const rawText = fs.readFileSync(opts.inPath, "utf8");
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (e) {
    console.error("JSON invalide dans le fichier source");
    process.exit(1);
  }

  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  if (!Array.isArray(list) || list.length === 0) {
    console.error("Aucun exercice trouvé dans la source");
    process.exit(1);
  }

  const out = [];
  const seen = new Set();

  for (const ex of list) {
    const norm = normalizeExercise(ex);
    if (!norm) continue;
    if (seen.has(norm.id)) continue;
    seen.add(norm.id);
    out.push(norm);
  }

  ensureDir(opts.outPath);
  fs.writeFileSync(opts.outPath, JSON.stringify(out, null, 2), "utf8");

  console.log(`OK: ${out.length} exercices seed écrits`);
  console.log(`IN : ${opts.inPath}`);
  console.log(`OUT: ${opts.outPath}`);
}

main();
