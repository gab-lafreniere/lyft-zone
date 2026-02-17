const express = require("express");

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function includesAny(hay, needles) {
  const h = norm(hay);
  return needles.some((n) => h.includes(norm(n)));
}

function buildSearchText(ex) {
  const parts = [
    ex.name,
    ...(ex.keywords || []),
    ...(ex.targetMuscles || []),
    ...(ex.secondaryMuscles || []),
    ...(ex.bodyParts || []),
    ...(ex.equipments || []),
    ex.exerciseType,
  ]
    .filter(Boolean)
    .map((x) => String(x));
  return parts.join(" ").toLowerCase();
}

function createExercisesRouter(store) {
  const router = express.Router();

  // GET /api/exercises/filters
  router.get("/filters", (req, res) => {
    res.json(store.filters);
  });

  // GET /api/exercises/:id
  router.get("/:id", (req, res) => {
    const ex = store.byId.get(req.params.id);
    if (!ex) return res.status(404).json({ error: "Not found" });
    res.json(ex);
  });

  // GET /api/exercises
  // query: q, bodyPart, equipment, type, muscle, limit, cursor
  router.get("/", (req, res) => {
    const q = norm(req.query.q);
    const bodyPart = norm(req.query.bodyPart);
    const equipment = norm(req.query.equipment);
    const type = norm(req.query.type);
    const muscle = norm(req.query.muscle);

    const limit = Math.min(Math.max(parseInt(req.query.limit || "25", 10), 1), 50);
    const cursor = Math.max(parseInt(req.query.cursor || "0", 10), 0);

    let results = store.items;

    if (bodyPart) {
      results = results.filter((ex) => (ex.bodyParts || []).some((v) => norm(v) === bodyPart));
    }
    if (equipment) {
      results = results.filter((ex) => (ex.equipments || []).some((v) => norm(v) === equipment));
    }
    if (type) {
      results = results.filter((ex) => norm(ex.exerciseType) === type);
    }
    if (muscle) {
      results = results.filter((ex) =>
        [...(ex.targetMuscles || []), ...(ex.secondaryMuscles || [])].some((v) => norm(v) === muscle)
      );
    }
    if (q) {
      results = results.filter((ex) => buildSearchText(ex).includes(q));
    }

    const items = results.slice(cursor, cursor + limit);
    const nextCursor = cursor + items.length < results.length ? String(cursor + items.length) : null;

    res.json({
      items,
      nextCursor,
      total: results.length,
    });
  });

  return router;
}

module.exports = { createExercisesRouter };
