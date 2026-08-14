# Bound Plan Pipeline — Final Read-Only Production-Readiness Audit

**Date:** 2026-08-14
**Scope:** AI Weekly Plan generation pipeline, Output 01 → Output 08
**Mode:** Adversarial read-only review. No file modified, no patch applied, no migration run, no environment variable changed.
**Baseline:** `main` @ `fbba5f0` plus uncommitted Bound Plan work.

---

# FINAL VERDICT: READY WITH FIXES

The architecture is sound and its central claim is **proven, not merely asserted**: in `BOUND_PLAN` mode the backend never re-parses Call #1. I verified this dynamically by poisoning every legacy entry point before module load — `BOUND_PLAN` completed cleanly with zero leaks while the control (`GEOMETRY_ONLY`) tripped the trap immediately.

However, the pipeline can still **silently lose or silently invent an executable block** in a specific, realistic shape, and two deterministic normalizers can **silently change coaching meaning within the accepted value range**. None of these are architectural faults; all are bounded implementation defects with small fixes. They must be closed before production.

---

# A. Executive summary

- The original multi-parser failure mode is **eliminated** in `BOUND_PLAN`. Dynamic isolation proof passes with a working control.
- Call #2 is genuinely a binder: its prompt and schema contain **no digit, no `sessionsPerWeek`, no geometry, no skeleton, no hash**. Verified by inspection of the live request.
- All three creator-repair constraints are genuinely stated to Call #1 in the original prompt (`programGenerationProfileNarrative.js:163`, `programGenerationPrompt.js:154`, `:166`).
- Recovery is a provably terminating state machine. Live probe consumed **exactly 2×Call #1 + 4×Call #2** and stopped.
- Span verification is fidelity-only and does not normalize coaching content. Markdown/dash/whitespace/case folding is applied symmetrically and cannot admit a different value.
- **Coverage only detects omissions at workout edges.** A dropped *middle* block is invisible (`unboundOutOfEnvelope: 0`) and the plan is accepted. Proven by probe.
- **Binder insertion is entirely undetected.** A bind that duplicates an exercise into an extra block passes verification with zero failures and zero warnings. Proven by probe.
- `parseRestSeconds("1 min 5 sec")` → **300s** (true 65s) and `"1:30"` → **30s** (true 90s). Both pass the 0–600 bound and persist silently. Pre-existing, shared with legacy.
- `normalizeTempo` corrupts **any** tempo containing a non-digit phase, not only `X`: `X-0-1-0`→`0100`, `3-0-X-0`→`3000`, `30-10`→`3010`. Phase meaning shifts.
- The `tempo → null` policy works correctly in live data: the final 6×120 run produced **48 four-digit tempos, 12 nulls, zero `"0000"`**, and the fallback fired 11 times — all block rests, no tempo.
- Narrow fallback is genuinely narrow: exactly one merge target (`blockRests[i].value`), integer allowlist, pinned resolution IDs, merge-target-must-be-null guard.
- `providerOutputAjv.compile()` runs per generation with a hash-unique schema: **~87 KB retained per generation, never released** (~87 MB / 1000 plans). Pre-existing, affects both modes.
- A typo in `SIMPLE_WEEKLY_PLAN_EXTRACTION_MODE` silently routes production to the **legacy path**, which we have observed failing on real complex profiles.
- Two artifact untruths: canonical Output 03 claims `PIPELINE_NOT_STARTED` after a bind failure, and on a *failed* creator repair canonical 01/02 describe attempt 1 while the repaired plan has no Output-02-shaped artifact.

---

# B. Architecture reconstruction (as actually implemented)

