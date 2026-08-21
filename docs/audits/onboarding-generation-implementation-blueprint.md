# Onboarding Generation — Implementation Blueprint

**Canonical reference document for implementation.** Audit + planning only; no production code has been modified.

**Repository state audited:** `main` @ `6a64072`, plus uncommitted working-tree edits to
`frontend/src/features/onboarding/{OnboardingGenerationLoader.jsx, onboarding.css, steps/AboutYouStep.jsx}` and two onboarding test files.

**Sources and their authority**

| Source | Authority for |
| --- | --- |
| `info.txt` | Product semantics, Plan vs Cycle responsibilities, Training Profile semantics, Settings information architecture, Creator/Binder roles, BOUND_PLAN architecture, rules to keep stable |
| Repository | Actual files, functions, runtime paths, schemas, flags/defaults, callers, tests, implementation state |

Where the two disagree, the gap is documented explicitly in §2.4 rather than silently resolved.

---

## 1. Executive summary

| Topic | Final position |
| --- | --- |
| Workout names | `parseSourcePlan` is **GEOMETRY_ONLY-only** and is **not** in the BOUND_PLAN path. `Day N` is load-bearing for GEOMETRY_ONLY rollback only. BOUND_PLAN's real constraint is different: `verifySpans` requires `workout.name` verbatim in the source. Call #1 keeps a structured ordinal heading for both modes; the prefix is stripped **after** materialization. §4 |
| Phase 1A name handling | **Conservative only.** Ordinal-prefix strip + sanitize + uniqueness. **No 4-word budget, no `+`/`&`/`and` truncation.** §4.5 |
| Shorter names | Solved at the source in **Phase 1B** (`## Day N - <short focus>`), not by algorithmic deletion. §4.6 |
| Training days | Collected in the existing onboarding **Your Training** step; canonical at `availability.preferredTrainingDays`; editable in Settings → Training Profile → Availability. No loader card, no sixth step. §5 |
| Conflict flow | **Unchanged order.** Profile save → conflict pre-check → confirmation if needed → generation → conversion → authoritative in-transaction re-check. §6 |
| Presentation | Call #1 authors, Call #2 binds, backend sanitizes/validates/falls back, frontend renders. No Call #P. Property stays `progression`. §7 |
| Durable presentation | `WeeklyPlanVersion.generationContext` — existing `Json` column, existing write path, **no migration**. §8 |
| Idempotency | In-process registry memo keyed on `(userId, generationId)`. Documented as single-instance-only. **No Redis in this implementation.** §9 |
| Loader | Hybrid preserved. Stage semantics, bands, 96% ceiling only. §10 |

**Phase 1 is split into 1A and 1B** because it spans two incompatible risk classes: deterministic backend cleanup
(verifiable against committed fixtures, instantly revertible) and AI-contract change (verifiable only against live
generations). §11.

---

## 2. Reconciled current architecture

### 2.1 Pipeline as it runs today

1. `OnboardingPage.handleContinue` (step 5) → `beginProgramGeneration()` — `frontend/src/features/onboarding/OnboardingPage.jsx:395`
2. `saveFinalTrainingProfile()` → `GET` settings, merge step 5, `PATCH /api/users/:id/settings/training-profile`
3. `checkConflictsAndContinue()` → `GET /api/cycles/conflicts`; conflicts → phase `confirmation` — `OnboardingPage.jsx:355`
4. `generateWeeklyPlan()` → `POST /api/weekly-plans/ai-drafts` with a client-minted `generationId` — `OnboardingPage.jsx:337`
5. `createAIWeeklyPlanDraftHandler` → `runSimpleWeeklyPlanAiPipeline` — `backend/controllers/weeklyPlansController.js:139`
6. `createWeeklyPlan(..., { initialStatus: 'PUBLISHED' })`, then presentation scrape — `weeklyPlansController.js:196`, `:216`
7. `convertWeeklyPlan()` → `POST /api/cycles/from-weekly-plan`, `durationWeeks: 6`, `workoutDayAssignmentStrategy: "DEFAULT"` — `OnboardingPage.jsx:362`
8. `createCycleFromWeeklyPlan` — cycle + Plan v1 PUBLISHED + weeks + scheduled sessions in one serializable transaction — `backend/services/cyclesService.js:2401`
9. `PATCH /onboarding {action:"COMPLETE"}` → `markSuccess()` → phase `success` → `OnboardingProgramResult`

### 2.2 Generation pipeline, by mode

Both modes share Steps 05–08. They diverge only at extraction and fill resolution.

| Step | GEOMETRY_ONLY | BOUND_PLAN |
| --- | --- | --- |
| Call #1 CREATOR | Free-text plan — identical prompt in both modes | Identical |
| Extraction (Output 04) | `buildStructureExtractionRequest` → `workout_1…workout_N` object — `aiPrompts.js:100` | `bindPlanWithRecovery` → `verifyBoundPlan` → BoundPlan — `simpleWeeklyPlanAiOrchestrator.js:504` |
| Geometry adapter | `adaptSimpleWeeklyPlanStructureToLegacyGeometry` — `structureGeometryAdapter.js:1` | `adaptBoundPlanToGeometry` — `structureGeometryAdapter.js:68` |
| Step 05 skeleton | `buildSimpleWeeklyPlanSkeleton` — shared authority | Same |
| Fill resolution (Output 06) | `resolveDeterministicWeeklyPlanFills({ generatedPlanText, … })` — **parses Output 02** | `resolveBoundPlanWeeklyPlanFills({ boundPlan, … })` — **takes no `generatedPlanText`** (`boundPlanFillResolver.js:20`) |
| AI fallback (Output 06b/07) | Narrow block-rest fallback | Same |
| Output 07 materialization + geometry lock | Shared | Shared |
| Output 08 final validation | Shared | Shared |

**This table is the correction the previous revision of this document got wrong.** Any statement about
`parseSourcePlan` applies to GEOMETRY_ONLY only.

### 2.3 Confirmed repository facts

| Fact | Evidence |
| --- | --- |
| Call #1 prompt contains **zero** instructions about plan title, workout name, summary, or coaching notes | `src/domain/programGeneration/prompts/programGenerationPrompt.js:131-205` |
| `planName` unbounded in the GEOMETRY_ONLY schema | `src/domain/simpleWeeklyPlanPipeline/structureSchema.js:20-23` |
| Workout `name` bounded at 200 chars in the BoundPlan schema | `src/domain/simpleWeeklyPlanPipeline/boundPlanSchema.js:87` |
| **`buildGeometryProjection` includes `workout.name` in the geometry hash** | `src/domain/simpleWeeklyPlanPipeline/geometryLock.js:23` |
| Only two geometry-hash callers, both before Output 07 | `skeletonBuilder.js:181` (compute), `fillMaterializer.js:96` (validate) |
| `verifySpans` requires `workout.name` verbatim in the source | `boundPlanVerification.js:143-146` |
| Span matching normalizes NFKC, all dashes → `-`, strips `*_\``, collapses whitespace, lowercases | `boundPlanVerification.js:46-55` |
| Occurrence integrity is a closed-dictionary multiset check with **no grammar, no headings** | `boundPlanVerification.js:377-383` |
| Retry/repair directives are closed backend tables; no model text except the previous plan | `retryDirectives.js:1-5, 70-73` |
| Unknown flag values fail closed; empty falls back to the code default | `simpleWeeklyPlanAiProvider.js:192-205` |
| Workout names must be unique **at publish only** | `weeklyPlansService.js:310-315` (`mode === 'publish'`) |
| `WeeklyPlanVersion.generationContext` is `Json?` and already written by `createWeeklyPlan` | `prisma/schema.prisma:249`; `weeklyPlansService.js:505`, `:1007` |
| Authoritative conflict re-check already runs inside the conversion transaction | `cyclesService.js:2553-2570` |
| Onboarding forces `DEFAULT` day strategy, discarding client assignments | `cyclesService.js:2513-2518` |
| `DEFAULT_WORKOUT_DAYS` is sequential `MONDAY…SUNDAY` | `cyclesService.js:53-61` |
| `rescheduleUpcomingCycle` is a stub that always 400s | `cyclesService.js:4330-4339` |
| Only two callers of `createCycleFromWeeklyPlan` exist | `OnboardingPage.jsx:362`, `ManualConvert.jsx:681` |

### 2.4 `info.txt` vs repository — documented gaps

| # | `info.txt` says | Repository shows | Relevant to these phases? |
| --- | --- | --- | --- |
| G1 | "Architecture candidate active en local: BOUND_PLAN" (`info.txt:1428`) | `backend/.env` sets `SIMPLE_WEEKLY_PLAN_EXTRACTION_MODE=BOUND_PLAN`, `RECOVERY_LEVEL=FULL`. **Code default when unset is `GEOMETRY_ONLY`** (`simpleWeeklyPlanAiProvider.js:8-9`), and `.env.example:16-17` documents `GEOMETRY_ONLY` / `OFF`. | **Yes.** Both modes must stay safe. Every phase below is mode-explicit. |
| G2 | GEOMETRY_ONLY is "rollback legacy" (`info.txt:1414`, `:1470`) | Still fully wired and still the code default | **Yes.** Rollback compatibility must be preserved where inexpensive — which it is. |
| G3 | Settings → Training Profile → Availability lists only Sessions per Week + Duration per Session (V3 tree, `info.txt:1646-1648`) | Matches `AvailabilitySection.jsx` today | **Yes.** Phase 2 adds a third child; documentation sync in §13. |
| G4 | M-5 deferred defect: "Output 08 utilise encore le preflight draft alors que la persistance published exécute des validations publish supplémentaires" (`info.txt:1488`) | Confirmed: `validateFinalWeeklyPlan` → `prepareAIWeeklyPlanDraftForCreate` runs `validateDraftDocument(…, 'draft')`; uniqueness is publish-only | **Yes.** Duplicate workout names are exactly this class. Phase 1A's uniqueness pass mitigates one instance of M-5 without changing the M-5 architecture. |
| G5 | "Aucun parser legacy de Output 02 n'est utilisé en mode BOUND_PLAN" (`info.txt:1414`) | **Confirmed true.** `resolveBoundPlanWeeklyPlanFills` takes no `generatedPlanText` (`boundPlanFillResolver.js:20`); `parseSourcePlan` is reached only via `resolveDeterministicWeeklyPlanFills` | No gap — recorded because the previous revision of this document contradicted it. |
| G6 | `.env.example` presents GEOMETRY_ONLY / OFF as the shipped configuration | `info.txt` presents BOUND_PLAN / FULL as the active candidate | Minor documentation drift. **Not blocking.** Flagged in §13. |

