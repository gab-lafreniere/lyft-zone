/**
 * Script de récupération des exercices depuis ExerciseDB API v2
 * Pagination par after (exerciseId) avec limit=25, checkpoint/reprise, sauvegarde périodique atomique.
 *
 * Usage: node scripts/exercisedb_fetch.js [options]
 *
 * Options:
 *   --maxPages=NUMBER     (défaut: 200)
 *   --saveEvery=NUMBER    (défaut: 25)
 *   --delayMs=NUMBER      (défaut: 800)
 *   --maxExercises=NUMBER stop quand total >= NUMBER (optionnel)
 *   --startCursor=STR     reprendre à un afterId donné (ignore le checkpoint)
 *   --output=PATH        fichier de sortie raw JSON
 *   --checkpoint=PATH    fichier checkpoint
 *   --debug              mode debug (affiche détails API, sauvegarde chaque page)
 *   --debugPages=NUMBER  nombre de pages à traiter en debug (défaut: 1)
 *
 * Pagination: utilise after=<lastExerciseId> avec limit=25 (max autorisé)
 * Env: RAPIDAPI_KEY, RAPIDAPI_HOST
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;

const DEFAULT_OUTPUT = path.join(__dirname, '../data/exercisedb_raw.json');
const DEFAULT_CHECKPOINT = path.join(__dirname, '../data/exercisedb_checkpoint.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    maxPages: 200,
    saveEvery: 25,
    delayMs: 800,
    maxExercises: null,
    startCursor: null,
    output: DEFAULT_OUTPUT,
    checkpoint: DEFAULT_CHECKPOINT,
    fresh: false,
    debug: false,
    debugPages: 1,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fresh') {
      opts.fresh = true;
      continue;
    }
    if (arg === '--debug') {
      opts.debug = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      const key = arg.slice(2, eq).trim();
      const value = arg.slice(eq + 1).trim();
      if (key === 'maxPages') opts.maxPages = parseInt(value, 10) || opts.maxPages;
      else if (key === 'saveEvery') opts.saveEvery = parseInt(value, 10) || opts.saveEvery;
      else if (key === 'delayMs') opts.delayMs = parseInt(value, 10) || opts.delayMs;
      else if (key === 'maxExercises') opts.maxExercises = value === '' ? null : parseInt(value, 10) || null;
      else if (key === 'startCursor') opts.startCursor = value || null;
      else if (key === 'output') opts.output = value || opts.output;
      else if (key === 'checkpoint') opts.checkpoint = value || opts.checkpoint;
      else if (key === 'debugPages') opts.debugPages = parseInt(value, 10) || opts.debugPages;
    } else if (i + 1 < args.length) {
      const key = arg.slice(2).trim();
      const value = args[++i];
      if (key === 'startCursor') opts.startCursor = value;
      else if (key === 'output') opts.output = value;
      else if (key === 'checkpoint') opts.checkpoint = value;
      else if (key === 'maxExercises') opts.maxExercises = value === '' ? null : parseInt(value, 10) || null;
      else if (key === 'debugPages') opts.debugPages = parseInt(value, 10) || opts.debugPages;
    }
  }
  return opts;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCheckpoint(checkpointPath) {
  try {
    if (!fs.existsSync(checkpointPath)) return null;
    const raw = fs.readFileSync(checkpointPath, 'utf8');
    const data = JSON.parse(raw);
    if (data && (data.cursor != null || data.pageNumber != null)) return data;
    return null;
  } catch {
    return null;
  }
}

function writeCheckpoint(checkpointPath, data) {
  ensureDir(checkpointPath);
  const payload = {
    cursor: data.cursor ?? null,
    pageNumber: data.pageNumber,
    totalExercises: data.totalExercises,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(checkpointPath, JSON.stringify(payload, null, 2), 'utf8');
}

function loadRaw(outputPath) {
  try {
    if (!fs.existsSync(outputPath)) return [];
    const raw = fs.readFileSync(outputPath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function getExerciseId(ex) {
  return ex?.id ?? ex?.exerciseId ?? ex?._id ?? null;
}

function existingExerciseIds(exercises) {
  const set = new Set();
  for (const ex of exercises) {
    const id = getExerciseId(ex);
    if (id != null && id !== '') set.add(String(id));
  }
  return set;
}

function saveRawAtomic(outputPath, exercises) {
  ensureDir(outputPath);
  const tmpPath = outputPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(exercises, null, 2), 'utf8');
  fs.renameSync(tmpPath, outputPath);
}

async function fetchExercisesPage(afterId, opts) {
  const baseUrl = `https://${RAPIDAPI_HOST}/api/v1/exercises`;
  const limit = 25; // Max autorisé selon la doc
  const params = new URLSearchParams();
  params.append('limit', String(limit));
  if (afterId) {
    params.append('after', afterId);
  }
  const url = `${baseUrl}?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': RAPIDAPI_KEY,
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
  });

  const errText = await response.text();
  if (!response.ok) {
    const err = new Error(`API ${response.status}: ${errText}`);
    err.status = response.status;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(errText);
  } catch {
    throw new Error('Réponse API non-JSON: ' + errText.slice(0, 200));
  }

  return data;
}

function extractPage(response, limit = 25) {
  let list = response.data ?? response.exercises ?? response.results ?? [];
  if (!Array.isArray(list)) list = [];

  // Extraire le dernier exerciseId pour la pagination suivante
  const lastId = list.length > 0 ? (list[list.length - 1]?.exerciseId ?? list[list.length - 1]?.id ?? null) : null;

  // hasNextPage : si la liste est pleine (length === limit), il y a probablement une page suivante
  // Si la liste est vide ou < limit, on a atteint la fin
  const hasNext = list.length === limit && lastId != null;

  return { list, hasNextPage: hasNext, nextAfterId: lastId };
}

async function run(opts) {
  if (!RAPIDAPI_KEY || !RAPIDAPI_HOST) {
    console.error('❌ RAPIDAPI_KEY et RAPIDAPI_HOST doivent être définis (.env)');
    process.exit(1);
  }
  if (opts.fresh) {
    try { if (fs.existsSync(opts.output)) fs.unlinkSync(opts.output); } catch {}
    try { if (fs.existsSync(opts.checkpoint)) fs.unlinkSync(opts.checkpoint); } catch {}
    console.log('🧼 Mode --fresh: fichiers raw et checkpoint supprimés, démarrage à zéro\n');
  }  

  let afterId = null;
  let pageNumber = 1;
  let allExercises = [];
  const useStartCursor = opts.startCursor != null && opts.startCursor !== '';
  const checkpointExists = !opts.fresh ? readCheckpoint(opts.checkpoint) : null;

  if (useStartCursor) {
    afterId = opts.startCursor; // Utilisé comme afterId maintenant
    pageNumber = 1;
    allExercises = [];
    console.log('🔄 Reprise avec --startCursor (ignore checkpoint)\n');
  } else if (checkpointExists) {
    afterId = checkpointExists.cursor ?? null; // Le checkpoint stocke le dernier afterId
    pageNumber = Math.max(1, parseInt(checkpointExists.pageNumber, 10) || 1);
    allExercises = loadRaw(opts.output);
    console.log(`🔄 Reprise depuis checkpoint: page ${pageNumber}, ${allExercises.length} exercices déjà en fichier\n`);
  } else {
    afterId = null;
    pageNumber = 1;
    allExercises = [];
    console.log('🔄 Début récupération (sans checkpoint)\n');
  }

  const seenIds = existingExerciseIds(allExercises);
  let hasNextPage = true;
  const maxPages = Math.max(1, opts.maxPages);
  const saveEvery = Math.max(1, opts.saveEvery);
  const delayMs = Math.max(0, opts.delayMs);
  const maxExercises = opts.maxExercises != null && opts.maxExercises > 0 ? opts.maxExercises : null;
  let pagesLeftThisRun = maxPages;

  const limit = 25; // Max autorisé selon la doc API
  while (hasNextPage && pagesLeftThisRun > 0) {
    try {
      const response = await fetchExercisesPage(afterId, opts);
      const { list, hasNextPage: next, nextAfterId } = extractPage(response, limit);
      
      const baseUrl = `https://${RAPIDAPI_HOST}/api/v1/exercises`;
      const params = new URLSearchParams();
      params.append('limit', String(limit));
      if (afterId) params.append('after', afterId);
      const url = `${baseUrl}?${params.toString()}`;

      if (opts.debug) {
        console.log('\n🔍 [DEBUG] URL appelée:', url);
        console.log('🔍 [DEBUG] after utilisé:', afterId || '(null - première page)');
        console.log('🔍 [DEBUG] Object.keys(response):', Object.keys(response));
        const meta = response.meta || response.pagination || response.page || {};
        console.log('🔍 [DEBUG] response.meta:', JSON.stringify(meta, null, 2));
        if (Array.isArray(list) && list.length > 0) {
          console.log('🔍 [DEBUG] Premier exercice (exerciseId):', list[0]?.exerciseId || list[0]?.id || 'N/A');
          console.log('🔍 [DEBUG] Premier exercice (name):', list[0]?.name || 'N/A');
          console.log('🔍 [DEBUG] Dernier exercice (exerciseId):', list[list.length - 1]?.exerciseId || list[list.length - 1]?.id || 'N/A');
          console.log('🔍 [DEBUG] Dernier exercice (name):', list[list.length - 1]?.name || 'N/A');
          console.log('🔍 [DEBUG] lastId extrait pour next page:', nextAfterId || 'N/A');
        } else {
          console.log('🔍 [DEBUG] Liste vide ou non-array');
        }
      }

      if (list.length === 0) {
        // Réponse vide = fin de pagination
        hasNextPage = false;
        console.log(`📄 Page ${pageNumber} | réponse vide, fin de pagination`);
        break;
      }

      let added = 0;
      for (const ex of list) {
        const id = getExerciseId(ex);
        if (id != null && id !== '' && seenIds.has(String(id))) continue;
        allExercises.push(ex);
        if (id != null && id !== '') seenIds.add(String(id));
        added++;
      }

      afterId = nextAfterId;
      hasNextPage = next;

      console.log(`📄 Page ${pageNumber} | récupérés: ${list.length} (nouveaux: ${added}) | total: ${allExercises.length} | lastId: ${afterId || 'N/A'}`);

      writeCheckpoint(opts.checkpoint, {
        cursor: afterId, // Stocke le afterId pour reprise
        pageNumber: pageNumber + 1,
        totalExercises: allExercises.length,
      });
      console.log(`   checkpoint écrit (prochaine page: ${pageNumber + 1}, afterId: ${afterId || 'N/A'})`);

      if (opts.debug || pageNumber % saveEvery === 0) {
        saveRawAtomic(opts.output, allExercises);
        if (opts.debug) {
          console.log(`   💾 [DEBUG] sauvegarde forcée (mode debug)`);
        } else {
          console.log(`   💾 sauvegarde périodique (toutes les ${saveEvery} pages)`);
        }
      }

      if (opts.debug && pageNumber >= opts.debugPages) {
        saveRawAtomic(opts.output, allExercises);
        writeCheckpoint(opts.checkpoint, {
          cursor: afterId, // Stocke le afterId pour reprise
          pageNumber: pageNumber + 1,
          totalExercises: allExercises.length,
        });
        console.log(`\n🛑 [DEBUG] DEBUG stop (pageNumber ${pageNumber} >= debugPages ${opts.debugPages})`);
        process.exit(0);
      }

      pageNumber++;
      pagesLeftThisRun--;

      if (maxExercises != null && allExercises.length >= maxExercises) {
        saveRawAtomic(opts.output, allExercises);
        try { if (fs.existsSync(opts.checkpoint)) fs.unlinkSync(opts.checkpoint); } catch (_) {}
        console.log(`\n✅ Limite --maxExercises=${maxExercises} atteinte: ${allExercises.length} exercices → ${opts.output}`);
        process.exit(0);
      }

      if (hasNextPage && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (err) {
      const status = err.status;
      saveRawAtomic(opts.output, allExercises);
      writeCheckpoint(opts.checkpoint, {
        cursor: afterId, // Stocke le afterId pour reprise
        pageNumber,
        totalExercises: allExercises.length,
      });

      if (status === 429) {
        console.error('\n⚠️ Limite API (429) atteinte. Données et checkpoint sauvegardés. Relancez plus tard.');
        process.exit(0);
      }

      console.error('\n❌ Erreur:', err.message);
      process.exit(1);
    }
  }

  saveRawAtomic(opts.output, allExercises);
  if (!hasNextPage) {
    try {
      if (fs.existsSync(opts.checkpoint)) fs.unlinkSync(opts.checkpoint);
    } catch (_) {}
    console.log(`\n✅ Récupération complète: ${allExercises.length} exercices → ${opts.output}`);
  } else {
    console.log(`\n✅ Ce run terminé (${maxPages} pages max): ${allExercises.length} exercices. Relancez pour continuer.`);
  }
}

const opts = parseArgs();
run(opts).catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = { parseArgs, run, readCheckpoint, writeCheckpoint, loadRaw, saveRawAtomic, getExerciseId, existingExerciseIds };