```
POST /api/weekly-plans/ai-drafts  →  weeklyPlansController.createAIWeeklyPlanDraftHandler
                                        ↓
                              runSimpleWeeklyPlanAiPipeline
                                        ↓
  config = resolveSimpleWeeklyPlanAiConfig(env, overrides)
    extractionMode  : GEOMETRY_ONLY (default) | BOUND_PLAN
    recoveryLevel   : OFF (default) | BINDER_ONLY | FULL
    deterministicFillsEnabled : true (default)   ← only consulted in GEOMETRY_ONLY
                                        ↓
  Output 01  renderSimpleWeeklyPlanModelInput(locked Call #1 prompt)
  Output 02  CALL_1_PLAN_TEXT                        [recordCall1()]
                                        ↓
        ┌───────────────── boundPlanMode ? ─────────────────┐
        │ BOUND_PLAN                                        │ GEOMETRY_ONLY
        ▼                                                   ▼
  eligibleExerciseLookup (pool built EARLY)          buildStructureExtractionRequest
        ↓                                                   ↓
  bindPlanWithRecovery() ── loop ──┐                 CALL_2_STRUCTURE
    buildBoundPlanExtractionRequest│                        ↓
    CALL_2_BIND_PLAN               │                 validateSimpleWeeklyPlanStructure
    verifyBoundPlan (V1..V8+cov)   │                        ↓
    decideRecoveryAction           │                 adaptSimpleWeeklyPlanStructureToLegacyGeometry
      PROCEED → exit               │                        ↓
      RETRY_BINDER → archive, loop │                 (pool built LATE, Output 6)
      REPAIR_CREATOR → recordCall1 │                        ↓
      FAIL_CLOSED → throw          │                 deterministicFillsEnabled ?
        ↓                          │                   true  → resolveDeterministicWeeklyPlanFills
  Output 03/04 = winning attempt ──┘                          (parseSourcePlan — the 2nd parser)
        ↓                                                   false → CALL_3_FILLS (legacy full AI)
  adaptBoundPlanToGeometry                                   ↓
        └────────────────────┬──────────────────────────────┘
                             ▼
  Output 05  buildSimpleWeeklyPlanSkeleton  ← GEOMETRY AUTHORITY (unchanged)
                             ▼
  Output 06  resolveBoundPlanWeeklyPlanFills  |  resolveDeterministicWeeklyPlanFills
             (shared fillNormalization.js)
                             ▼
             unresolved? → CALL_3_FILL_FALLBACK (block rests only) → merge
                             ▼
  Output 07  normalize → validateSimpleWeeklyPlanFills → materialize → geometry lock
                             ▼
  Output 08  validateFinalWeeklyPlan (draft-mode preflight) + metrics + attempts ledger
                             ▼
  controller → createWeeklyPlan(initialStatus: PUBLISHED)  [publish-mode validation]
```

## Flag matrix (verified by inspection and probe)

| `EXTRACTION_MODE` | `RECOVERY_LEVEL` | `deterministicFillsEnabled` | Actual behavior |
|---|---|---|---|
| `GEOMETRY_ONLY` | any | `true` | Legacy: Call #2 structure + `parseSourcePlan` text resolver. Recovery level **ignored**. |
| `GEOMETRY_ONLY` | any | `false` | Legacy-legacy: full AI Call #3 fills. Recovery level **ignored**. |
| `BOUND_PLAN` | `OFF` | ignored | Bind once, fail closed on any verification failure. Coverage mismatch → **PROCEED** with `COVERAGE_MISMATCH_UNCONFIRMED`. |
| `BOUND_PLAN` | `BINDER_ONLY` | ignored | Bind, retry once per creator output, never repair Call #1. |
| `BOUND_PLAN` | `FULL` | ignored | Full ladder incl. one creator repair. |

No hybrid state exists: `boundPlanMode` gates the branch exactly once and `deterministicFillsEnabled` is short-circuited by `if (boundPlanMode || config.deterministicFillsEnabled)`.

---

# C. Findings by severity

## HIGH

### H-1 · Coverage cannot detect an omitted middle block
**Severity:** HIGH
**File:** `src/domain/simpleWeeklyPlanPipeline/boundPlanVerification.js` → `buildCoverageDiagnostic`
**Evidence:** Proven by probe.

`unboundOutOfEnvelope` is computed by testing an unbound occurrence's character offset against the `[min,max]` envelope of *bound* ids. A dropped block in the middle of a workout has an offset **between** two bound ids, so it falls inside the envelope and is not flagged.

```
source: 5 blocks   bind drops the LAST   → unboundOutOfEnvelope: 1   → retry fires
source: 5 blocks   bind drops the FIRST  → unboundOutOfEnvelope: 1   → retry fires
source: 5 blocks   bind drops the MIDDLE → unboundOutOfEnvelope: 0   → ACCEPTED
```

Multi-workout probe confirms the same for a dropped middle block of workout 2. Full verification returns `valid: true`, `failures: []`, `warnings: []`.

**Why it matters:** the omission class is believed closed. It is closed only at workout boundaries. The one real production omission we observed happened to be a closing block, which is why the mechanism appeared to work.

**Failure scenario:** a 6×120 plan where the binder drops workout 3's third accessory block. Plan persists with less volume than the coach prescribed; `Output 08` reports `valid: true`; no warning anywhere.

**Smallest fix:** compare *per-workout* bound occurrence counts against per-workout source occurrence counts using workout-name offsets as segment boundaries, or flag any unbound occurrence regardless of envelope when its id is bound fewer times than it occurs. Implementation-only; no architecture change.

---

### H-2 · Binder insertion / duplication is entirely undetected
**Severity:** HIGH
**File:** `boundPlanVerification.js` → `buildCoverageDiagnostic` (`Math.min(offsets.length, boundWorkouts.length)`)
**Evidence:** Proven by probe.

A bind that emits an exercise **more times than the source contains it** passes cleanly:

```
source: 3 blocks; bind emits 4 blocks (middle exercise duplicated)
→ valid: true | failures: [] | warnings: []
→ coverage: 3 occurrences / 3 bound / 0 unbound / 0 out-of-envelope
```