**Unresolvable from the repository:** the deployed Render environment's value for
`SIMPLE_WEEKLY_PLAN_EXTRACTION_MODE`. It is not in version control. Every phase below is therefore written to be
correct in **both** modes.

### 2.5 Presentation defects — reproduced, not inferred

Replaying `buildSimpleWeeklyPlanResultPresentation` over all eight committed Call #1 outputs:

```
fixture-a                   summary:2  progression:1  coachingNotes:0  constraints:0
fixture-b                   summary:0  progression:1  coachingNotes:0  constraints:0
creator-fewer-workouts      summary:0  progression:1  coachingNotes:0  constraints:0
creator-out-of-pool         summary:0  progression:0  coachingNotes:0  constraints:0
creator-superset-unequal    summary:0  progression:0  coachingNotes:0  constraints:0
smoke-202258                summary:0  progression:1  coachingNotes:0  constraints:0
smoke-203739                summary:0  progression:0  coachingNotes:0  constraints:0
smoke-203907                summary:0  progression:1  coachingNotes:0  constraints:0
────────────────────────────────────────────────────────────────────────────
files=8   summary:1/8   progression:5/8   coachingNotes:0/8   constraints:0/8
```

Representative output (`fixture-a`):

```json
{
  "title":       "Weekly Training Plan — 2 Days/Week, Hypertrophy Focus",
  "summary":     "- **Day 1** is a chest-priority push session … - **Day 2** is a chest + back + biceps session, …",
  "progression": "- Use a **double progression model**:",
  "coachingNotes": []
}
```

Two independent causes, both of which must be fixed together or the phase delivers nothing measurable:

1. **Over-broad safety filter.** `isUnsafePresentationLine` (`resultPresentation.js:52`) rejects any line matching
   `\b(?:exerciseId|sets?|reps?|RIR|tempo|rest)\b` and then sets `activeSection = null`, discarding the rest of the
   section. `creator-fewer-workouts` and `smoke-203907` both contain a real `## Coaching notes` heading whose first
   bullet begins `- Prioritize clean reps, …`. The word `reps` destroys the line and the section.
   **Coaching Notes has never rendered.**
2. **Heading vocabulary mismatch.** `SECTION_BY_HEADING` (`resultPresentation.js:9-30`) lacks
   `weekly structure`, `weekly split`, `weekly volume logic`, `overall weekly logic`, `notes`,
   `notes on execution` — which is what Call #1 actually writes.

Because `hasInsights = Boolean(presentation.progression || coachingNotes.length)`
(`OnboardingProgramResult.jsx:229`), the whole Coach's Insight block disappears in 3 of 8 runs.

**Existing tests do not catch this.** `test/domain/simpleWeeklyPlanResultPresentation.test.js:39-80` uses a
hand-written plan text with clean `## Summary` / `## Progression` / `## Practical Notes` headings and
markdown-free bodies. No real generation looks like that.

---

## 3. BOUND_PLAN vs GEOMETRY_ONLY implications

Rules that govern every phase below:

- **R1.** Any statement about `deterministicFillResolver.parseSourcePlan` is scoped to **GEOMETRY_ONLY**.
- **R2.** BOUND_PLAN source fidelity rests on `verifyBoundPlan` — schema, spans, pool eligibility, block arity,
  workout count, sets/rest scope, and exerciseId occurrence multiset equality
  (`boundPlanVerification.js:478-515`). None of these parse headings.
- **R3.** Step 05 is the geometry authority in both modes, and the geometry hash **includes `workout.name`**
  (`geometryLock.js:23`). Any change to a workout name must occur **after** `validateGeometryLock` has run.
- **R4.** Recovery is bounded (2 creator outputs, 4 binder attempts, 1 narrow fallback) and is driven by closed
  backend directive tables. No phase may add a retry path or widen a budget.
- **R5.** Artifacts 01–08 are the diagnostic contract. A phase may change what Output 07 contains, but must not
  change the artifact set, filenames, or the sidecar/attempt-ledger structure.
- **R6.** GEOMETRY_ONLY rollback compatibility is preserved wherever it is inexpensive. It is inexpensive in every
  phase below.

---

## 4. Workout-name resolution

### 4.1 Is `parseSourcePlan` used in BOUND_PLAN?

**No.** Orchestrator branch (`simpleWeeklyPlanAiOrchestrator.js:975-990`):

```js
const deterministic = boundPlanMode
  ? resolveBoundPlanWeeklyPlanFills({ boundPlan, skeleton, eligibleExerciseLookup })
  : resolveDeterministicWeeklyPlanFills({ generatedPlanText: outputs.output2, skeleton, eligibleExerciseLookup });
```

`resolveBoundPlanWeeklyPlanFills` carries an explicit comment: *"This resolver deliberately takes no
generatedPlanText"* (`boundPlanFillResolver.js:20`). `parseSourcePlan` is reachable **only** through
`resolveDeterministicWeeklyPlanFills`. This confirms `info.txt:1414`.

### 4.2 In which mode is `Day N` technically load-bearing?

**GEOMETRY_ONLY only.** `parseSourcePlan` segments Output 02 using exactly two hard-coded patterns
(`deterministicFillResolver.js:100-107`):

```js
const dayHeading     = line.match(/^#{1,2}\s+(Day\s+\d+\b.*)$/i);
const workoutHeading = line.match(/^(Workout\s+\d+\b.*)$/i);
```

Everything before the first match is discarded (`if (!workout) continue;`).

Measured, by replaying `parseSourcePlan` over committed fixtures:

| Fixture | Heading style | Workouts parsed |
| --- | --- | --- |
| `fixture-a` | `## Day 1 — …` | 2 ✅ |
| `fixture-b` | `## Day 1 — …` | 6 ✅ |
| `02-generated-plan-three-day` | `Workout 1 — …` | 3 ✅ |
| `bound-plan/smoke-203739` | `## Session 1 — …` | **0** ❌ |
| `fixture-a` with `Day N —` removed | `## Chest Priority Push` | **0** ❌ |

Zero parsed workouts is not graceful: `assertExactGeometry` (`deterministicFillResolver.js:229-236`) calls
`fatal()`, which throws `DeterministicFillResolutionError` (`fillNormalization.js:21-23`), escapes the
orchestrator try block, and surfaces as `422 AI_WEEKLY_PLAN_INVALID_OUTPUT`.

**In BOUND_PLAN this failure mode does not exist**, which is why `smoke-203739` (a `Session N` fixture) is a
valid BOUND_PLAN corpus case.

### 4.3 Does BOUND_PLAN rely on workout headings?

| Concern | Depends on the heading? | Evidence |
| --- | --- | --- |
| Binder fidelity | **No** — the bind instructions say "copy its name"; no format is imposed | `aiPrompts.js:38-40` |
| **Source spans** | **Yes, on the `name` value — not on `Day N`.** `verifySpans` requires `workout.name` to appear verbatim in Output 02, or `BOUND_PLAN_SPAN_NOT_IN_SOURCE` | `boundPlanVerification.js:143-146` |
| Workout ordering | **No** — array position in `boundPlan.workouts`, projected by `adaptBoundPlanToGeometry` | `structureGeometryAdapter.js:68-70` |
| Creator repair | **No** — closed directive table; only the previous plan is injected verbatim | `retryDirectives.js:70-93` |
| Source occurrence validation | **No** — closed-dictionary exerciseId multiset; explicitly "no grammar, no headings" | `boundPlanVerification.js:377-383` |
| Workout count | **No** — compares `boundPlan.workouts.length` against `sessionsPerWeek` | `boundPlanVerification.js:286-294` |
| Block arity / superset equality | **No** | `boundPlanVerification.js:204-260` |
| **Geometry hash** | **Yes, on the `name` value.** `buildGeometryProjection` includes `workout.name` | `geometryLock.js:23` |

Span matching is tolerant of presentation noise: it applies NFKC, maps every dash variant to `-`, strips
`*`, `_`, backtick, collapses whitespace, and lowercases (`boundPlanVerification.js:46-55`). Markdown emphasis
and em-dash variance in a heading therefore do **not** break span verification.

### 4.4 What source heading format keeps both modes safe?

```
## Day N - <short workout focus>
```

- `## ` + `Day` + a digit satisfies the GEOMETRY_ONLY `parseSourcePlan` regex.
- Whatever the binder copies as `name` exists verbatim in that line, satisfying BOUND_PLAN `verifySpans`.
- The ordinal carries no ordering authority in either mode (order comes from schema keys / array position /
  `orderIndex`); it is purely a parser anchor for the rollback path.

