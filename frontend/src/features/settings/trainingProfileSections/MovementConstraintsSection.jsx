import { useEffect, useMemo, useRef, useState } from "react";
import { fetchExercises } from "../../../services/api";
import {
  AFFECTED_AREA_OPTIONS,
  PAIN_SEVERITY_V2_OPTIONS,
  TRAINING_RULE_V2_OPTIONS,
} from "../settingsOptions";
import {
  CharacterCount,
  CollapsibleBlock,
  Field,
  INPUT_CLASSES,
  ReadonlyChipList,
  SectionBlock,
  SegmentedSelector,
  SelectableCard,
  TEXTAREA_CLASSES,
  applyDraftUpdate,
  findFieldError,
  formatTokenLabel,
} from "./shared";

const MAX_PAIN_ISSUES = 5;
const MAX_DESCRIPTION_LENGTH = 500;
const ANALYSIS_STATUS_LABELS = {
  draft: "Draft",
  analyzed: "Analyzed",
  needs_reanalysis: "Needs re-analysis",
};
const MOCK_SIGNAL_MAP = {
  shoulder: [
    { type: "movementPattern", value: "vertical_push" },
    { type: "jointStressTag", value: "overhead_shoulder_position" },
  ],
  knee: [
    { type: "movementPattern", value: "squat_pattern" },
    { type: "jointStressTag", value: "deep_knee_flexion" },
  ],
  lower_back: [
    { type: "movementPattern", value: "hip_hinge" },
    { type: "jointStressTag", value: "spinal_loading" },
  ],
  elbow: [
    { type: "movementPattern", value: "elbow_extension" },
    { type: "jointStressTag", value: "elbow_extension_stress" },
  ],
  wrist: [
    { type: "movementPattern", value: "wrist_extension" },
    { type: "jointStressTag", value: "wrist_extension_load" },
  ],
  hip: [
    { type: "movementPattern", value: "hip_hinge" },
    { type: "jointStressTag", value: "hip_deep_flexion" },
  ],
  ankle: [
    { type: "movementPattern", value: "lunge_pattern" },
    { type: "jointStressTag", value: "ankle_dorsiflexion_demand" },
  ],
  neck_upper_back: [
    { type: "movementPattern", value: "scapular_elevation" },
    { type: "jointStressTag", value: "spinal_loading" },
  ],
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getMovementConstraints(draft) {
  const movementConstraints = draft?.movementConstraints || {};

  return {
    painIssues: toArray(movementConstraints.painIssues),
    manualBlockedExerciseIds: toArray(movementConstraints.manualBlockedExerciseIds),
  };
}

function buildSummaryItems(values, meta) {
  return toArray(values).map((value) => ({
    label: formatTokenLabel(value),
    meta,
  }));
}

function signalKey(signal) {
  return `${signal?.type || ""}:${signal?.value || ""}`;
}

function isCompleteIssue(issue) {
  return Boolean(
    String(issue?.id || "").trim() &&
    String(issue?.description || "").trim() &&
    String(issue?.affectedArea || "").trim() &&
    String(issue?.painSeverity || "").trim() &&
    String(issue?.trainingRule || "").trim()
  );
}

function getSignalDecision(issue, signal) {
  const key = signalKey(signal);
  const match = toArray(issue?.confirmedSignals).find(
    (confirmedSignal) => signalKey(confirmedSignal) === key
  );

  return match?.decision || "none";
}

function addUnique(target, value) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function deriveMovementConstraints(movementConstraints) {
  const cautionMovementPatterns = [];
  const blockedMovementPatterns = [];
  const cautionJointStressTags = [];
  const blockedJointStressTags = [];
  const manualBlockedExerciseIds = Array.from(
    new Set(toArray(movementConstraints.manualBlockedExerciseIds).filter(Boolean))
  );

  toArray(movementConstraints.painIssues)
    .filter((issue) => issue.analysisStatus === "analyzed" && isCompleteIssue(issue))
    .forEach((issue) => {
      toArray(issue.confirmedSignals).forEach((signal) => {
        if (signal.type === "movementPattern" && signal.decision === "caution") {
          addUnique(cautionMovementPatterns, signal.value);
        }

        if (signal.type === "movementPattern" && signal.decision === "blocked") {
          addUnique(blockedMovementPatterns, signal.value);
        }

        if (signal.type === "jointStressTag" && signal.decision === "caution") {
          addUnique(cautionJointStressTags, signal.value);
        }

        if (signal.type === "jointStressTag" && signal.decision === "blocked") {
          addUnique(blockedJointStressTags, signal.value);
        }
      });
    });

  return {
    cautionMovementPatterns,
    blockedMovementPatterns,
    cautionJointStressTags,
    blockedJointStressTags,
    manualBlockedExerciseIds,
    blockedExerciseIds: manualBlockedExerciseIds,
    debug: {
      manualBlockedExerciseCount: manualBlockedExerciseIds.length,
      ruleDerivedBlockedExerciseCount: null,
    },
  };
}

function createIssue() {
  const randomSuffix = Math.random().toString(36).slice(2, 8);

  return {
    id: `issue_${Date.now()}_${randomSuffix}`,
    description: "",
    affectedArea: "",
    painSeverity: "low",
    trainingRule: "",
    analysisStatus: "draft",
    detectedSignals: [],
    confirmedSignals: [],
  };
}

function getMockDetectedSignals(issue) {
  return MOCK_SIGNAL_MAP[issue?.affectedArea] || [];
}

function getIssueTitle(issue, index) {
  const description = String(issue?.description || "").trim();
  if (!description) {
    return `Pain issue ${index + 1}`;
  }

  return description.length > 48 ? `${description.slice(0, 45)}...` : description;
}

function getOptionLabel(options, value, fallback = "Not set") {
  return options.find((option) => option.value === value)?.label || fallback;
}

function getIssueMeta(issue) {
  return [
    getOptionLabel(AFFECTED_AREA_OPTIONS, issue?.affectedArea),
    getOptionLabel(PAIN_SEVERITY_V2_OPTIONS, issue?.painSeverity),
    getOptionLabel(TRAINING_RULE_V2_OPTIONS, issue?.trainingRule),
  ].join(" · ");
}

function getSignalCounts(issue) {
  return toArray(issue?.confirmedSignals).reduce(
    (counts, signal) => ({
      caution: counts.caution + (signal.decision === "caution" ? 1 : 0),
      blocked: counts.blocked + (signal.decision === "blocked" ? 1 : 0),
    }),
    { caution: 0, blocked: 0 }
  );
}

function normalizeExerciseName(exercise) {
  return exercise?.name || exercise?.exerciseId || "";
}

function SummaryChipGroup({ title, items, tone = "neutral", emptyLabel }) {
  if (!items.length && emptyLabel) {
    return (
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
          {title}
        </p>
        <p className="mt-1 text-sm font-medium text-slate-700">{emptyLabel}</p>
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${title}-${item.meta || ""}-${item.label}`}
            className={[
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
              tone === "danger"
                ? "border-red-200/80 bg-red-50/80 text-red-700"
                : "border-[rgba(25,230,212,0.35)] bg-[rgba(25,230,212,0.14)] text-slate-800",
            ].join(" ")}
          >
            <span>{item.label}</span>
            {item.meta ? (
              <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
                {item.meta}
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MovementConstraintsSection({ draft, onChange, fieldErrors }) {
  const movementConstraints = getMovementConstraints(draft);
  const exerciseSearchRef = useRef(null);
  const issueRefs = useRef({});
  const [openIssueId, setOpenIssueId] = useState(null);
  const [pendingRemoveIssueId, setPendingRemoveIssueId] = useState(null);
  const [pendingReanalyzeIssueId, setPendingReanalyzeIssueId] = useState(null);
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [exerciseResults, setExerciseResults] = useState([]);
  const [exerciseNamesById, setExerciseNamesById] = useState({});
  const [isSearchingExercises, setIsSearchingExercises] = useState(false);
  const [exerciseSearchError, setExerciseSearchError] = useState("");
  const derivedConstraints = useMemo(
    () => deriveMovementConstraints(movementConstraints),
    [movementConstraints]
  );
  const restrictedItems = [
    ...buildSummaryItems(derivedConstraints.blockedMovementPatterns, "Movement"),
    ...buildSummaryItems(derivedConstraints.blockedJointStressTags, "Stress"),
  ];
  const cautionItems = [
    ...buildSummaryItems(derivedConstraints.cautionMovementPatterns, "Movement"),
    ...buildSummaryItems(derivedConstraints.cautionJointStressTags, "Stress"),
  ];
  const hasActiveConstraints =
    restrictedItems.length > 0 ||
    cautionItems.length > 0 ||
    derivedConstraints.manualBlockedExerciseIds.length > 0;
  const canAddIssue = movementConstraints.painIssues.length < MAX_PAIN_ISSUES;
  const pendingRemoveIssue = movementConstraints.painIssues.find(
    (issue) => issue.id === pendingRemoveIssueId
  );
  const pendingReanalyzeIssue = movementConstraints.painIssues.find(
    (issue) => issue.id === pendingReanalyzeIssueId
  );

  useEffect(() => {
    function handleDocumentPointerDown(event) {
      if (exerciseSearchRef.current?.contains(event.target)) {
        return;
      }

      clearManualExerciseSearch();
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, []);

  useEffect(() => {
    const query = exerciseQuery.trim();
    if (!query) {
      setExerciseResults([]);
      setExerciseSearchError("");
      setIsSearchingExercises(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsSearchingExercises(true);
      setExerciseSearchError("");

      try {
        const results = await fetchExercises({ q: query, limit: 25, status: "approved" });

        if (!cancelled) {
          setExerciseResults(results);
          setExerciseNamesById((currentNames) => {
            const nextNames = { ...currentNames };
            results.forEach((exercise) => {
              if (exercise?.exerciseId) {
                nextNames[exercise.exerciseId] = normalizeExerciseName(exercise);
              }
            });
            return nextNames;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setExerciseResults([]);
          setExerciseSearchError(error.message || "Unable to load exercises.");
        }
      } finally {
        if (!cancelled) {
          setIsSearchingExercises(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [exerciseQuery]);

  function updateMovementConstraints(producer) {
    applyDraftUpdate(draft, onChange, (nextDraft) => {
      if (!nextDraft.movementConstraints || typeof nextDraft.movementConstraints !== "object") {
        nextDraft.movementConstraints = {};
      }

      if (!Array.isArray(nextDraft.movementConstraints.painIssues)) {
        nextDraft.movementConstraints.painIssues = [];
      }

      if (!Array.isArray(nextDraft.movementConstraints.manualBlockedExerciseIds)) {
        nextDraft.movementConstraints.manualBlockedExerciseIds = [];
      }

      producer(nextDraft.movementConstraints);
    });
  }

  function updateIssue(issueId, producer) {
    updateMovementConstraints((nextMovementConstraints) => {
      nextMovementConstraints.painIssues = nextMovementConstraints.painIssues.map((issue) => {
        if (issue.id !== issueId) {
          return issue;
        }

        const nextIssue = { ...issue };
        producer(nextIssue);
        return nextIssue;
      });
    });
  }

  function handleAddIssue() {
    if (!canAddIssue) {
      return;
    }

    const issue = createIssue();
    updateMovementConstraints((nextMovementConstraints) => {
      nextMovementConstraints.painIssues = [...nextMovementConstraints.painIssues, issue];
    });
    setOpenIssueId(issue.id);
    window.requestAnimationFrame(() => {
      const issueElement = issueRefs.current[issue.id];
      if (typeof issueElement?.scrollIntoView !== "function") {
        return;
      }

      issueElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function handleRemoveIssue(issueId) {
    updateMovementConstraints((nextMovementConstraints) => {
      nextMovementConstraints.painIssues = nextMovementConstraints.painIssues.filter(
        (issue) => issue.id !== issueId
      );
    });
    setOpenIssueId((currentOpenIssueId) =>
      currentOpenIssueId === issueId ? null : currentOpenIssueId
    );
    setPendingRemoveIssueId(null);
  }

  function clearManualExerciseSearch() {
    setExerciseQuery("");
    setExerciseResults([]);
    setExerciseSearchError("");
    setIsSearchingExercises(false);
  }

  function handleSourceFieldChange(issueId, field, value) {
    updateIssue(issueId, (nextIssue) => {
      nextIssue[field] = value;

      if (nextIssue.analysisStatus === "analyzed") {
        nextIssue.analysisStatus = "needs_reanalysis";
      }
    });
  }

  function applyMockAnalyze(issue) {
    updateIssue(issue.id, (nextIssue) => {
      nextIssue.analysisStatus = "analyzed";
      nextIssue.detectedSignals = getMockDetectedSignals(nextIssue);
      nextIssue.confirmedSignals = [];
    });
    setPendingReanalyzeIssueId(null);
  }

  function handleAnalyze(issue) {
    const isReanalysis =
      issue.analysisStatus === "analyzed" || issue.analysisStatus === "needs_reanalysis";

    if (isReanalysis) {
      setPendingReanalyzeIssueId(issue.id);
      return;
    }

    applyMockAnalyze(issue);
  }

  function handleDecisionChange(issue, signal, decision) {
    updateIssue(issue.id, (nextIssue) => {
      const key = signalKey(signal);
      const remainingSignals = toArray(nextIssue.confirmedSignals).filter(
        (confirmedSignal) => signalKey(confirmedSignal) !== key
      );

      nextIssue.confirmedSignals =
        decision === "none"
          ? remainingSignals
          : [...remainingSignals, { ...signal, decision }];
    });
  }

  function handleAddManualBlockedExercise(exercise) {
    if (!exercise?.exerciseId) {
      return;
    }

    setExerciseNamesById((currentNames) => ({
      ...currentNames,
      [exercise.exerciseId]: normalizeExerciseName(exercise),
    }));
    updateMovementConstraints((nextMovementConstraints) => {
      nextMovementConstraints.manualBlockedExerciseIds = Array.from(
        new Set([...nextMovementConstraints.manualBlockedExerciseIds, exercise.exerciseId])
      );
    });
    clearManualExerciseSearch();
  }

  function handleRemoveManualBlockedExercise(exerciseId) {
    updateMovementConstraints((nextMovementConstraints) => {
      nextMovementConstraints.manualBlockedExerciseIds =
        nextMovementConstraints.manualBlockedExerciseIds.filter((id) => id !== exerciseId);
    });
  }

  function renderIssueForm(issue, index) {
    const description = String(issue.description || "");
    const canAnalyze =
      isCompleteIssue(issue) && description.length <= MAX_DESCRIPTION_LENGTH;
    const analyzeLabel =
      issue.analysisStatus === "analyzed" || issue.analysisStatus === "needs_reanalysis"
        ? "Re-analyze with AI"
        : "Analyze with AI";

    return (
      <div className="space-y-5">
        <Field
          label="Description"
          error={findFieldError(fieldErrors, [
            `movementConstraints.painIssues[${index}].description`,
          ])}
        >
          <textarea
            rows={4}
            className={TEXTAREA_CLASSES}
            value={description}
            onChange={(event) =>
              handleSourceFieldChange(issue.id, "description", event.target.value)
            }
            placeholder="Shoulder irritation during overhead pressing"
          />
          <CharacterCount current={description.length} limit={MAX_DESCRIPTION_LENGTH} />
        </Field>

        <Field
          label="Affected Area"
          error={findFieldError(fieldErrors, [
            `movementConstraints.painIssues[${index}].affectedArea`,
          ])}
        >
          <div className="mt-2 flex flex-wrap gap-2">
            {AFFECTED_AREA_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSourceFieldChange(issue.id, "affectedArea", option.value)}
                className={[
                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                  issue.affectedArea === option.value
                    ? "border-primary/40 bg-primary/10 text-slate-900 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Pain Severity"
          error={findFieldError(fieldErrors, [
            `movementConstraints.painIssues[${index}].painSeverity`,
          ])}
        >
          <div className="mt-2">
            <SegmentedSelector
              options={PAIN_SEVERITY_V2_OPTIONS}
              value={issue.painSeverity || ""}
              onChange={(value) => handleSourceFieldChange(issue.id, "painSeverity", value)}
            />
          </div>
        </Field>

        <Field
          label="Training Rule"
          error={findFieldError(fieldErrors, [
            `movementConstraints.painIssues[${index}].trainingRule`,
          ])}
        >
          <div className="mt-2 space-y-3">
            {TRAINING_RULE_V2_OPTIONS.map((option) => (
              <SelectableCard
                key={option.value}
                label={option.label}
                description={option.description}
                icon={option.icon}
                selected={issue.trainingRule === option.value}
                tone={option.value === "avoid" ? "warning" : "default"}
                onClick={() => handleSourceFieldChange(issue.id, "trainingRule", option.value)}
              />
            ))}
          </div>
        </Field>

        <div className="flex justify-end">
          <div className="text-right">
            <button
              type="button"
              aria-label={analyzeLabel}
              disabled={!canAnalyze}
              onClick={() => handleAnalyze(issue)}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              <span className="material-symbols-outlined text-base">psychology</span>
              {analyzeLabel}
            </button>
            <p className="mt-2 text-xs font-medium text-slate-500">
              AI analysis preview. Final AI logic will be connected later.
            </p>
          </div>
        </div>

        <Field
          label="Detected Signals"
          hint="AI analysis preview. Final AI logic will be connected later."
        >
          {toArray(issue.detectedSignals).length ? (
            <div className="mt-2 space-y-2">
              {issue.detectedSignals.map((signal) => {
                const decision = getSignalDecision(issue, signal);

                return (
                  <div
                    key={signalKey(signal)}
                    className="rounded-[14px] border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold leading-snug text-slate-900">
                          {formatTokenLabel(signal.value)}
                        </p>
                        <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          {signal.type === "movementPattern" ? "Movement" : "Joint stress"}
                        </span>
                      </div>
                      <div className="grid w-full grid-cols-3 overflow-hidden rounded-full border border-slate-200 text-[11px] font-bold sm:w-auto sm:min-w-[210px]">
                        {[
                          ["none", "X"],
                          ["caution", "Caution"],
                          ["blocked", "Blocked"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => handleDecisionChange(issue, signal, value)}
                            className={[
                              "whitespace-nowrap px-2.5 py-1.5 transition",
                              decision === value
                                ? value === "blocked"
                                  ? "bg-red-50 text-red-700"
                                  : value === "caution"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-slate-100 text-slate-700"
                                : "bg-white text-slate-500",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No detected signals yet.</p>
          )}
        </Field>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionBlock
        title="Active Constraints"
        description="Current applied movement limits."
        className="border-[rgba(25,230,212,0.25)] bg-[rgba(25,230,212,0.08)]"
      >
        <div className="space-y-3">
          {hasActiveConstraints ? (
            <div className="space-y-3">
              <SummaryChipGroup title="Blocked signals" items={restrictedItems} tone="danger" />
              <SummaryChipGroup title="Caution signals" items={cautionItems} />
              {derivedConstraints.manualBlockedExerciseIds.length ? (
                <SummaryChipGroup
                  title="Manual blocked exercises"
                  items={[
                    {
                      label: `${derivedConstraints.manualBlockedExerciseIds.length}`,
                      meta: "Exercises",
                    },
                  ]}
                  tone="danger"
                />
              ) : null}
            </div>
          ) : (
            <SummaryChipGroup
              items={[]}
              emptyLabel="No active movement restrictions"
            />
          )}
        </div>
      </SectionBlock>

      <SectionBlock title="Pain Issues" description="Track each issue separately.">
        <div className="space-y-3">
          {movementConstraints.painIssues.length ? (
            movementConstraints.painIssues.map((issue, index) => {
              const isOpen = openIssueId === issue.id;
              const counts = getSignalCounts(issue);

              return (
                <div
                  key={issue.id}
                  ref={(element) => {
                    if (element) {
                      issueRefs.current[issue.id] = element;
                    } else {
                      delete issueRefs.current[issue.id];
                    }
                  }}
                  className="overflow-hidden rounded-[20px] border border-slate-200 bg-white"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Toggle pain issue ${index + 1}`}
                      onClick={() => setOpenIssueId(isOpen ? null : issue.id)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {getIssueTitle(issue, index)}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            {ANALYSIS_STATUS_LABELS[issue.analysisStatus || "draft"]}
                          </span>
                          {counts.caution ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                              {counts.caution} caution
                            </span>
                          ) : null}
                          {counts.blocked ? (
                            <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700">
                              {counts.blocked} blocked
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {getIssueMeta(issue)}
                        </p>
                      </div>

                      <span
                        className={[
                          "material-symbols-outlined text-slate-400 transition-transform",
                          isOpen ? "rotate-180" : "",
                        ].join(" ")}
                      >
                        expand_more
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemoveIssueId(issue.id)}
                      className="mr-3 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-red-500 transition hover:bg-red-50 hover:text-red-700 focus:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-100"
                      aria-label={`Remove ${getIssueTitle(issue, index)}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="border-t border-slate-100 px-4 py-4">
                      {renderIssueForm(issue, index)}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">No pain issues added.</p>
          )}

          <button
            type="button"
            disabled={!canAddIssue}
            onClick={handleAddIssue}
            className="flex w-full items-center justify-center gap-2 rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-primary/40 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Add pain issue
          </button>
          {!canAddIssue ? (
            <p className="text-sm font-medium text-slate-500">
              You can add up to {MAX_PAIN_ISSUES} pain issues.
            </p>
          ) : null}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Manual Blocked Exercises"
        description="Block exercises you do not want, independent of pain issues."
      >
        <div ref={exerciseSearchRef}>
          <Field label="Search Exercises">
            <div className="relative">
              <input
                type="text"
                className={`${INPUT_CLASSES} pr-11`}
                value={exerciseQuery}
                onChange={(event) => setExerciseQuery(event.target.value)}
                placeholder="Search exercises..."
              />
              {exerciseQuery ? (
                <button
                  type="button"
                  aria-label="Clear exercise search"
                  onClick={clearManualExerciseSearch}
                  className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              ) : null}
            </div>
          </Field>

          {exerciseQuery.trim() ? (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-[18px] border border-slate-200 bg-white p-2">
              {isSearchingExercises ? (
                <p className="px-2 py-3 text-sm text-slate-500">Loading exercises...</p>
              ) : null}
              {!isSearchingExercises && exerciseSearchError ? (
                <p className="px-2 py-3 text-sm text-red-500">{exerciseSearchError}</p>
              ) : null}
              {!isSearchingExercises && !exerciseSearchError && exerciseResults.length === 0 ? (
                <p className="px-2 py-3 text-sm text-slate-500">No exercises found.</p>
              ) : null}
              {!isSearchingExercises &&
                !exerciseSearchError &&
                exerciseResults.map((exercise) => {
                  const isSelected = movementConstraints.manualBlockedExerciseIds.includes(
                    exercise.exerciseId
                  );

                  return (
                    <button
                      key={exercise.exerciseId}
                      type="button"
                      disabled={isSelected}
                      onClick={() => handleAddManualBlockedExercise(exercise)}
                      className="flex w-full items-center justify-between gap-3 rounded-[14px] px-3 py-2 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold leading-snug text-slate-800">
                          {exercise.name}
                        </span>
                        <span className="block truncate text-[11px] leading-snug text-slate-400">
                          {exercise.exerciseId}
                        </span>
                      </span>
                      <span className="material-symbols-outlined shrink-0 text-slate-300">
                        {isSelected ? "check_circle" : "add_circle"}
                      </span>
                    </button>
                  );
                })}
            </div>
          ) : null}
        </div>

        <Field label="Blocked Exercises">
          {movementConstraints.manualBlockedExerciseIds.length ? (
            <div className="mt-2 space-y-2">
              {movementConstraints.manualBlockedExerciseIds.map((exerciseId) => (
                <div
                  key={exerciseId}
                  className="flex items-center justify-between gap-3 rounded-[14px] border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold leading-snug text-slate-900">
                      {exerciseNamesById[exerciseId] || exerciseId}
                    </p>
                    <p className="truncate text-[11px] leading-snug text-slate-400">
                      {exerciseId}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveManualBlockedExercise(exerciseId)}
                    className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Remove ${exerciseId}`}
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No manually blocked exercises.</p>
          )}
        </Field>
      </SectionBlock>

      {pendingRemoveIssue ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-pain-issue-title"
            className="w-full max-w-sm rounded-[20px] border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3 id="remove-pain-issue-title" className="text-base font-bold text-slate-900">
              Remove this pain issue?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              This will remove its detected and confirmed signals. This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemoveIssueId(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRemoveIssue(pendingRemoveIssue.id)}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingReanalyzeIssue ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reanalyze-pain-issue-title"
            className="w-full max-w-sm rounded-[20px] border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3 id="reanalyze-pain-issue-title" className="text-base font-bold text-slate-900">
              Re-analyze this pain issue?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              This will replace the current detected signals and remove any confirmed caution or
              blocked decisions for this pain issue.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingReanalyzeIssueId(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => applyMockAnalyze(pendingReanalyzeIssue)}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white"
              >
                Re-analyze with AI
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CollapsibleBlock
        title="Advanced signals"
        description="Readonly overview of applied movement constraints."
        badge="Readonly"
        defaultOpen={false}
      >
        <div className="space-y-4 rounded-[18px] bg-slate-50 p-4">
          <Field label="Caution Movement Patterns">
            <ReadonlyChipList
              values={derivedConstraints.cautionMovementPatterns}
              labelMap={{}}
              emptyLabel="None"
            />
          </Field>
          <Field label="Blocked Movement Patterns">
            <ReadonlyChipList
              values={derivedConstraints.blockedMovementPatterns}
              labelMap={{}}
              emptyLabel="None"
              tone="strong"
            />
          </Field>
          <Field label="Caution Joint Stress Tags">
            <ReadonlyChipList
              values={derivedConstraints.cautionJointStressTags}
              labelMap={{}}
              emptyLabel="None"
            />
          </Field>
          <Field label="Blocked Joint Stress Tags">
            <ReadonlyChipList
              values={derivedConstraints.blockedJointStressTags}
              labelMap={{}}
              emptyLabel="None"
              tone="strong"
            />
          </Field>
          <Field label="Manual Blocked Exercise IDs">
            <ReadonlyChipList
              values={derivedConstraints.manualBlockedExerciseIds}
              labelMap={{}}
              emptyLabel="None"
            />
          </Field>
          <Field label="Debug Counts">
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Manual blocked
                </p>
                <p className="mt-1 font-bold text-slate-900">
                  {derivedConstraints.debug.manualBlockedExerciseCount}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Rule derived
                </p>
                <p className="mt-1 font-bold text-slate-900">
                  {derivedConstraints.debug.ruleDerivedBlockedExerciseCount ?? "Not calculated"}
                </p>
              </div>
            </div>
          </Field>
        </div>
      </CollapsibleBlock>
    </div>
  );
}