`boundOccurrences` is capped at the source occurrence count, so surplus bindings are arithmetically invisible. Span verification passes (the id is in the source), pool membership passes, arity passes, geometry is derived *from the bound plan itself* so it self-consistently accommodates the extra block.

**Why it matters:** this is the mirror of omission and arguably worse — it **adds** training volume the coach never prescribed, and every downstream guard is derived from the binder's own output.

**Failure scenario:** binder emits an accessory twice; athlete receives 3 extra working sets per week that no coach authored.

**Smallest fix:** assert `boundOccurrences === poolIdOccurrencesInSource` per id (surplus → binder defect → retry), instead of clamping with `Math.min`. Implementation-only.

---

### H-3 · `parseRestSeconds` silently corrupts compound durations
**Severity:** HIGH
**File:** `src/domain/simpleWeeklyPlanPipeline/fillNormalization.js` → `parseRestSeconds`
**Evidence:** Proven by probe. **Pre-existing; shared by legacy and Bound Plan.**

The function takes `max(all numbers) × unit-factor`, where the factor is 60 if the string mentions minutes anywhere.

| Source | True | Produced | Outcome |
|---|---|---|---|
| `1 min 5 sec` | 65 | **300** | passes 0–600 → **silent corruption** |
| `1:30` | 90 | **30** | passes 0–600 → **silent corruption** |
| `1 min 30 sec` | 90 | 1800 | caught by 0–600, fails as `INVALID_ENTITY_LOCAL_PROVIDER_FILL` |
| `2 min 15 sec` | 135 | 900 | caught, confusing error |
| `90 sec to 2 min` | 120 | 5400 | caught, confusing error |

**Why it matters:** two of these persist wrong rest values with no signal; the rest fail closed with an error that names the provider fill contract rather than rest normalization, sending a debugger to the wrong module.

**Failure scenario:** Call #1 writes `Rest: 1 min 5 sec`. Athlete is prescribed 5 minutes of rest. Session duration estimate inflates accordingly.

**Smallest fix:** parse unit-tagged components and sum (`Xm Ys`), and treat `m:ss` explicitly; keep upper-bound semantics only for genuine ranges. Implementation-only.

---

### H-4 · AJV validator accumulation leaks memory per generation
**Severity:** HIGH (production longevity)
**File:** `src/domain/simpleWeeklyPlanPipeline/fillSchema.js:297` — `providerOutputAjv.compile(...)`
**Evidence:** Measured. **Pre-existing; affects both modes.**

`buildSimpleWeeklyPlanFillProviderSchema` embeds the run's `geometryHash` as a `const`, so every generation compiles a structurally-unique schema into a module-level AJV instance that never evicts.

```
400 compiles → heapUsed 4.2 MB → 38.2 MB
≈ 87 KB retained per generation, never released
```

**Why it matters:** Render processes are long-lived. ~87 MB per 1000 generations, monotonically increasing until restart.

**Smallest fix:** construct the AJV instance per call, or compile a hash-free schema once and check `geometryHash` separately (it is already checked explicitly at `normalizeSimpleWeeklyPlanProviderFills` before AJV runs). Implementation-only.

---

### H-5 · `normalizeTempo` corrupts any non-digit tempo phase
**Severity:** HIGH
**File:** `fillNormalization.js` → `normalizeTempo`
**Evidence:** Proven by probe. **Pre-existing; shared with legacy.** (Expanded in §D.)

Digits are extracted and padded, so a stripped phase shifts every subsequent phase left:

| Source | Intended | Produced | Nature |
|---|---|---|---|
| `X-0-1-0` | explosive, 0, 1, 0 | `0100` | phase shift + invented terminal 0 |
| `3-0-X-0` | 3, 0, explosive, 0 | `3000` | phase shift + invented terminal 0 |
| `30-10` | 2-phase | `3010` | 2-phase read as 4-phase |
| `1-0-1-0 explosive` | 1,0,1,0 + qualifier | `1010` | qualifier dropped (benign) |
| `2.5-0-1-0` | — | `null` | correctly unresolved |
| `controlled` | — | `null` | correctly unresolved |

**Why it matters:** the output is a schema-valid four-digit tempo indistinguishable from an authored one. It reaches Output 07, persistence, TUT and duration metrics as apparently-good data.

**Smallest fix:** require the source to contain exactly 3 or 4 *numeric* phases after separator splitting; anything containing a non-numeric phase token resolves to `null` (the canonical absence now supported). Implementation-only.

---

## MEDIUM

### M-1 · Flag typo silently routes production to the legacy path
**Severity:** MEDIUM
**File:** `services/simpleWeeklyPlanAiProvider.js` → `resolveEnum`
**Evidence:** Proven by probe.

```
"BOUND_PLAN"  → BOUND_PLAN
"bound_plan"  → BOUND_PLAN   (case-insensitive, trimmed)
"BOUNDPLAN"   → GEOMETRY_ONLY   ← silently legacy
"BOUND-PLAN"  → GEOMETRY_ONLY   ← silently legacy
```