**Do not ask Call #1 to drop the ordinal heading.** Doing so is a hard failure in GEOMETRY_ONLY and buys nothing
in BOUND_PLAN, because the display name is produced deterministically in the backend anyway.

### 4.5 Where can the `Day N` prefix be removed safely?

**One shared point, correct in both modes:** immediately after
`outputs.output7 = materialization.document` (`simpleWeeklyPlanAiOrchestrator.js:1176`) and before
`validateFinalWeeklyPlan` (`:1182`).

At that line, every operation that needs the raw heading has already completed:

| Operation | Mode | Runs before line 1176? |
| --- | --- | --- |
| `verifyBoundPlan` (spans, occurrence, arity, count) | BOUND_PLAN | Yes — inside `bindPlanWithRecovery`, Output 04 |
| `parseSourcePlan` / `resolveDeterministicWeeklyPlanFills` | GEOMETRY_ONLY | Yes — Output 06 |
| `resolveBoundPlanWeeklyPlanFills` | BOUND_PLAN | Yes — Output 06 |
| `computeGeometryHash` (`skeletonBuilder.js:181`) | Both | Yes — Output 05 |
| `validateGeometryLock` (`fillMaterializer.js:96`) | Both | Yes — inside `materializeSimpleWeeklyPlan` |
| Creator repair / binder retry | Both | Yes — all recovery is resolved by Output 04 |

There are **no other geometry-hash callers** (verified by repository-wide grep), so nothing downstream
re-validates a hash computed from the source names. A single shared insertion point is therefore correct;
**no mode-specific duplication is needed.**

**Diagnostic consequence (accept and document):** artifacts 05 and 06 retain source names while 07 and 08 carry
display names. This is intentional — 05/06 are pre-normalization geometry artifacts and 07 is the completed
plan that gets persisted. The mapping is made explicit by storing the raw names (§4.7), so the artifact chain
stays fully traceable. Artifact filenames, the sidecar structure, and the attempt ledger are untouched (R5).

### 4.6 Phase 1A vs Phase 1B division

**Phase 1A — conservative, deterministic, no AI change:**
1. Strip a leading ordinal label: `^\s*(?:Day|Session|Workout|Jour)\s*\d+\s*[—–\-:.]?\s*` (case-insensitive).
2. Strip Markdown emphasis (`**`, `__`, `*`, `_`, backticks) and any leading list glyph.
3. Normalize dash variants to `-`, curly quotes to straight, collapse whitespace, trim, strip trailing
   `-`/`:`/`,`.
4. **Preserve all remaining focus content.** No word budget. No truncation at `+`, `&`, or `and`.
5. If the result is empty or shorter than 2 characters, **fall back to the original name unchanged**.
6. Guarantee uniqueness deterministically (§4.8).

```
"Day 1 — Chest Priority Push"                            → "Chest Priority Push"
"Day 2 — Chest + Back + Biceps"                          → "Chest + Back + Biceps"
"Workout 1 — Upper-Chest and Back Emphasis"              → "Upper-Chest and Back Emphasis"
"Session 1 — Chest emphasis + biceps support"            → "Chest emphasis + biceps support"
"Day 1 - Upper Chest Priority Push + Upper Back Support" → "Upper Chest Priority Push + Upper Back Support"
```

The last row is the explicitly required behaviour. Phase 1A must **not** produce
`"Upper Chest Priority Push"`.

**Phase 1B — shorter names at the source:** Call #1 is asked to author
`## Day N - <short workout focus>` with a concise focus label. Length improves because the Creator writes less,
not because the backend deletes information. The Phase 1A normalizer is unchanged by this and keeps working on
whatever the Creator produces.

### 4.7 Should raw source names be preserved?

**Yes.** Store `sourceWorkoutNames: string[]` (ordered by `orderIndex`) alongside the presentation in
`WeeklyPlanVersion.generationContext`. Cost is a few hundred bytes. Value:
- Reconciles artifacts 05/06 (source names) with 07/08 and the persisted plan (display names).
- Makes any future BOUND_PLAN span investigation possible from the database alone.
- Preserves the traceability posture that `info.txt:1419` requires of the artifact contract.

### 4.8 Duplicate prevention

Uniqueness is a **publish-only** validation (`weeklyPlansService.js:310-315`), and the AI path persists directly
with `initialStatus: 'PUBLISHED'`. An un-deduped collision is therefore a `400` that kills an otherwise valid
generation — precisely the M-5 class of defect documented at `info.txt:1488`.

Deterministic algorithm, inside the same normalizer, before the document leaves the orchestrator:

- Walk workouts in `orderIndex` order, keyed by the case-insensitive normalized name.
- On the **first** collision for a base name, retro-suffix the earlier holder to `"<base> A"` and the current one
  to `"<base> B"`; continue `C`, `D`, … for further collisions.
- Re-verify global uniqueness after suffixing; on a pathological second-order collision, append the
  `orderIndex` instead: `"<base> 3"`.
- Letter suffixes are used because they match the vocabulary Call #1 already produces (`Chest Priority A/B`).
  **Do not modify `frontend/src/utils/duplicateWorkoutName.js`** — it serves user-initiated duplication in the
  builder and has different semantics.

This mitigates one instance of M-5. It does **not** change the M-5 architecture (Output 08 still uses the draft
preflight), which stays out of scope.

---

## 5. Training-day Training Profile decision

### 5.1 Decision

Collect training days in the existing onboarding **Your Training** step (`steps/TrainingStep.jsx`). The value
becomes a canonical Training Profile preference at `availability.preferredTrainingDays`, editable in
**Settings → Training Profile → Availability**.

**Not built:** a loader card, a generation-time interaction, or a sixth onboarding step.

### 5.2 Why this is cheap in the current tree

| Mechanism | Location | Consequence |
| --- | --- | --- |
| Step-2 merge already deep-clones the whole `availability` object | `onboardingDraft.js:136` — `merged.availability = deepClone(onboardingDraft.availability)` | **No new merge logic** |
| Frontend profile mapper is a passthrough clone | `settingsMappers.js:281-312` | **No mapper change**; the field reaches the API as-is |
| Canonical profile is a `Json` column | `prisma/schema.prisma:186` (`onboardingSnapshot Json?`) | **No migration** — re-confirmed |
| Settings already has an Availability section | `trainingProfileSections/AvailabilitySection.jsx` | Natural home beside the two existing controls |

The only backend addition is one entry in the explicit whitelist that builds `normalizedValue.availability`
(`trainingProfileValidation.js:761-785`) plus a normalizer in `trainingProfileAvailability.js`.

### 5.3 Defaults (locked)

| Sessions/week | Default days |
| --- | --- |
| 1 | Monday |
| 2 | Monday, Thursday |
| 3 | Monday, Wednesday, Friday |
| 4 | Monday, Tuesday, Thursday, Friday |
| 5 | Monday, Tuesday, Thursday, Friday, Saturday |
| 6 | Monday, Tuesday, Wednesday, Friday, Saturday, Sunday |
| 7 | Every day |

**Mapping:** workout *N* → the *N*th selected weekday in chronological weekday order. Generated workout order is
authoritative; the user never maps individual workouts to days during onboarding.
`resolveWorkoutDayAssignments` already pairs by index (`cyclesService.js:746-766`) — only the day array changes.

### 5.4 Backward compatibility (hard constraint)

`hasValidCanonicalTrainingProfile` runs `validateTrainingProfileInput(storedProfile).ok` over persisted profiles
(`onboardingState.js:14-21`). If `preferredTrainingDays` were required, **every existing profile would become
invalid and those users would be pushed back through onboarding.**

Therefore:
- The field is **optional and nullable** at every layer.
- When absent, the spaced default is derived from `sessionsPerWeek` at conversion time.
- A stored profile without the field must still validate. This is an explicit Phase 2 test.

### 5.5 Semantics against the Plan/Cycle rules in `info.txt`

`info.txt` requires: Weekly Plans are time-independent templates; Cycles own temporal projection; the published
Cycle timeline is canonical; Scheduled Sessions regenerate only after Cycle publish; draft saves never mutate
Scheduled Sessions.

`preferredTrainingDays` respects all of these:

| Rule | How it is respected |
| --- | --- |
| Weekly Plan is time-independent | The preference is never read during Weekly Plan generation and is never written to `WeeklyPlanWorkout`. It is consumed only by `createCycleFromWeeklyPlan`. |
| Cycle owns temporal projection | The value becomes `Workout.scheduledDay` on Cycle plan weeks, exactly as today's `DEFAULT` strategy does. |
| Published Cycle timeline is canonical | Changing the preference later does **not** touch any existing `TrainingCycle` or `Plan`. |
| Scheduled Sessions regenerate only after publish | No new call site touches `synchronizeScheduledSessionsForPublishedCycle`. |
| Draft saves never mutate Scheduled Sessions | Unchanged. |

**Effect on an existing Cycle: none.** The only supported way to change days on a live Cycle remains the explicit
Cycle draft → publish path (`openOrCreateCycleEditDraft` → `updateCycleDraft` → `publishCycleDraft`), whose
builder already implements day-move-with-swap (`MultiWeekProgramContext.jsx:1546-1622`).
`rescheduleUpcomingCycle` stays a 400-stub (`cyclesService.js:4330`).

### 5.6 Behaviour when `sessionsPerWeek` changes

`touched` is **frontend-local UI state only** and is never persisted.

- `touched === false` → recompute the day set from the defaults table for the new count.
- `touched === true` → adjust minimally: when over-count, drop from the latest weekday; when under-count, add the
  earliest unselected weekday from the new count's default row. Never silently discard an explicit choice.
- At `sessionsPerWeek === 7` the control is hidden — every day is selected and no choice exists.

