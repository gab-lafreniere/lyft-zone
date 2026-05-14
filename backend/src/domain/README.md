# Domain Layer

`backend/src/domain/` centralizes backend business rules for onboarding and future
AI-assisted program generation. The backend remains the source of truth for all
critical validation rules.

## Structure

- `trainingProfile/`
  - Validates and maps the onboarding training profile payload
  - Owns the canonical v1 training profile shape
- `programGeneration/`
  - Resolves reusable generation inputs from the training profile
  - Keeps future AI Builder logic out of legacy services
- `exercises/`
  - Hosts pure compatibility and pool-building helpers for future exercise selection

## Architecture Rule

Services orchestrate persistence and request flow. Domain modules decide business
rules, normalization, validation, and deterministic derived data.

## Persistence Rule (v1)

`userProfile.onboardingSnapshot` is the canonical source of truth for the new
onboarding training profile. Compatibility JSON fields such as
`trainingPreferences`, `equipmentContext`, `constraints`, and
`musclePriorities` are mirror views written only by
`trainingProfileMapper.js`.

## Scope for This Iteration

- Integrate only `PUT /api/users/:userId/profile`
- Keep `cyclesService.js`, `weeklyPlansService.js`, and `exercisesPrisma.js`
  unchanged
- Keep `exerciseScoringRules.js` intentionally minimal and deterministic until
  the AI Builder consumes it
- Keep `exercisePoolBuilder.js` internal-only; it does not create plans or
  public endpoints

## Exercise selection philosophy (v1)

The backend does NOT decide which exercises go into a program. It prepares an
eligible exercise pool that the AI Coach will use.

Responsibilities are split as follows:

### Backend (domain layer)

The backend is responsible for:

- Hard filters (strict exclusions):
  - unavailable equipment
  - explicitly blocked movement patterns
  - status values outside the allowed set (`approved` by default, `draft` only
    with an explicit dev option)
  - incompatible training types
  - filters must remain minimal and conservative (avoid over-filtering)

- Soft signals (non-blocking hints):
  - muscle priorities (primary / secondary / deprioritized)
  - equipment bias
  - fatigueScore
  - caution patterns and cardio preferences
  - pain / modification context

These signals must NEVER fully exclude an exercise unless it is objectively impossible.

### AI Coach

The AI Coach is responsible for:

- selecting exercises from the eligible pool
- building coherent workouts
- managing variation across cycles
- making tradeoffs (stimulus vs fatigue vs constraints)

### Important rule

The domain layer prepares and structures data.
It does not replace coaching decisions.

## Exercise Pool Builder (v1)

`exercisePoolBuilder.js` is an internal service helper only. It must:

- return eligible exercises in `pool.items`
- return rejected exercises in `pool.excluded` for debug and validation
- apply only objective hard filters
- expose soft signals without turning them into decisions

It must never:

- expose a public/debug endpoint by itself
- generate a workout or full plan
- replace AI coaching decisions
- import or rely on `exerciseScoringRules.js`

## Scoring (v1)

Scoring modules (e.g. `exerciseScoringRules.js`) remain:

- optional
- non-blocking
- used only for hints, ordering, or explanation

They must never replace AI decision-making.