`resolveEnum` falls back to the default on any unrecognised value, with no log and no error. Legacy has been observed failing on real complex profiles (`DETERMINISTIC_BLOCK_GEOMETRY_MISMATCH`, `DETERMINISTIC_WORKOUT_GEOMETRY_MISMATCH`).

**Smallest fix:** log a warning when a non-empty value fails to match, or fail fast at startup. Implementation-only.

### M-2 · Canonical Output 03 lies after a bind failure
**Severity:** MEDIUM (debugging)
**File:** `services/simpleWeeklyPlanAiOrchestrator.js` — `outputs.output3` assigned only on success; `markFailureOutputs(4, …)` never touches index 3.
**Evidence:** Observed live (`20260814T031147Z-dec153fe`) and reproduced by probe.

Canonical 03 reads `STATUS: NOT_PRODUCED / BLOCKED_BY_OUTPUT: 01 / ERROR_CODE: PIPELINE_NOT_STARTED` while `03-a1`…`03-a4` prove four bind prompts were produced.

**Smallest fix:** assign `outputs.output3` as soon as the first bind request is rendered. Implementation-only.

### M-3 · On a failed creator repair, the repaired plan has no Output-02 artifact
**Severity:** MEDIUM (debugging)
**File:** orchestrator — `outputs.output1/2` assigned only after `bindPlanWithRecovery` returns.
**Evidence:** Proven by probe.

After a failed repair: canonical `02` = attempt 1, `02-a1` = attempt 1 (**duplicate**), and the repaired attempt-2 plan exists only embedded inside the `SOURCE PLAN` section of `03-a3`/`03-a4`. The plan that actually produced the failing binds has no artifact of its own.

**Smallest fix:** update `outputs.output1/2` as soon as a repair produces a new plan, before re-entering the bind loop. Implementation-only.

### M-4 · Per-side qualifier lost for slash notation
**Severity:** MEDIUM
**File:** `fillNormalization.js` → `parseRepTarget` (`/\b(each|per)\s+(side|leg|arm)\b/`)
**Evidence:** Proven by probe. Occurred in real data.

`20-30 sec/side` and `10 reps/leg` produce `notes: null`; `per side` / `each side` are captured. The Copenhagen plank in run `20260814T034330Z` used exactly `20–30 sec/side`, so a real plan lost the per-side meaning.

**Smallest fix:** extend the qualifier regex to accept `/side`, `/leg`, `/arm`. Implementation-only.

### M-5 · Step 08 validates in draft mode; persistence validates in publish mode
**Severity:** MEDIUM
**File:** `finalValidation.js:84` (draft) vs `weeklyPlansService.js:857` (publish)
**Evidence:** Confirmed by inspection. **Explicitly declared out of scope for this workstream.**

Publish-only invariants — unique workout names, `SINGLE` ⇒ exactly one exercise, non-empty superset lanes, `exerciseName` required, `workouts.length === sessionsPerWeek` — are never checked by the pipeline's own final validation. `Output 08` can report `valid: true` and persistence can then reject with a 400.

**Smallest fix:** run the preflight in publish mode. One argument.

### M-6 · A coverage mismatch on the last permitted bind is accepted
**Severity:** MEDIUM
**File:** `pipelineRecoveryPolicy.js` → coverage branch
**Evidence:** Inferred from code (reachable, not yet observed).

If bind 1 fails for an unrelated binder defect, the retry is consumed; if bind 2 then shows a coverage mismatch, `previousCoverageMismatchForPlan` is `false` and no budget remains, so the decision is `PROCEED / COVERAGE_MISMATCH_UNCONFIRMED`. A possible omission is accepted because the confirmation budget was spent elsewhere.

**Smallest fix:** treat "no budget to confirm" as a warning that is surfaced in `Output 08` rather than silently proceeding, or reserve one confirmation attempt. Implementation-only.

## LOW

### L-1 · `deterministicFillsEnabled` is dead in `BOUND_PLAN` but still documented
`.env.example` advertises `SIMPLE_WEEKLY_PLAN_DETERMINISTIC_FILLS_ENABLED=true` with no note that `BOUND_PLAN` ignores it. Operator confusion risk only.

### L-2 · Repair prompt embeds the previous plan without fencing
`buildCreatorRepairRequest` appends the previous Output 02 after a plain `PREVIOUS PLAN` line. A plan whose prose contained `PLAN REPAIR` or `PREVIOUS PLAN` could blur the boundary. No delimiter or escaping. Low likelihood, bounded impact.

### L-3 · `runId` collision window
`createRunId` uses second-resolution ISO + 4 random bytes; `fs.mkdir(..., {recursive: false})` throws on collision, failing the run. Probability negligible, failure mode is loud.

## COSMETIC