### 5.7 Validation authority

Backend is authoritative (`info.txt`: "Toute règle utilisée par les builders, l'onboarding V2 ou les Settings doit
être validée côté backend avant persistance"). The frontend mirrors the rule for UX only.

`normalizePreferredTrainingDays(value, sessionsPerWeek)` returns `null` or a de-duplicated array in canonical
weekday order, rejecting unknown enum values and any length ≠ `sessionsPerWeek`. `null` is always accepted.

---

## 6. Conflict-flow final decision

### 6.1 Decision: keep the current order, unchanged

1. Save the authoritative Training Profile
2. Conflict pre-check (`GET /api/cycles/conflicts`)
3. If conflicts exist, resolve the existing confirmation flow
4. **Only then** start AI generation
5. Generate the Weekly Plan
6. Convert to Cycle
7. Authoritative conflict verification still occurs during conversion
8. Complete onboarding

**Any earlier recommendation to run the conflict check in parallel with generation is withdrawn and must not
appear in implementation work.** The conflict `GET` is cheap relative to a 30–90 s generation; saving that time is
not worth publishing a Weekly Plan that may never be used, adding async state, or complicating orphan and retry
handling.

### 6.2 What already protects the rare stale-window case

`createCycleFromWeeklyPlan` re-loads overlapping cycles **inside** the serializable transaction and compares them
against `confirmedConflicts` via `conflictSnapshotsMatch` (`cyclesService.js:2553-2570`); the canonical window is
re-verified at `:2435-2452`. A mismatch throws `409 CYCLE_CONFLICT_CONFIRMATION_REQUIRED` with fresh
`{ window, conflicts }`, which the frontend already handles (`OnboardingPage.jsx:373-383`), and
`handleConflictConfirm` correctly re-converts without regenerating when `programFlow.weeklyPlan` is present
(`:412-418`).

**No change is required.** Replacement semantics are untouched.

### 6.3 Phase 2 conflict scope

**None.** Phase 2 contains **zero** conflict-flow work. The only adjacent Phase 2 concern is that
`convertWeeklyPlan` must carry the frozen training-day snapshot through a conflict-confirmation round trip —
achieved by keeping the snapshot on `programFlow`, which the existing confirmation path already preserves.

*Optional, deferred, not scheduled:* the copy shown on a stale-window `409` currently reads as a conflict rather
than a schedule shift. One string. Not part of any phase below.

---

## 7. Presentation contract

### 7.1 Architecture (locked)

```
Call #1 CREATOR authors  →  Call #2 BINDER copies faithfully  →  backend sanitizes / validates / falls back  →  frontend renders
```

No Call #P. No extra AI request. Call #2 remains a binder: copy, bind, do not improve, do not summarize, do not
rewrite, do not invent. The geometry and prescription contract is unchanged.

The domain property stays **`progression`** — it is already in the persisted shape and in two consumers
(`OnboardingProgramResult.jsx:246`, `AIBuilderResult.jsx:170`). It is not renamed to `progressionGuidance`.

### 7.2 Field targets

| Field | Target | Bounds used for validation |
| --- | --- | --- |
| `title` | ~2–5 words; reflects training focus; no redundant sessions/week count; no generic "Weekly Training Plan" | 2–8 words, 10–70 chars |
| `summary` | One concise sentence explaining overall strategy; not a workout recap | 1 sentence, 40–220 chars |
| `progression` | 1–2 concise sentences on how to progress; **may** mention reps, sets, load, RIR, rest | 1–2 sentences, 40–300 chars |
| `coachingNotes` | 2–3 items, one concise sentence each, specific to this program, no generic filler | 0–3 items, each 1 sentence, 20–160 chars |
| workout source heading | Structured ordinal heading retained; short focus wording authored at the source in Phase 1B | See §4.4 |

Bounds are deliberately wider than the *targets* so that valid current content does not fail unnecessarily.
The target is what Call #1 is asked for in Phase 1B; the bound is what the backend refuses to render.
**No field is ever truncated** — an out-of-bounds value fails validation and takes its deterministic fallback.

Markdown is forbidden in every field, enforced by sanitization plus a post-sanitization assertion.

### 7.3 Resolution tiers (final state, after Phase 1B)

1. Structured `presentation` object bound by Call #2
2. Backend exact-key parse of the `PROGRAM PRESENTATION` block in Output 02
3. Heading-based extraction (the Phase 1A improved scrape)
4. Deterministic fallback

Every tier passes through the same sanitizer and validators. After Phase 1A only tiers 3 and 4 exist; Phase 1B
adds 1 and 2 above them. **A missing or malformed presentation must never invalidate an otherwise valid Weekly
Plan** — at worst the page renders deterministic fallbacks.

---

## 8. Durable presentation

**Re-validated against the current tree:** `WeeklyPlanVersion.generationContext` is a `Json?` scalar
(`prisma/schema.prisma:249`); `createWeeklyPlan` writes it when present (`weeklyPlansService.js:1006-1008`, gated
by `hasGenerationContext` at `:505`); it is returned by `weeklyPlanVersionInclude` because that include never
narrows version scalars with a `select`. **No migration is required.**

**Stored shape (Phase 1A):**

```jsonc
generationContext: {
  schemaVersion: 1,
  presentation: { title, summary, progression, coachingNotes, constraintNotes, weeklyStructure, musclePriorities },
  sourceWorkoutNames: ["Day 1 - Upper Chest Priority Push + Upper Back Support", "…"]
}
```

Exposed from `mapVisibleParentToDetails` (`weeklyPlansService.js:836`) so the Library, the Weekly Plan detail
page, and any later result route read the same canonical text.

**Title divergence** is closed in two steps: Phase 1A makes the stored title clean, and Phase 1B deletes
`condenseProgramTitle` from the frontend so no synthesized title can exist. After Phase 1B there is exactly one
title, stored once and rendered everywhere.

**Artifact philosophy respected (R5):** artifacts 01–08 keep their filenames, formats, sidecars and attempt
ledger. `generationContext` is a *database* record, not an artifact, and adding it changes no diagnostic contract.

**Explicitly deferred (not Phase 1):** a durable `/onboarding/result/:cycleId` route, re-entry from Home, and
re-hydrating `metrics` from the persisted plan.

---

## 9. Idempotency

**Invariant:** `same user + same generationId ⇒ same generated Weekly Plan`.

Deployment constraints from `info.txt`: Vercel / Render / Neon, no mandatory paid external service, no
over-engineering.

### 9.1 Solution A — minimum safe for the current single-instance deployment (Phase 3)

Extend the existing in-process registry (`backend/services/weeklyPlanAiProgressRegistry.js`):

- On `finishGenerationProgress`, also store
  `result = { weeklyPlanParentId, weeklyPlanVersionId, name, metrics, presentation }`.
- In `createAIWeeklyPlanDraftHandler`, before running the pipeline: a `SUCCEEDED` record with a stored `result`
  for `(generationId, userId)` returns it with `200` and **does not** invoke the pipeline.
- A `RUNNING` record returns `409 AI_GENERATION_IN_PROGRESS`, so a double submit cannot start a second pipeline.
- The frontend mints `generationId` **once** in `beginProgramGeneration` and keeps it on `programFlow`, instead of
  minting a new one per attempt inside `generationProgress.beginAI()` (`useOnboardingGenerationProgress.js:76`).

**Documented limitations of Solution A** (must be written into the module header):
- The registry is an in-process `Map` with a 10-minute TTL (`weeklyPlanAiProgressRegistry.js:1`, `:36`).
- It does **not** survive a process restart or a Render redeploy.
- It does **not** span instances. If Render is ever scaled beyond one instance, the guarantee silently weakens to
  best-effort and duplicate plans become possible again.
- It covers the actual failure modes — retry after error, double submit, refresh within a session — all of which
  occur inside one process lifetime on the current deployment.

### 9.2 Solution B — future multi-instance-safe (not implemented now)

When Render scales beyond one instance, the durable form is a `generationId` uniqueness constraint in Neon: a
small `ai_generation_attempts` table (or a unique index on a `generationId` column on `WeeklyPlanVersion`) claimed
transactionally before the pipeline runs. That is a Postgres-only change with no new service. **Do not build it in
Phase 3.** Record it here so the eventual migration path is known.

### 9.3 Per-operation classification

| Operation | Idempotent today | Required |
| --- | --- | --- |
| `PATCH /users/:id/settings/training-profile` | Yes (full replace) | No change |
| `PATCH /users/:id/onboarding` (`COMPLETE`) | Yes (state transition) | No change |
| `GET /api/cycles/conflicts` | Yes (read) | No change |
| **`POST /api/weekly-plans/ai-drafts`** | **No** | **Must become idempotent** (Solution A) |
| `POST /api/cycles/from-weekly-plan` | No, but **fails safe** | Client-side in-flight guard only |

**Why conversion fails safe:** a retry after a *failed* conversion is harmless because the whole conversion is one
serializable transaction, so a failure created nothing. A retry after a *successful* conversion whose response was
lost would find the new cycle now overlapping; `conflictSnapshotsMatch` fails and returns `409` rather than
creating a duplicate cycle. A `generationInFlightRef` on the frontend makes this practically unreachable.

---

## 10. Loader alignment

Keep the hybrid architecture. The registry, the 2 s poll, and the band/asymptote/catch-up model in
`onboardingGenerationProgress.js` are sound and are **not** redesigned. **No interaction card, no training-day UI
during generation.** Only the mapping changes.

1. **Two new backend stages** in `WEEKLY_PLAN_AI_STAGES` (`weeklyPlanAiProgressRegistry.js:3-10`) — order matters,
   monotonicity is enforced by index:
   - `RESOLVING_EXERCISES`, reported immediately before `getEligibleExerciseLookup()`
     (`simpleWeeklyPlanAiOrchestrator.js:965-967`).
   - `COMPLETING_DETAILS`, reported **only** inside `if (deterministic.fallbackRequired)` (`:1021`). Conditional by
     design: when fills resolve deterministically the stage never fires and the band collapses. Both stages fire
     in both extraction modes.
2. **Re-band** `STAGE_PROGRESS` (`onboardingGenerationProgress.js:96-103`) so `BUILDING_PROGRAM` no longer has to
   absorb the pool build *and* a narrow AI fallback whose configured timeout is `180000` ms
   (`.env.example:23`):

   | Stage | Band |
   | --- | --- |
   | `PROFILE_SETUP` | 0 – 6 |
   | `DESIGNING_PROGRAM` | 6 – 24 |
   | `EXTRACTING_STRUCTURE` | 24 – 62 |
   | `RESOLVING_EXERCISES` | 62 – 80 |
   | `COMPLETING_DETAILS` | 80 – 88 |
   | `VALIDATING_PROGRAM` | 88 – 93 |
   | `SAVING_PROGRAM` | 93 – 96 |

3. **Hard timer ceiling at 96.** No timer-driven target may exceed 96. `FINALIZATION_PROGRESS`
   (`onboardingGenerationProgress.js:112-116`) becomes 96 → 99 and is entered only by the real `converting` phase;
   100 only on genuine success.
4. **Blind fallback ladder** (`FALLBACK_STAGES`, `:135-139`) stays capped at `EXTRACTING_STRUCTURE`.
5. **Slow-generation copy set** after ~120 s, adding no percentage.
6. **Minimum visible duration** ~2.5 s before the 100 transition so a fast generation does not flash.
7. **Graceful degradation is already correct** (`useOnboardingGenerationProgress.js:203-206` swallows poll errors).
   Do not change it.

**Phase 4 is not a prerequisite for any other phase.** With training days collected in onboarding, the loader
never hosts an interaction.

---

## 11. Phased implementation plan

### Why Phase 1 is split

Phase 1 spans two risk classes: deterministic backend cleanup (verifiable against committed fixtures, revertible
in one commit) and AI-contract change (verifiable only against live generations, with BOUND_PLAN integrity at
stake). Mixing them means a regression in either class blocks the other's rollback.

| Phase | Scope | AI contract touched | Dependency |
| --- | --- | --- | --- |
| **1A** | Deterministic presentation cleanup + conservative workout-name normalization + durable presentation | **No** | None |
| **1B** | Explicit presentation block in Call #1, bound by Call #2; short focus labels at the source | Yes | 1A |
| **2** | `preferredTrainingDays` + spaced defaults + explicit weekday assignments | No | None (ship after 1A for review size) |
| **3** | Idempotency and minimal recovery | No | None |
| **4** | Loader semantic alignment | No | None |

Full specifications: §14 (1A), §15 (1B), §16 (2), §17 (3), §18 (4).

---

## 12. Tests and regression risks

### 12.1 Cross-phase regression suites that must stay green

Any phase touching the pipeline must run these before and after:

| Suite | Guards |
| --- | --- |
| `test/domain/simpleWeeklyPlanPipeline/boundPlanVerification.test.js` | Spans, eligibility, arity, workout count, sets/rest scope |
| `test/domain/simpleWeeklyPlanPipeline/boundPlanCorpus.test.js` | Real source/bind corpus behaviour |
| `test/domain/simpleWeeklyPlanPipeline/boundPlanGeometryAdapter.test.js` | BoundPlan → geometry projection |
| `test/domain/simpleWeeklyPlanPipeline/boundPlanFillResolver.test.js` | Deterministic BOUND_PLAN fills |
| `test/domain/simpleWeeklyPlanPipeline/skeletonGeometry.test.js` | Geometry hash and lock |
| `test/domain/simpleWeeklyPlanPipeline/structureValidation.test.js` | GEOMETRY_ONLY structure contract |
| `test/domain/simpleWeeklyPlanPipeline/deterministicFillResolver.test.js` | GEOMETRY_ONLY fill resolution |
| `test/domain/simpleWeeklyPlanPipeline/pipelineRecoveryPolicy.test.js` | Bounded recovery budgets |
| `test/domain/simpleWeeklyPlanBoundPlanOrchestrator.test.js` | End-to-end BOUND_PLAN orchestration |
| `test/domain/simpleWeeklyPlanDeterministicFallbackOrchestrator.test.js` | Narrow fallback path |
| `test/domain/simpleWeeklyPlanPipeline/pipelineArtifacts.test.js` | Artifact contract 01–08 |

### 12.2 Standing regression risks

| Risk | Mitigation |
| --- | --- |
| Workout names participate in the geometry hash | Normalize only after `validateGeometryLock`; §4.5 proves no downstream re-validation exists |
| BOUND_PLAN span verification depends on the `name` value | Normalization happens after Output 04; §4.5 |
| Duplicate normalized names produce a publish-time `400` (M-5 class) | Deterministic uniqueness pass inside the same normalizer; §4.8 |
| Adding required properties to a strict Structured Output can shift extraction quality | Phase 1B ships behind an env kill switch; run §12.1 before and after |
| `hasValidCanonicalTrainingProfile` invalidates legacy profiles | `preferredTrainingDays` is optional and nullable; explicit Phase 2 test |
| Artifacts 05/06 diverge from 07/08 on names | Intentional and documented; `sourceWorkoutNames` preserves the mapping |
| Render's actual extraction mode is unknown | Every phase is written to be correct in both modes |

---

## 13. Documentation Sync After Implementation

`info.txt` is **not** edited during implementation tasks. After each phase lands and is verified, sync these
sections. Legacy V1 and V2 trees are left untouched.

| After | `info.txt` target | Required update |
| --- | --- | --- |
| **Phase 1A** | `PIPELINE AI WEEKLY PLAN ACTUEL` → step 9 "Présentation" (`info.txt:1454-1455`) | Note that the result presentation is now sanitized, validated, deterministically fallen back, and persisted in `WeeklyPlanVersion.generationContext`; note that persisted workout names have the ordinal prefix removed after materialization while artifacts 05/06 retain source names |
| **Phase 1A** | `CONTRAINTES POUR L'AGENT IA` (`info.txt:1402-1422`) | Add: presentation cleanup is deterministic and never invalidates a valid Weekly Plan; workout-name normalization occurs after every source/bind verification in both modes |
| **Phase 1A** | Known-defects list near M-5 (`info.txt:1486-1488`) | Record that workout-name uniqueness — one instance of the M-5 draft-vs-publish gap — is now prevented deterministically; M-5 itself remains open |
| **Phase 1B** | `Règles AI Builder` (`info.txt:1408-1421`) | Record that Call #1 authors an explicit presentation block and Call #2 binds it verbatim; restate that the binder still may not improve, summarize, rewrite, or invent; record the source heading contract `## Day N - <short focus>` |
| **Phase 1B** | `PIPELINE AI WEEKLY PLAN ACTUEL` (`info.txt:1424-1460`) | Add the presentation block to the Call #1 output description and the `presentation` object to the Call #2 structured output description; state that missing/malformed presentation content never invalidates a Weekly Plan |
| **Phase 2** | **Settings V3 tree → Training Profile → Availability (`info.txt:1646-1648`)** | Add a third child: `Preferred Training Days`, so the tree reads Sessions per Week / Duration per Session / Preferred Training Days |
| **Phase 2** | `ONBOARDING V2 ACTUEL` → `Entrées principales` (`info.txt:283-287`) | Extend the availability line to include preferred training days |
| **Phase 2** | Training Profile canonical contract note (`info.txt:2514-2520`) | Document `availability.preferredTrainingDays` as part of the canonical profile: optional, nullable, backward compatible, no migration; state that it affects **future** Cycle creation only and never mutates an existing Cycle or its Scheduled Sessions |
| **Phase 2** | `MODÈLE PRODUIT: PLANS ET CYCLES` (Cycle conversion rules) | Record that onboarding conversion now sends explicit weekday assignments and that the spaced default replaces sequential-from-Monday for onboarding |
| **Phase 3** | `CONTRAINTES POUR L'AGENT IA` and/or the pipeline section | Document the `generationId` idempotency guarantee **and its single-instance limitation**, so it is not mistaken for a durable distributed guarantee |
| **Phase 4** | Pipeline / progress description | Update stage names and reporting points if progress semantics are described anywhere in `info.txt` |
| **Any** | `.env.example` vs `info.txt` drift (gap G6) | Optional cleanup: `.env.example:16-17` documents `GEOMETRY_ONLY` / `OFF` while `info.txt:1428` states BOUND_PLAN is the active candidate. Align the example file or add a comment stating it documents the rollback configuration |

---

## 14. Phase 1A Codex Handoff Specification

> **This is the next task to implement.** Codex makes **no architectural decisions**; everything is prescribed.

### Objective
Make every result-page text field clean, bounded, predictable and durable, and give persisted workout names a
usable display form — using **only** what Call #1 already produces. Deterministic presentation cleanup only.

### Hard scope constraint — ZERO changes to
- Call #1 prompt (`src/domain/programGeneration/prompts/**`)
- Call #2 prompt (`src/domain/simpleWeeklyPlanPipeline/aiPrompts.js`)
- Structured output schemas (`structureSchema.js`, `boundPlanSchema.js`, `fillSchema.js`)
- Creator/Binder recovery semantics (`retryDirectives.js`, `pipelineRecoveryPolicy.js`, `bindPlanWithRecovery`)
- exerciseId fidelity verification (`boundPlanVerification.js`)
- `deterministicFillResolver.js` — **especially `parseSourcePlan`'s heading regexes**
- Geometry, skeleton, fill materialization, geometry lock
- Cycle scheduling (`cyclesService.js`, `scheduledSessionsService.js`)
- Training Profile (any file under `src/domain/trainingProfile/`)
- **Any frontend file**
- `frontend/src/utils/duplicateWorkoutName.js`

### Files
- `backend/src/domain/simpleWeeklyPlanPipeline/resultPresentation.js`
- `backend/services/simpleWeeklyPlanAiOrchestrator.js`
- `backend/controllers/weeklyPlansController.js`
- `backend/services/weeklyPlansService.js`
- `backend/test/domain/simpleWeeklyPlanResultPresentation.test.js`
- Fixtures (read-only): `backend/test/fixtures/simpleWeeklyPlanPipeline/**/02-output-ai_generated-plan.txt`

### New files
- `backend/src/domain/simpleWeeklyPlanPipeline/presentationText.js`
- `backend/src/domain/simpleWeeklyPlanPipeline/workoutNameNormalization.js`
- `backend/test/domain/simpleWeeklyPlanPipeline/presentationText.test.js`
- `backend/test/domain/simpleWeeklyPlanPipeline/workoutNameNormalization.test.js`
- `backend/test/domain/simpleWeeklyPlanPipeline/resultPresentationRealFixtures.test.js`

---

#### C1 — Correct the presentation safety filter
- **File / area:** `resultPresentation.js` → `isUnsafePresentationLine`, and its call site in
  `extractGeneralSections`.
- **Required behaviour:** reject a line only when it matches a *prescription shape*:
  `\bexr_[A-Za-z0-9_-]+`, `\bexerciseId\b`, `\b\d+\s*(?:x|×)\s*\d+\b`, `\b\d+\s*(?:sets?|reps?)\b`,
  `\bRIR\s*\d`, `\b\d\s*-\s*\d\s*-\s*\d\s*-\s*\d\b` (tempo), `^\s*\d+[.)]\s+`, `^\s*[A-Z][.)]\s+`,
  `^\s*workout\s+\d+\b`.
  Bare prose words `sets`, `reps`, `rest`, `tempo`, `RIR` must **pass**.
  A rejected line **skips that line only** — it must no longer reset `activeSection` to `null`.
  Validate the final patterns by running them over all eight committed fixtures before finishing.
- **Must remain unchanged:** no exerciseId and no numeric prescription may reach `presentation`.
- **Test:** `resultPresentationRealFixtures.test.js` asserts `coachingNotes.length >= 2` for
  `bound-plan/creator-fewer-workouts` and `bound-plan/smoke-203907`.
  `simpleWeeklyPlanResultPresentation.test.js` keeps its leak assertion
  (`assert.doesNotMatch(..., /exr_press|4 sets|8 reps|RIR|tempo/i)`) **and** adds a positive case proving prose
  containing `reps` / `rest` is retained.

#### C2 — Correct the heading vocabulary
- **File / area:** `resultPresentation.js` → `SECTION_BY_HEADING`.
- **Required behaviour:** add → `summary`: `weekly structure`, `weekly split`, `weekly volume logic`,
  `overall weekly logic`; → `coachingNotes`: `notes`, `notes on execution`, `coaching note`, `training note`,
  `execution notes`. Verify each new key against the real fixtures.
- **Must remain unchanged:** existing entries and their targets; `normalizeHeading`'s `#` / `*` / `:` stripping.
- **Test:** a table-driven unit test asserting each new heading maps to the expected section.

#### C3 — Shared sanitizer and validators
- **New file:** `presentationText.js`
- **Exports:** `sanitizePresentationText(value)`, `validateTitle`, `validateSummary`, `validateProgression`,
  `validateCoachingNote`, `FALLBACK_TITLE`, `FALLBACK_PROGRESSION`.
- **Required behaviour:** the sanitizer strips `**` / `__` / `*` / `_` / backticks and any leading `-` / `*` / `•`,
  normalizes dash variants to `-` and curly quotes to straight, collapses whitespace, trims.
  Validators return `{ ok, value }` and **never truncate** — an out-of-bounds value returns `{ ok: false }`.
  Bounds per §7.2: title 2–8 words / 10–70 chars; summary 1 sentence / 40–220 chars; progression 1–2 sentences /
  40–300 chars; note 1 sentence / 20–160 chars.
- **Test:** `presentationText.test.js` covering each rule, including "out of bounds ⇒ not ok, and the returned
  value is never a fragment".

#### C4 — Wire validation and fallbacks into the presentation builder
- **File / area:** `resultPresentation.js` → `normalizeText`, `buildSimpleWeeklyPlanResultPresentation`, and the
  length constants at lines 1–7.
- **Required behaviour:** remove `.slice(0, maxLength)` from `normalizeText`; route every field through C3;
  `title` falls back to the sanitized `completedDocument.name`, then `FALLBACK_TITLE`; `summary` falls back to
  `null`; `progression` falls back to `FALLBACK_PROGRESSION`; invalid `coachingNotes` items are dropped
  individually.
- **Must remain unchanged:** the returned object's key set; the determinism guarantee (two identical inputs ⇒
  `deepEqual` outputs); `buildSimpleWeeklyPlanResultPresentationFallback`'s "contains no generated plan text"
  property.
