import { Button, StickyBottomActions } from "../../design-v2";
import {
  AREA_KIND_MAP,
  AREA_PARENT_MAP,
} from "../settings/settingsOptions";

const DISPLAY_PRIORITY_PARENT = {
  upper_chest: "chest",
  mid_chest: "chest",
  lower_chest: "chest",
  lats: "back",
  upper_back: "back",
  lower_back: "back",
  front_delts: "shoulders",
  side_delts: "shoulders",
  rear_delts: "shoulders",
  biceps_long_head: "biceps",
  biceps_short_head: "biceps",
  triceps_long_head: "triceps",
  triceps_lateral_head: "triceps",
  upper_abs: "abs",
  lower_abs: "abs",
  obliques: "abs",
  glute_max: "glutes",
  glute_med: "glutes",
  gastrocnemius: "calves",
  soleus: "calves",
};

function normalizeWords(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function resolveDisplayPriority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return DISPLAY_PRIORITY_PARENT[normalized] ||
    (AREA_KIND_MAP[normalized] === "micro"
      ? AREA_PARENT_MAP[normalized]
      : null) ||
    normalized;
}

export function buildPrioritizedMuscleKeys(profile) {
  const priorities = profile?.musclePriorities || {};
  const values = [
    priorities.primaryFocus,
    ...(Array.isArray(priorities.secondaryFocuses)
      ? priorities.secondaryFocuses
      : []),
  ];
  const result = new Set();
  values.filter(Boolean).forEach((value) => {
    const macro = resolveDisplayPriority(value);
    result.add(macro);
    if (macro === "abs" || macro === "core") {
      result.add("abs");
      result.add("core");
    }
  });
  return result;
}