### C-1 · `03-a{N}` numbering is global, not per-creator-output
Superseded binds are numbered `a1..a4` across both creator outputs, so `03-a3`/`03-a4` belong to the repaired plan while `03-a1`/`03-a2` belong to the original, with nothing in the filename indicating which. `output8.attempts.timeline` disambiguates.

### C-2 · `01-a1`/`02-a1` duplicate canonical on failed repair
Consequence of M-3; two artifacts hold identical content.

---

# D. Known issues re-evaluated

## `X-0-1-0 → 0100`
**Confirmed and broader than reported.** The corruption is not specific to `X`: it affects **any** tempo containing a non-digit phase (`3-0-X-0` → `3000`) and any tempo whose digit count happens to land on 3 or 4 after stripping (`30-10` → `3010`).

- **Is `X` legitimate input?** Yes. The Call #1 prompt asks for "tempo" with no format constraint, and `X` for explosive concentric is standard coaching notation.
- **Legacy affected too?** Yes — `normalizeTempo` lives in the shared `fillNormalization.js` and is called identically by `deterministicFillResolver`.
- **Reaches persisted Output 07 as valid data?** Yes. `"0100"` satisfies `^[0-9]{4}$`, passes `fillValidation`, materializes, persists, and renders as `0-1-0-0`.
- **Metric impact:** `parseTempoToSecondsPerRep("0100")` = 1 s/rep vs an intended ~4–5 s/rep for `X-0-1-0`, understating TUT and session duration for that exercise.
- **Severity:** HIGH, not blocking. Silent, plausible, but affects one field on one exercise; volume and structure remain correct.

## Canonical Output 03 failure artifact
**Confirmed, cause identified.** `outputs.output3` is only assigned after a successful bind, and `markFailureOutputs` starts at index 4. Reproduced by probe. **Severity: MEDIUM (debugging only).** A second, related untruth exists (M-3): on a failed repair, canonical 01/02 describe the superseded attempt. Canonical artifacts can therefore describe attempt 1 while sidecars describe attempts 1–4 — they never *mix within one file*, but the canonical set is not the winning chain when the run fails.

## Creator repair not yet observed live
**Not a blocker.** Evidence quality is high:
- The full ladder was exercised end-to-end by probe with a mock provider: `CALL_1, CALL_2, CALL_2, CALL_1, CALL_2, CALL_2` — exactly the intended sequence, correct violation text, correct ledger, correct termination.
- The **binder-confirmation half has been observed live** (`20260814T033702Z`): two independent binds agreed on `BOUND_PLAN_EXERCISE_OUTSIDE_POOL`, and the policy correctly declined to repair because `BINDER_ONLY` was set, failing closed with `CREATOR_EXERCISE_OUTSIDE_POOL`.
- The only unexercised step in production is the second `recordCall1` invocation, which shares its code path with the initial call.

Residual risk is the *quality* of the repaired plan, which no test can prove and which is bounded by the same verification the first attempt faces.

---

# E. Invariant matrix

| # | Invariant | Status | Evidence |
|---|---|---|---|
| 1 | `BOUND_PLAN` never re-parses Output 02 for structure | **PROVEN** | Dynamic poison test: BOUND_PLAN clean, GEOMETRY_ONLY control trips `buildStructureExtractionRequest` |
| 2 | Call #2 receives no target geometry or workout count | **PROVEN** | Live request inspection: no digit, no `sessionsPerWeek`, no `setCount`/`roundCount`/`geometryHash` in instructions or schema |
| 3 | Every bound value is verbatim in Output 02 | **STRONGLY SUPPORTED** | 267 spans verified on the 6×120 bind; 100% span rate over 50 replay samples |
| 4 | `exerciseId` is token-only and exactly in the pool | **PROVEN** | Exact-key lookup + live catch of `exr_hip_thrust_machine`; token-boundary matching tested for prefix collisions |
| 5 | Geometry originates only from Output 04 | **PROVEN** | `adaptBoundPlanToGeometry` reads `blocks[].exercises[].sets`; `roundCount` derived, never requested |
| 6 | Step 05 remains the geometry authority | **PROVEN** | `skeletonBuilder`/`geometryLock` unmodified; hash re-verified at materialization every run |
| 7 | Recovery terminates within budget | **PROVEN** | Probe: exactly 2×C1 + 4×C2 then fail closed; one-way `creatorRepairUsed` boolean |
| 8 | Binder faults never re-run Call #1 | **PROVEN** | Policy test + live `BINDER_ONLY` run (1×C1, 2×C2) |
| 9 | Creator repair states the violation without prescribing a fix | **PROVEN** | Prompt dump: one violation, no solution text, closed 3-entry table |
| 10 | Fallback cannot alter geometry or unrelated fields | **PROVEN** | Single merge target, `const`-pinned ids, `minItems=maxItems`, target-must-be-null guard |
| 11 | Tempo absence is `null`, never `"0000"` | **PROVEN** | Live audit: 48 four-digit, 12 null, 0 zero-tempo; tempo fallback path removed |
| 12 | Output 07 fills every skeleton slot exactly once | **STRONGLY SUPPORTED** | `slotCount === fillCount` in all live runs (125, 311, 343, 357); required-slot coverage enforced |
| 13 | **No executable block can be silently lost** | **VIOLATED** | H-1: middle-block omission accepted, `valid: true`, no warning |
| 14 | **No executable block can be silently invented** | **VIOLATED** | H-2: duplicated exercise accepted with zero failures/warnings |
| 15 | Deterministic normalization preserves meaning | **VIOLATED** | H-3 rest compound durations; H-5 tempo phase shift; M-4 per-side loss |
| 16 | Canonical artifacts describe the winning chain | **PARTIALLY PROVEN** | True on success; false on bind failure (M-2) and failed repair (M-3) |
| 17 | Legacy is isolated from `BOUND_PLAN` | **PROVEN** | Isolation probe with control |
| 18 | Output 08 proves the plan is persistable | **NOT PROVEN** | M-5: draft-mode preflight vs publish-mode persistence |