- **Test:** `resultPresentationRealFixtures.test.js` asserts, for all eight fixtures: no `**`, no leading `- `,
  no em dash, every field inside its bound, `title` non-empty, and `deepEqual` across two runs.

#### C5 — Conservative workout-name normalizer *(revised — no word budget)*
- **New file:** `workoutNameNormalization.js`
- **Export:** `normalizeWorkoutNames(workouts)` → `{ workouts, sourceNames }` — pure, does not mutate its input.
- **Required behaviour:** exactly §4.6 Phase 1A rules 1–5, then §4.8 uniqueness.
  1. Strip `^\s*(?:Day|Session|Workout|Jour)\s*\d+\s*[—–\-:.]?\s*` (case-insensitive).
  2. Strip Markdown emphasis and any leading list glyph.
  3. Normalize dashes and quotes, collapse whitespace, trim, strip a trailing `-` / `:` / `,`.
  4. **Preserve all remaining content.** No word budget. No truncation at `+`, `&`, or `and`.
  5. Empty or shorter than 2 characters ⇒ return the original name unchanged.
  6. Uniqueness: retro-suffix `A` / `B` / `C…`; on a pathological second-order collision use the `orderIndex`.
  `orderIndex` and every other workout field are preserved untouched.
- **Explicit non-goal:** shortening long but meaningful focus labels. That is Phase 1B's job, at the source.
- **Must remain unchanged:** `frontend/src/utils/duplicateWorkoutName.js`.
- **Test:** `workoutNameNormalization.test.js` proving:
  - `"Day 1 - Upper Chest Priority Push + Upper Back Support"` → `"Upper Chest Priority Push + Upper Back Support"`
    — **this exact case must be asserted**;
  - `Day` / `Session` / `Workout` / `Jour` prefixes with `-`, `—`, `–`, `:` separators all strip;
  - a name with no prefix passes through unchanged apart from sanitization;
  - empty result falls back to the original;
  - collision produces `A` / `B` including the retro-suffix of the first holder;
  - a second-order collision falls back to the `orderIndex` suffix;
  - re-running the normalizer on its own output is stable;
  - `validateDraftDocument(normalizedDocument, 'publish')` does not throw.