function normalizeDistributionKey(entry) {
  const value = entry?.key || entry?.label;
  return normalizeWords(value)
    .toLowerCase()
    .replace(/\s*&\s*/g, "_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function isDisplayMetric(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function MetricTile({ value, label, accent = false, suffix = "" }) {
  return (
    <div className="lz-onboarding-result-metric">
      <dt>{label}</dt>
      <dd className={accent ? "lz-onboarding-result-metric__value--accent" : ""}>
        {value}{suffix}
      </dd>
    </div>
  );
}

function MuscleVolumeRow({ entry, accent = false }) {
  const width = Math.max(0, Math.min(100, Number(entry.percentage) || 0));
  return (
    <div className="lz-onboarding-result-muscle">
      <div>
        <span>{entry.label || entry.key}</span>
        <strong className={accent ? "lz-onboarding-result-muscle__value--info" : ""}>
          {entry.rawSets} sets
        </strong>
      </div>
      <span className="lz-onboarding-result-muscle__track" aria-hidden="true">
        <span
          className={accent ? "lz-onboarding-result-muscle__fill--info" : ""}
          style={{ width: `${width}%` }}
        />
      </span>
    </div>
  );
}

function formatScheduledDay(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

function TrainingSplitRow({ workout }) {
  const day = formatScheduledDay(workout.scheduledDay);
  return (
    <li className="lz-onboarding-result-split-row">
      {day ? <span>{day}</span> : null}
      <strong>{workout.name}</strong>
    </li>
  );
}

function CoachInsightCard({ title, children, tone = "action" }) {
  return (
    <article className="lz-onboarding-result-insight">
      <span
        className={`lz-onboarding-result-insight__mark lz-onboarding-result-insight__mark--${tone}`}
        aria-hidden="true"
      >
        {tone === "info" ? "↗" : "◇"}
      </span>
      <div>
        <h3>{title}</h3>
        <div>{children}</div>
      </div>
    </article>
  );
}

export default function OnboardingProgramResult({
  weeklyPlan,
  cycle,
  profile,
  onModify,
  onDetails,
}) {
  const presentation = weeklyPlan?.presentation || {};
  const metrics = weeklyPlan?.metrics || {};
  const name = presentation.title || weeklyPlan?.name || "Your Program";
  const prioritizedMuscleKeys = buildPrioritizedMuscleKeys(profile);
  const cycleId = cycle?.cycleId || cycle?.cycle?.id;
  const durationWeeks = Number(cycle?.durationWeeks || cycle?.cycle?.durationWeeks);
  const muscleDistribution = Array.isArray(metrics.weeklyMuscleDistribution)
    ? metrics.weeklyMuscleDistribution.filter((entry) =>
      Number(entry?.rawSets) > 0
    )
    : [];
  const workouts = Array.isArray(cycle?.builderPayload?.weeks?.[0]?.workouts)
    ? [...cycle.builderPayload.weeks[0].workouts]
        .filter((workout) => workout?.name)
        .sort((left, right) => Number(left.orderIndex) - Number(right.orderIndex))
    : [];
  const coachingNotes = Array.isArray(presentation.coachingNotes)
    ? presentation.coachingNotes.filter(Boolean)
    : [];
  const hasInsights = Boolean(presentation.progression || coachingNotes.length);
  const metricItems = [
    { key: "sets", value: metrics.strengthSets, label: "Total Sets", accent: true },
    { key: "exercises", value: metrics.totalExercises, label: "Exercises" },
    { key: "time", value: metrics.averageDurationMinutes, label: "Avg. Workout", suffix: "m" },
    { key: "tut", value: metrics.averageTUTMinutes, label: "Avg. TUT", suffix: "m" },
  ].filter((item) => isDisplayMetric(item.value));

  return (
    <>
      <section className="lz-onboarding-result" aria-labelledby="onboarding-result-title">
        <header className="lz-onboarding-result-hero">
          <p className="lz-onboarding-result-status">Program Generated</p>
          {Number.isSafeInteger(durationWeeks) && durationWeeks > 0 ? (
            <p className="lz-onboarding-result-duration">{durationWeeks}-Week Training Cycle</p>
          ) : null}
          <h1 id="onboarding-result-title">{name}</h1>
          {presentation.summary ? <p>{presentation.summary}</p> : null}
        </header>

        {metricItems.length > 0 ? (
          <section className="lz-onboarding-result-overview" aria-labelledby="weekly-volume-title">
            <h2 id="weekly-volume-title">Weekly Volume Overview</h2>
            <dl>
              {metricItems.map((item) => <MetricTile key={item.key} {...item} />)}
            </dl>
          </section>
        ) : null}

        {muscleDistribution.length > 0 ? (
          <section className="lz-onboarding-result-section" aria-labelledby="muscle-volume-title">
            <div className="lz-onboarding-result-section__heading">
              <h2 id="muscle-volume-title">Muscle Volume Distribution</h2>
              <span>Weekly Sets</span>
            </div>
            <div className="lz-onboarding-result-muscles">
              {muscleDistribution.map((entry) => (
                <MuscleVolumeRow
                  key={entry.key || entry.label}
                  entry={entry}
                  accent={prioritizedMuscleKeys.has(
                    normalizeDistributionKey(entry)
                  )}
                />
              ))}
            </div>
          </section>
        ) : null}

        {workouts.length > 0 ? (
          <section className="lz-onboarding-result-section" aria-labelledby="training-split-title">
            <div className="lz-onboarding-result-section__heading">
              <h2 id="training-split-title">Your Training Split</h2>
            </div>
            <ol className="lz-onboarding-result-split">
              {workouts.map((workout) => (
                <TrainingSplitRow key={workout.id || workout.orderIndex} workout={workout} />
              ))}
            </ol>
          </section>
        ) : null}

        {hasInsights ? (
          <section className="lz-onboarding-result-section" aria-labelledby="coach-insight-title">
            <div className="lz-onboarding-result-section__heading">
              <h2 id="coach-insight-title">Coach&apos;s Insight</h2>
            </div>
            <div className="lz-onboarding-result-insights">
              {presentation.progression ? (
                <CoachInsightCard title="Progression">
                  <p>{presentation.progression}</p>
                </CoachInsightCard>
              ) : null}
              {coachingNotes.length > 0 ? (
                <CoachInsightCard title="Coaching Notes" tone="info">
                  <ul>
                    {coachingNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                  </ul>
                </CoachInsightCard>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>

      <StickyBottomActions
        aria-label="Generated program actions"
        className="lz-onboarding-result-actions"
        innerClassName="lz-onboarding-result-actions__inner"
      >
        <Button variant="secondary" size="lg" onClick={onModify} disabled={!cycleId}>
          Modify
        </Button>
        <Button size="lg" onClick={onDetails} disabled={!cycleId}>
          Details
        </Button>
      </StickyBottomActions>
    </>
  );
}