---

# F. Recovery-state audit

**States:** `BIND → VERIFY → {PROCEED | RETRY_BINDER | REPAIR_CREATOR | FAIL_CLOSED}`

**Budgets (enforced in `pipelineRecoveryPolicy.js`):**
`maxCreatorAttempts = 2` · `maxBinderAttemptsPerCreatorOutput = 2` · `maxBinderAttemptsTotal = 4` · fallback = 1

| Trigger | Owner | 1st occurrence | Confirmed | Terminal |
|---|---|---|---|---|
| Schema invalid | BINDER | RETRY | — | `BOUND_PLAN_SCHEMA_INVALID` |
| Span not in source | BINDER | RETRY | — | `BOUND_PLAN_SPAN_NOT_IN_SOURCE` |
| Block arity | BINDER | RETRY | — | `BOUND_PLAN_BLOCK_ARITY_INVALID` |
| >2 superset lanes | BINDER | RETRY | — | `BOUND_PLAN_SUPERSET_LANE_COUNT_UNSUPPORTED` |
| Sets invalid | BINDER | RETRY | — | `BOUND_PLAN_SETS_INVALID` |
| Rest scope | BINDER | RETRY | — | `BOUND_PLAN_REST_SCOPE_INVALID` |
| Exercise type mismatch | BINDER | RETRY | — | `BOUND_PLAN_EXERCISE_TYPE_MISMATCH` |
| Workout count | CREATOR | RETRY (confirm) | REPAIR @FULL | `CREATOR_WORKOUT_COUNT_UNSATISFIED` |
| Unequal superset sets | CREATOR | RETRY (confirm) | REPAIR @FULL | `CREATOR_SUPERSET_SET_COUNT_UNEQUAL` |
| Out-of-pool id | CREATOR | RETRY (confirm) | REPAIR @FULL | `CREATOR_EXERCISE_OUTSIDE_POOL` |
| Coverage out-of-envelope | BINDER | RETRY | — | `BOUND_PLAN_BINDER_OMISSION` |
| Unknown code | BINDER (default) | RETRY | — | the code itself |

**Termination proof.** `creatorRepairUsed` is a one-way boolean with no reset. `binderAttemptsTotal` only increments. `binderAttemptsForCurrentPlan` resets **only** on creator repair, which can happen once. `VERIFY` is pure. Every cycle strictly decreases at least one budget. Live probe: 6 provider calls, then stop.

**Confirmation robustness.** Agreement compares the sorted **constraint set**, not codes or coordinates. Two *different* creator constraints across binds are correctly treated as non-agreement (`CREATOR_CONSTRAINT_UNCONFIRMED_NO_BUDGET`, tested). Weakness: agreement is not coordinate-sensitive — an unequal superset at workout 2 on bind 1 and at workout 5 on bind 2 would count as agreement. Both are genuine creator violations, so the repair is still warranted; the reported coordinates would come from the second bind. Acceptable.

**Any binder-owned failure outranks a creator candidate** (`classifyFailures` returns `BINDER` if any binder code is present), so a defective bind is never mistaken for a coaching fault.

---

# G. Information-preservation audit

| Stage | Intentionally normalized | Intentionally dropped | **Accidentally lost** |
|---|---|---|---|
| **02 → 04** | none — verbatim spans only | non-executable prose, rationale, duration arithmetic | **H-1 middle block**, **H-2 surplus insertions unchecked** |
| **04 → 05** | `sets` → `setCounts[]`; `roundCount` derived; `restStrategy` from blockType | block/exercise labels | none found |
| **05 → 06** | dash folding, range→upper bound, unit conversion, tempo padding, rep-mode selection, bpm/zone detection, modality allowlist, RIR-over-RPE (D2), lane-rest dedupe | RPE when RIR present (recorded); machine settings outside modality allowlist | **H-3 compound rest**, **H-5 tempo phase shift**, **M-4 `/side` qualifier** |
| **06 → 07** | slot → pointer materialization; pool enrichment (name/bodyParts/muscleFocus) | none | none found |
| **07 → 08** | metrics aggregation | none | none found — but M-5 means 08 under-validates |