#### C6 — Apply the normalizer at the single shared post-materialization point *(revised)*
- **File / area:** `simpleWeeklyPlanAiOrchestrator.js` → `runSimpleWeeklyPlanAiPipeline`, **between**
  `outputs.output7 = materialization.document;` (line 1176) and the `validateFinalWeeklyPlan` call (line 1182).
- **Required behaviour:** call `normalizeWorkoutNames`, assign the result to `outputs.output7.workouts`, and carry
  `sourceNames` out on the pipeline's return object as `sourceWorkoutNames`.
  **One insertion point serves both extraction modes** — no mode branch, no duplicated logic.
- **Why this point is safe (do not move it):** every operation that needs the raw heading has already run —
  `verifyBoundPlan` at Output 04 (BOUND_PLAN), `parseSourcePlan` at Output 06 (GEOMETRY_ONLY),
  `computeGeometryHash` at Output 05, and `validateGeometryLock` inside `materializeSimpleWeeklyPlan`. There are no
  other geometry-hash callers in the repository.
- **Must remain unchanged:** every `reportProgressSafely` call and its ordering; `startTimingStage` /
  `closeTimingStage` bookkeeping; the `currentOutput` sequence; `failureReceived` handling; the entire
  geometry / skeleton / fill / verification path; artifact filenames and the sidecar and attempt-ledger structure.
- **Test:** an orchestrator-level test, run in **both** modes, asserting that
  `completedDocument.workouts[].name` is normalized, `sourceWorkoutNames` preserves the originals, and the
  Output 04/05/06 values and the geometry hash are byte-identical to a run without the normalizer.

#### C7 — Persist the presentation durably
- **Files / areas:** `weeklyPlansController.js` → `createAIWeeklyPlanDraftHandler`;
  `weeklyPlansService.js` → `mapVisibleParentToDetails`.
- **Required behaviour:** build `presentation` **before** `createWeeklyPlan` and pass
  `generationContext: { schemaVersion: 1, presentation, sourceWorkoutNames }` in the create payload
  (`hasGenerationContext` at `weeklyPlansService.js:505` already gates it). Expose `presentation` from
  `mapVisibleParentToDetails`. Re-confirm during implementation that `generationContext` is still a `Json?` column
  requiring no migration.