Every intentional normalization emits a `normalizationDecisions` entry (100 and 97 decisions on the two large live runs), so intended transformations are auditable. The three accidental losses are **not** recorded as decisions — they masquerade as correct normalizations.

---

# H. Legacy isolation audit

**`BOUND_PLAN` is genuinely independent of the second parser.** Proven dynamically, not by reading.

- `parseSourcePlan`, `resolveDeterministicWeeklyPlanFills`, `buildCompactExerciseLookup`, `buildFillExtractionRequest`, `buildStructureExtractionRequest`, `adaptSimpleWeeklyPlanStructureToLegacyGeometry` were all replaced with throwing stubs **before** the orchestrator was required. `BOUND_PLAN` completed with `valid: true` and zero leaks; the `GEOMETRY_ONLY` control tripped immediately.
- `boundPlanFillResolver.js` does not accept `generatedPlanText`; a static test asserts its executable code contains no reference to `generatedPlanText`, `output2` or `parseSourcePlan`.
- Output 02 has exactly three consumers after Output 04 exists: the span verifier (reject-only, no grammar), the closed-dictionary coverage counter, and `resultPresentation` (display prose only).

**Shared-surface risk:** `fillNormalization.js` is shared by both resolvers. The extraction was behaviour-preserving — fixtures A and B produce byte-identical `providerFills` and Output 07 through both paths — but **any future fix to H-3/H-5 changes legacy behaviour too**. That is desirable here (both are bugs) but must be a conscious decision.

**Rollback completeness:** verified. `GEOMETRY_ONLY` emits no `attempts` ledger, no `attempt` field in `aiUsage`, and 8 canonical artifacts; all 33 pre-existing orchestrator/route tests pass unmodified.

---

# I. Test-gap report

Meaningful gaps only (556 tests currently pass).

| Gap | Why it matters |
|---|---|
| **Middle-block omission** | Only last-block omission is tested (`withDroppedClosingBlock`). The untested position is the one that fails (H-1). |
| **First-block omission** | Detected by probe but never asserted. |
| **Binder insertion/duplication** | No test emits more content than the source contains (H-2). |
| **Compound rest durations** | `parseRestSeconds` tested only for `68 sec`, `60–75 sec`, `2.5–3 min`. `1 min 5 sec` and `1:30` untested (H-3). |
| **Tempo with a non-digit phase** | `X-0-1-0` deliberately excluded from the qualitative list with a comment; no test pins the corruption (H-5). |
| **`/side` qualifier** | Only `each side` / `per side` tested (M-4). |
| **Flag typo handling** | No test asserts what an unrecognised `EXTRACTION_MODE` does (M-1). |
| **Canonical artifacts on failure** | Sidecar tests cover the *success* shape; no test asserts canonical 03 on a bind failure or canonical 02 after a failed repair (M-2, M-3). |
| **Coverage mismatch with exhausted budget** | M-6 path untested. |
| **Provider truncation** | `MAX_OUTPUT_TOKENS` classification is not exercised for Call #2 (the real timeout was observed, not tested). |
| **Concurrent generations** | No test for two runs in the same second or shared-state bleed. |

Test quality is otherwise good: the equivalence gates (byte-identical fills/Output 07 across both resolvers) and the corpus self-verification guards are strong, behaviour-level assertions rather than implementation coupling.

---

# J. Production-readiness checklist

### MUST FIX BEFORE STAGING
- **M-1** flag typo → silent legacy routing. Cheap, and staging conclusions are meaningless if the flag silently didn't apply.

### MUST FIX BEFORE PRODUCTION
- **H-1** middle-block omission undetected
- **H-2** binder insertion undetected
- **H-3** compound rest duration corruption
- **H-5** tempo phase-shift corruption
- **H-4** AJV memory accumulation

### SHOULD FIX
- **M-2** canonical Output 03 untruth
- **M-3** repaired plan missing from artifacts on failed repair
- **M-4** `/side` qualifier loss
- **M-6** coverage mismatch accepted when budget exhausted
- Test gaps for middle/first omission, insertion, compound rest, tempo phases

### SAFE TO DEFER
- **M-5** draft/publish validation gap (explicitly out of scope; pre-existing; fails loudly at persistence rather than corrupting)
- **L-1** dead flag documentation
- **L-2** repair-prompt fencing
- **L-3** runId collision window
- **C-1**, **C-2** artifact naming/duplication
- Live creator-repair occurrence
- Call #1 duration overshoot/undershoot (coaching quality, not pipeline correctness)

---