- **Must remain unchanged:** the `POST /ai-drafts` response shape; `projectPublicMetrics`; the existing
  `try/catch` fallback around the presentation build; `initialStatus: 'PUBLISHED'`.
- **Test:** a controller test asserting `createWeeklyPlan` receives `generationContext.presentation` and
  `generationContext.sourceWorkoutNames`; a service test asserting `getWeeklyPlanDetails` returns `presentation`.

#### C8 — Real-fixture and BOUND_PLAN regression coverage
- **File:** `simpleWeeklyPlanResultPresentation.test.js` — **replace** the synthetic
  `## Summary` / `## Progression` / `## Practical Notes` input with a real fixture from
  `backend/test/fixtures/simpleWeeklyPlanPipeline/`. Replace, do not add beside.
- **Must remain unchanged:** the determinism assertion and the prescription-leak assertion.
- **Additionally:** run the full §12.1 suite list and confirm every one is green, with particular attention to
  `boundPlanVerification.test.js`, `boundPlanCorpus.test.js`, `skeletonGeometry.test.js` and
  `pipelineArtifacts.test.js`. **Phase 1A must not alter any BOUND_PLAN verification outcome.**

### Failure behaviour
- Any presentation validation failure ⇒ that field's deterministic fallback. **Never fail the generation.**
- The existing `try/catch` around the presentation build (`weeklyPlansController.js:222-235`) remains the outermost
  guard.
- Workout-name normalization is total: an empty result returns the original. It must be impossible for this phase
  to introduce a `400 Workout names must be unique`.

### Acceptance criteria
1. Across all eight committed fixtures: `coachingNotes.length >= 2` for the two fixtures containing a
   `## Coaching notes` section.
2. No field in any fixture contains `**`, a leading list glyph, or an em dash.
3. No field is a truncated fragment — no output ends mid-word or on a dangling `:`.
4. `"Day 1 - Upper Chest Priority Push + Upper Back Support"` normalizes to
   `"Upper Chest Priority Push + Upper Back Support"`.
5. Every workout name across all fixtures carries no `Day N` / `Session N` / `Workout N` prefix, and names are
   unique per plan.
6. Output 04, Output 05, Output 06 and the geometry hash are unchanged in both extraction modes.
7. `GET /weekly-plans/:id` returns a `presentation` object for a plan generated after this change.
8. The full backend suite is green, including every suite in §12.1.

### Rollback
All changes are additive or contained in two new pure modules. Reverting the commit restores exact prior
behaviour. `generationContext` rows written meanwhile become inert.

### Definition of done
`git diff --stat` touches **only** `resultPresentation.js`, `simpleWeeklyPlanAiOrchestrator.js`,
`weeklyPlansController.js`, `weeklyPlansService.js`, the two new domain modules, and test files.
**Zero** changes under `src/domain/programGeneration/prompts/`, or to `structureSchema.js`, `boundPlanSchema.js`,
`aiPrompts.js`, `deterministicFillResolver.js`, `boundPlanVerification.js`, `cyclesService.js`, or `frontend/`.

---

## 15. Phase 1B Codex Handoff Specification (deferred — finalize after 1A soaks)

### Objective
Make presentation content explicit at the source so scraping arbitrary prose becomes unnecessary, and let Call #1
author naturally short workout focus labels. **Deliberately small. Not a Creator/Binder redesign.**

### Files
`src/domain/programGeneration/prompts/programGenerationPrompt.js`;
`src/domain/simpleWeeklyPlanPipeline/{structureSchema.js, boundPlanSchema.js, aiPrompts.js, resultPresentation.js, deterministicFillResolver.js}`;
`services/simpleWeeklyPlanAiOrchestrator.js`; `frontend/src/features/onboarding/OnboardingProgramResult.jsx`.

### Exact functions / constants
`buildProgramGenerationPrompt` (+ bump `PROGRAM_GENERATION_PROMPT_VERSION`);
`buildSimpleWeeklyPlanStructureSchema`; `buildSimpleWeeklyPlanBoundPlanSchema`;
`buildStructureExtractionRequest`; `BOUND_PLAN_BIND_INSTRUCTIONS`; `parseSourcePlan`;
`runSimpleWeeklyPlanAiPipeline`; `condenseProgramTitle`.

### Changes
1. **Call #1** gains one compact, delimited block plus one heading-format line:
   ```
   PROGRAM PRESENTATION
   TITLE: <2-5 words naming the training focus. No day count. Not "Weekly Training Plan".>
   SUMMARY: <one sentence on the overall strategy, not a session recap>
   PROGRESSION: <1-2 sentences on how to progress. May mention reps, sets, load, RIR, rest.>
   NOTE: <one sentence specific to this program>
   NOTE: <one sentence specific to this program>
   NOTE: <optional third>
   ```
   plus: `Start each workout with a heading of the form "## Day N - <short workout focus>".`
   No Markdown inside these values. The heading line is **risk-reducing**: it pins the format the GEOMETRY_ONLY
   rollback parser needs and gives BOUND_PLAN span verification a stable target (§4.4).
2. **Call #2** gains one `presentation` object on **both** schemas, with `maxLength` enforced by the schema.
   Instruction wording stays extractive: *"Copy each value from the PROGRAM PRESENTATION block verbatim. Do not
   write, improve, shorten, summarize, or invent any of them. If a field is absent, return null."* This is
   consistent with the existing prohibition on original binder text (`aiPrompts.js:31-36`).
3. **Orchestrator** reads `extractedStructure.presentation` (GEOMETRY_ONLY) or `boundPlan.presentation`
   (BOUND_PLAN) and passes it as tier 1 (§7.3).
4. **`resultPresentation.js`** gains the tier-2 exact-key parser for the `PROGRAM PRESENTATION` block. Tiers 3 and
   4 are the Phase 1A behaviour, unchanged.
5. **Kill switch:** `SIMPLE_WEEKLY_PLAN_PRESENTATION_CONTRACT=off` reverts to Phase 1A behaviour without a deploy.
6. **Robustness:** widen `parseSourcePlan`'s heading regex to `^#{0,2}\s*(?:Day|Session|Workout)\s+\d+\b.*$`.
   This makes the GEOMETRY_ONLY rollback tolerate the `Session N` style already present in the corpus. No
   currently-passing fixture changes behaviour.
7. **Frontend:** delete `condenseProgramTitle` and its call site; render `presentation.title` directly. Move its
   `musclePriorities` → macro-area mapping into the backend title fallback so stored and displayed titles cannot
   diverge.

### Failure behaviour
A missing or malformed `presentation` object must **never** fail the pipeline and must never invalidate an
otherwise valid Weekly Plan. It falls through tiers 2 → 3 → 4.

### Tests that must prove no regression
Beyond the new tier-precedence tests, **every one of these must be run before and after and be identical**:
- **exerciseId multiset integrity** — `boundPlanVerification.test.js` (occurrence missing / surplus)
- **source spans** — `boundPlanVerification.test.js` (`BOUND_PLAN_SPAN_NOT_IN_SOURCE`)
- **bind verification overall** — `boundPlanVerification.test.js`, `boundPlanCorpus.test.js`
- **creator/binder recovery** — `pipelineRecoveryPolicy.test.js`, `simpleWeeklyPlanBoundPlanOrchestrator.test.js`
- **exact workout count** — `boundPlanVerification.test.js` (`BOUND_PLAN_WORKOUT_COUNT_MISMATCH`)
- **block geometry** — `boundPlanGeometryAdapter.test.js`, `skeletonGeometry.test.js`
- **superset equality** — `boundPlanVerification.test.js` (`BOUND_PLAN_SUPERSET_SET_COUNT_UNEQUAL`)
- **fail-closed behaviour** — `pipelineRecoveryPolicy.test.js`, `simpleWeeklyPlanDeterministicFallbackOrchestrator.test.js`
- **GEOMETRY_ONLY rollback** — `structureValidation.test.js`, `deterministicFillResolver.test.js`
- **artifact contract** — `pipelineArtifacts.test.js`

### Risks
The real one: adding required properties to a strict Structured Output changes the extraction task framing and
could shift geometry quality. Mitigated by the kill switch plus the before/after corpus comparison above.

### Explicit non-goals
Changing geometry or prescription contracts; touching recovery budgets; altering `verifyBoundPlan`; making
presentation content able to fail a generation.

### Dependencies
Phase 1A (sanitizer, validators and fallbacks must already exist).

### Rollback
Env kill switch first; commit revert second.

---

## 16. Phase 2 implementation specification — Training days and Cycle scheduling

### Objective
Collect `preferredTrainingDays` in the existing Your Training step, persist it on the canonical Training Profile,
expose it in Settings, and use it as an explicit weekday assignment at Cycle conversion — replacing the forced
`DEFAULT` override.

### Files
**Backend:** `src/domain/trainingProfile/{trainingProfileAvailability.js, trainingProfileValidation.js, settingsResponse.js}`; `services/cyclesService.js`.
**Frontend:** `features/onboarding/steps/TrainingStep.jsx`; `features/onboarding/onboardingValidation.js`;
`features/onboarding/OnboardingPage.jsx`;
`features/settings/trainingProfileSections/AvailabilitySection.jsx`; `features/settings/settingsValidation.js`.

### Exact functions / constants
New `SPACED_DEFAULT_TRAINING_DAYS` and `normalizePreferredTrainingDays` in `trainingProfileAvailability.js`;
`validateTrainingProfileInput`'s `normalizedValue.availability` (`trainingProfileValidation.js:768-771`);
`createDefaultTrainingProfile` (`settingsResponse.js:30`);
`DEFAULT_WORKOUT_DAYS` (`cyclesService.js:53`); `resolveWorkoutDayAssignments` (`:746`);
`normalizeWorkoutDayAssignments` (`:692`); the forced override in `createCycleFromWeeklyPlan` (`:2513-2518`);
`validateTrainingStep` (`onboardingValidation.js:60`); `beginProgramGeneration` / `convertWeeklyPlan`.

### New files
`frontend/src/features/onboarding/trainingDayDefaults.js` — shared default table plus the sessions-change
adjustment rule, imported by both the onboarding step and Settings, with its test. The backend constant in
`trainingProfileAvailability.js` is the authority; a test asserts the two tables are identical to prevent drift.

### Backend changes
- `SPACED_DEFAULT_TRAINING_DAYS` = the §5.3 table.
- `normalizePreferredTrainingDays(value, sessionsPerWeek)` per §5.7.
- Add `preferredTrainingDays` to `normalizedValue.availability` and to `createDefaultTrainingProfile()`.
  **Optional and nullable** (§5.4).
- Add a `'SPACED_DEFAULT'` branch to `resolveWorkoutDayAssignments`, zipping source workouts (sorted by
  `orderIndex`) against `SPACED_DEFAULT_TRAINING_DAYS[sourceWorkouts.length]`.
- **Replace the forced override** at `cyclesService.js:2513-2518`: onboarding replacement mode honours
  `payload.workoutDayAssignments` when present and falls back to `'SPACED_DEFAULT'` when absent.
  `'DEFAULT'` remains available and byte-identical.
- Server-side authority unchanged: `normalizeWorkoutDayAssignments` already validates count, uniqueness, enum and
  coverage (`:692-743`). Do not weaken it.

**Complete caller trace before changing default behaviour:**

| Caller | Sends today | Effect |
| --- | --- | --- |
| `OnboardingPage.jsx:362` | `workoutDayAssignmentStrategy: "DEFAULT"` | **Changes** — sends explicit `workoutDayAssignments` |
| `ManualConvert.jsx:686` | explicit `workoutDayAssignments`, no strategy | **Unaffected** — never used the strategy |
| any other caller | — | **None exist** |

Because `'DEFAULT'` is left untouched and its only consumer is onboarding, Manual Convert and every other Cycle
flow are unaffected. ManualConvert's own frontend default (sequential, `ManualConvert.jsx:289`) is out of scope.

### Frontend changes
- `TrainingStep.jsx`: a compact seven-chip weekday row under "How many days per week?", using the existing
  design-v2 `Chip`. Defaults preselected from the shared table. Local `touched` state (not persisted). Sessions
  change behaviour per §5.6. **Hidden entirely at `sessionsPerWeek === 7`.**
- `validateTrainingStep`: require exactly `sessionsPerWeek` distinct days.
- `OnboardingPage.beginProgramGeneration`: snapshot the days from the `saveFinalTrainingProfile()` **response**
  onto `programFlow.trainingDays`; `convertWeeklyPlan` sends
  `workoutDayAssignments: trainingDays.map((day, i) => ({ workoutOrderIndex: i + 1, scheduledDay: day }))` and
  drops `workoutDayAssignmentStrategy`. The snapshot is taken once and never re-read, so a Settings edit in
  another tab cannot affect an in-flight conversion. This preserves the frozen-schedule principle: **Cycle
  conversion receives exactly one immutable schedule snapshot.**
- `AvailabilitySection.jsx`: the same control under "Sessions per week", with copy stating it applies to
  **future** cycles only.

### Data / API
JSON only, inside `onboardingSnapshot.profile.availability`. **No migration.**
`PATCH /users/:id/settings/training-profile` accepts and echoes `availability.preferredTrainingDays`.
`POST /cycles/from-weekly-plan` accepts `workoutDayAssignments` during onboarding — previously discarded.

### Explicit non-goals
- **No conflict-flow changes of any kind** (§6.3).
- No loader changes.
- No change to `DEFAULT` strategy semantics, `ManualConvert.jsx`, `MultiWeekProgramContext` day-move logic,
  `rescheduleUpcomingCycle`, or scheduled-session generation logic.
- No automatic rescheduling of any existing Cycle.

### Tests
- Backend: `SPACED_DEFAULT` for *n* = 1…7; explicit assignments honoured in onboarding replacement mode
  (direct regression for the removed override); duplicate day rejected; count mismatch rejected; workout *N* → *N*th
  day in weekday order; **a stored profile without `preferredTrainingDays` still validates** (guards §5.4);
  frontend and backend default tables asserted identical.
- Integration: extend `test/integration/cyclePublishScheduledSessions.integration.test.js` — a Mon/Wed/Fri plan
  over six weeks yields 18 sessions on the correct dates with local noon preserved.
- Frontend: chip defaults per *n*; exact-count enforcement; the touched/untouched adjustment rule; control hidden
  at *n* = 7; `createCycleFromWeeklyPlan` called with explicit assignments.
- **Update** `frontend/src/features/onboarding/__tests__/OnboardingPage.test.jsx:393-399`, which currently asserts
  `workoutDayAssignmentStrategy: "DEFAULT"`.

### Risks
The `hasValidCanonicalTrainingProfile` trap (mitigated by nullability plus an explicit test); stricter step-2
validation for resumed sessions (defaults are always preselected, so a resumed draft is always valid); a missed
whitelist entry silently dropping the field on save.

### Acceptance criteria
Three sessions produce Mon/Wed/Fri; a user-selected set flows end to end into `ScheduledSession` dates; changing
days in Settings does **not** alter an existing published Cycle or its Scheduled Sessions; Manual Convert
behaviour is byte-identical.

### Dependencies
None on 1A/1B. Ship after 1A to keep review surfaces small.

### Rollback
Revert; stored `preferredTrainingDays` values are ignored by the whitelist and conversion falls back to
`SPACED_DEFAULT`, then `DEFAULT`.

---

## 17. Phase 3 implementation specification — Idempotency and minimal recovery

### Objective
`same user + same generationId ⇒ same generated Weekly Plan`, using Solution A (§9.1).

### Files
`backend/services/weeklyPlanAiProgressRegistry.js`; `backend/controllers/weeklyPlansController.js`;
`frontend/src/features/onboarding/{OnboardingPage.jsx, useOnboardingGenerationProgress.js, onboardingStorage.js}`.

### Exact functions
`finishGenerationProgress`, `readGenerationProgress`, `beginGenerationProgress`;
`createAIWeeklyPlanDraftHandler`; `beginProgramGeneration`, `generateWeeklyPlan`, `handleProgramRetry`;
`useOnboardingGenerationProgress.beginAI`.

### Changes
§9.1 in full: the registry result memo; `200` replay of a `SUCCEEDED` record; `409 AI_GENERATION_IN_PROGRESS` for a
`RUNNING` record; `generationId` minted once per onboarding attempt and carried on `programFlow`; a flow-level
`generationInFlightRef`; an `AbortController` passed to `createAIWeeklyPlanDraft` (already supported,
`api.js:252`) plus a mounted-ref guard on every `setProgramFlow`; a minimal recovery record in
`onboardingStorage`.

**Document the single-instance limitation in the module header** (§9.1) and record Solution B (§9.2) as the future
path. **Do not add Redis, a queue, or any new service.**

### Failure behaviour
Recovery is best-effort; a corrupt or stale record is ignored and the flow starts clean.

### Tests
Two `POST /ai-drafts` with the same id ⇒ one plan, pipeline invoked once, second returns `200`; a concurrent call
⇒ `409`; TTL expiry ⇒ regenerates; frontend retry reuses the id; unmount aborts the request.

### Risks
Replaying a `SUCCEEDED` record must not re-report progress or re-write artifacts.

### Explicit non-goals
Distributed idempotency; a durable claim table; changing the progress polling contract; artifact writing;
anything in `cyclesService`.

### Dependencies
None. Simplest after Phase 2 has stabilized the flow.

### Rollback
Revert. The registry falls back to its current progress-only behaviour.

---

## 18. Phase 4 implementation specification — Loader semantic alignment

### Objective
§10 in full: stage semantics, real backend reporting points, percentage bands, the 96% timer ceiling, final
scheduling/completion progress, and slow-generation messaging.

### Files
`backend/services/weeklyPlanAiProgressRegistry.js`; `backend/services/simpleWeeklyPlanAiOrchestrator.js`;
`frontend/src/features/onboarding/{onboardingGenerationProgress.js, useOnboardingGenerationProgress.js}`.

### Exact functions / constants
`WEEKLY_PLAN_AI_STAGES`; `reportProgressSafely` call sites at `simpleWeeklyPlanAiOrchestrator.js:965` and `:1021`;
`STAGE_PROGRESS`; `FINALIZATION_PROGRESS`; `FALLBACK_STAGES`; `resolveProgressTarget`; `getGenerationMessage`.

### Tests
Timer-driven percent never exceeds 96; band transitions monotonic; conditional `COMPLETING_DETAILS` collapse when
no fallback fires; blind ladder capped at `EXTRACTING_STRUCTURE`; minimum visible duration on a fast run; poll
failure still animates.

### Explicit non-goals
Redesigning progress infrastructure; changing the polling interval or endpoint contract; altering the
catch-up/asymptote maths beyond the band constants; touching anything in the AI pipeline besides the two
`reportProgressSafely` call sites; **any interaction card or training-day UI during generation**.

### Dependencies
None. **Not a prerequisite for Phase 2.**

### Rollback
Revert; band constants and stage lists return to their current values.