# K. Minimal final action plan

Ordered, smallest-first. No architecture change required.

1. **M-1** — warn (or fail fast) when `EXTRACTION_MODE`/`RECOVERY_LEVEL` receive an unrecognised non-empty value. *~5 lines.*
2. **H-2** — replace `Math.min(offsets.length, boundWorkouts.length)` with an equality assertion; surplus bindings become a binder defect. *~10 lines + tests.*
3. **H-1** — segment coverage by workout using workout-name offsets, or flag any id bound fewer times than it occurs regardless of envelope. *~25 lines + tests.*
4. **H-5** — reject tempo strings containing a non-numeric phase; resolve to `null`. *~8 lines + tests.*
5. **H-3** — sum unit-tagged components and handle `m:ss`; keep upper-bound only for ranges. *~20 lines + tests.*
6. **H-4** — build the AJV instance per call, or strip `geometryHash` from the compiled schema (it is already checked separately). *~3 lines.*
7. **M-2 / M-3** — assign `outputs.output3` when the bind request is rendered; assign `outputs.output1/2` when a repair produces a new plan. *~4 lines.*
8. Add the missing tests from §I before flipping production.

Steps 2–5 touch `fillNormalization.js`/`boundPlanVerification.js`, which are shared with legacy — intentional, since both bugs exist there too.

---

# L. Final answers

**1. Did we eliminate the original multi-parser problem?**
**Yes, in `BOUND_PLAN`.** Proven dynamically with a working control. Five interpreters became one. The legacy second parser remains in the repo but is unreachable from the new path.

**2. Is Call #2 genuinely a binder rather than a second coach?**
**Yes.** Its prompt and schema contain no target geometry, no workout count, and no digit at all. It cannot be told what to produce, only asked what it sees. The one residual coaching pressure — forced workout arity — was removed in the schema (D1). Verified on the live request.

**3. Can the backend still silently lose a real executable block/exercise?**
**Yes.** A dropped **middle** block is accepted with `valid: true` and no warning (H-1). Edge blocks are caught. This is the single most important finding.

**4. Can deterministic normalization silently change coaching meaning?**
**Yes, in three places.** Compound rest durations (H-3), tempo phase shifts (H-5), and `/side` qualifiers (M-4). All pre-existing, all shared with legacy, none recorded as normalization decisions.

**5. Can the recovery ladder loop or exceed its budget?**
**No.** Proven by construction and by live probe: exactly 2×Call #1 + 4×Call #2 + 1 fallback, then fail closed.

**6. Is creator repair architecturally safe despite lacking a live success?**
**Yes.** The prompt is correctly constructed (original system + original user + one non-prescriptive violation + previous plan verbatim), repair is one-way, budgets reset only where intended, and the confirmation half has been observed live. The unexercised step shares its code path with the initial call.

**7. Is narrow fallback truly narrow?**
**Yes.** One merge target, integer allowlist derived from source-supported candidates, `const`-pinned resolution IDs, exact count, and a target-must-be-null guard. The D3 tempo path was removed rather than re-tuned, shrinking the surface back. Live evidence: 11 fallback resolutions, all block rests.

**8. Are the artifacts trustworthy enough for production debugging?**
**Mostly.** `output8.attempts` and the per-attempt sidecars are excellent and truthful. Two untruths exist on failure paths (M-2, M-3) — canonical 03 claims the pipeline never started, and a failed repair leaves the repaired plan without its own artifact. Neither affects correctness; both mislead a debugger.

**9. Is legacy rollback safely isolated?**
**Yes**, with one caveat: `fillNormalization.js` is shared, so fixing H-3/H-5 changes legacy behaviour too. Rollback itself is complete and verified.

**10. Would I approve enabling `BOUND_PLAN` in staging today?**
**Yes — after M-1 only.** Staging is where H-1/H-2 exposure is measurable at low cost, and `BOUND_PLAN` is already demonstrably better than the legacy path it replaces (legacy failed 5 of the real runs we captured; Bound Plan succeeded on every clean creator output). But the flag-typo guard must land first, or a silently-legacy staging run would produce meaningless conclusions.

**11. What exactly prevents production rollout?**
Five items: **H-1** (middle-block omission), **H-2** (undetected insertion), **H-3** (rest corruption), **H-5** (tempo corruption), **H-4** (memory accumulation). All are bounded implementation defects with fixes measured in tens of lines. None require redesign. The architecture itself is sound and should not be changed.

---

## Audit method note

Findings labelled *proven by probe* were established by executing read-only scripts against the real modules and real captured artifacts — not by reading code alone. Probes covered: coverage envelope behaviour for first/middle/last omission and for insertion; normalization of 30+ adversarial tempo/rest/rep strings; legacy isolation by pre-load poisoning with a control; the full failed-creator-repair artifact set; flag resolution for malformed values; and AJV heap growth over 400 compiles. No file was modified and no network call was made during this audit.
