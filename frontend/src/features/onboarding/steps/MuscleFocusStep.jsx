import { Fragment, useEffect, useRef, useState } from "react";
import { Chip } from "../../../design-v2";
import { getMuscleMacroRegions } from "../muscleRegionMapping";
import { validateMuscleStep } from "../onboardingValidation";
import OnboardingStepLayout from "../OnboardingStepLayout";

const MODE_CONFIG = [
  { value: "primary", label: "Main", limit: 1, tone: "main" },
  { value: "secondary", label: "Secondary", limit: 2, tone: "secondary" },
  { value: "deprioritized", label: "Reduce", limit: 1, tone: "reduced" },
];

function getAssignment(priorities, value) {
  if (priorities.primaryFocus === value) return "main";
  if (priorities.secondaryFocuses.includes(value)) return "secondary";
  if (priorities.deprioritizedArea === value) return "reduced";
  return "";
}

function getModeCount(priorities, mode) {
  if (mode === "primary") return priorities.primaryFocus ? 1 : 0;
  if (mode === "secondary") return priorities.secondaryFocuses.length;
  return priorities.deprioritizedArea ? 1 : 0;
}

function getRegionAssignments(priorities, region) {
  return (region.allOptions || region.options)
    .map((option) => ({
      value: option.value,
      label: option.label,
      assignment: getAssignment(priorities, option.value),
    }))
    .filter((option) => option.assignment);
}

export default function MuscleFocusStep({
  draft,
  availabilityOptions,
  onChange,
  fieldErrors = {},
  disabled = false,
}) {
  const [mode, setMode] = useState("primary");
  const [openRegionId, setOpenRegionId] = useState(null);
  const [interactionError, setInteractionError] = useState("");
  const openPanelRef = useRef(null);
  const openedRegionModesRef = useRef(new Set());
  const priorities = {
    primaryFocus: draft?.musclePriorities?.primaryFocus || null,
    secondaryFocuses: draft?.musclePriorities?.secondaryFocuses || [],
    deprioritizedArea: draft?.musclePriorities?.deprioritizedArea || null,
  };
  const regions = getMuscleMacroRegions(mode);

  useEffect(() => {
    if (!openRegionId || !openPanelRef.current) {
      return undefined;
    }

    const panel = openPanelRef.current;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const scrollPanelIntoView = () => {
      if (typeof panel.scrollIntoView === "function") {
        panel.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "nearest",
        });
      }
    };
    const frameId = window.requestAnimationFrame
      ? window.requestAnimationFrame(scrollPanelIntoView)
      : window.setTimeout(scrollPanelIntoView, 0);

    return () => {
      if (window.cancelAnimationFrame) {
        window.cancelAnimationFrame(frameId);
      } else {
        window.clearTimeout(frameId);
      }
    };
  }, [mode, openRegionId]);

  function selectArea(value, replaceValues = []) {
    const replacementSet = new Set(
      replaceValues.filter((entry) => entry && entry !== value)
    );
    const nextPriorities = {
      ...priorities,
      secondaryFocuses: priorities.secondaryFocuses.filter(
        (entry) => !replacementSet.has(entry)
      ),
    };

    if (mode === "primary") {
      nextPriorities.primaryFocus = priorities.primaryFocus === value ? null : value;
      nextPriorities.secondaryFocuses = nextPriorities.secondaryFocuses.filter(
        (entry) => entry !== value
      );
      if (nextPriorities.deprioritizedArea === value) {
        nextPriorities.deprioritizedArea = null;
      }
    } else if (mode === "secondary") {
      if (priorities.secondaryFocuses.includes(value)) {
        nextPriorities.secondaryFocuses = nextPriorities.secondaryFocuses.filter(
          (entry) => entry !== value
        );
      } else {
        if (nextPriorities.secondaryFocuses.length >= 2) {
          setInteractionError("Choose up to two secondary areas.");
          return;
        }
        nextPriorities.secondaryFocuses.push(value);
        if (nextPriorities.primaryFocus === value) {
          nextPriorities.primaryFocus = null;
        }
        if (nextPriorities.deprioritizedArea === value) {
          nextPriorities.deprioritizedArea = null;
        }
      }
    } else {
      nextPriorities.deprioritizedArea =
        priorities.deprioritizedArea === value ? null : value;
      if (nextPriorities.deprioritizedArea) {
        if (nextPriorities.primaryFocus === value) {
          nextPriorities.primaryFocus = null;
        }
        nextPriorities.secondaryFocuses = nextPriorities.secondaryFocuses.filter(
          (entry) => entry !== value
        );
      }
    }

    const nextDraft = { ...draft, musclePriorities: nextPriorities };
    const validation = validateMuscleStep(nextDraft, availabilityOptions);
    if (!validation.ok) {
      setInteractionError(Object.values(validation.fieldErrors)[0]);
      return;
    }

    setInteractionError("");
    onChange(nextDraft);
  }

  const saveError = Object.values(fieldErrors)[0];

  return (
    <OnboardingStepLayout
      title="Muscle focus"
      description="Choose where you want more—or less—attention."
      className="lz-onboarding-muscles"
    >
      <div className="grid gap-6">
        <div className="flex flex-wrap gap-2" aria-label="Focus assignment">
          {MODE_CONFIG.map((option) => (
            <Chip
              key={option.value}
              selected={mode === option.value}
              className={`lz-onboarding-mode-chip lz-onboarding-mode-chip--${option.tone}`}
              onClick={() => {
                setMode(option.value);
                setOpenRegionId(null);
                setInteractionError("");
              }}
              disabled={disabled}
            >
              {option.label}: {getModeCount(priorities, option.value)}/{option.limit}
            </Chip>
          ))}
        </div>

        {interactionError || saveError ? (
          <p className="lz-onboarding-error" role="alert">
            {interactionError || saveError}
          </p>
        ) : null}

        <div className="lz-onboarding-muscle-grid">
          {regions.map((region) => {
            const assignments = getRegionAssignments(priorities, region);
            const isOpen = openRegionId === region.id;
            const hasRefinements = region.options.length > 1;
            const modeConfig = MODE_CONFIG.find((item) => item.value === mode);
            const modeLabel = modeConfig.label;
            const defaultValue = region.options.some(
              (option) => option.value === region.defaultValue
            ) ? region.defaultValue : null;
            const defaultAssignment = defaultValue
              ? getAssignment(priorities, defaultValue)
              : "";
            const isDefaultAssignedInMode = defaultAssignment === modeConfig.tone;
            const activeModeAssignment = assignments.find(
              (option) => option.assignment === modeConfig.tone
            );
            const openedRegionModeKey = `${mode}:${region.id}`;
            const hasOpenedInMode = openedRegionModesRef.current.has(
              openedRegionModeKey
            );
            const willSelectDefaultOnOpen = Boolean(
              defaultValue && !activeModeAssignment && !hasOpenedInMode
            );
            const assignmentSummary = assignments
              .map((option) => `${option.label} ${option.assignment}`)
              .join(", ");

            return (
              <Fragment key={region.id}>
                <button
                  type="button"
                  className={`lz-onboarding-muscle-card ${assignments.length ? "lz-onboarding-muscle-card--selected" : ""} ${isOpen ? "lz-onboarding-muscle-card--open" : ""}`.trim()}
                  aria-label={hasRefinements || !defaultValue
                    ? `${isOpen ? "Close" : willSelectDefaultOnOpen ? "Select and open" : "Open"} ${region.label} options${assignmentSummary ? `. Selected: ${assignmentSummary}` : ""}`
                    : `${isDefaultAssignedInMode ? "Deselect" : "Select"} ${region.label} as ${modeLabel}${assignmentSummary ? `. Selected: ${assignmentSummary}` : ""}`}
                  aria-expanded={hasRefinements || !defaultValue ? isOpen : undefined}
                  aria-controls={hasRefinements || !defaultValue ? `lz-onboarding-muscle-options-${region.id}` : undefined}
                  aria-pressed={hasRefinements || !defaultValue ? undefined : isDefaultAssignedInMode}
                  onClick={() => {
                    if ((hasRefinements || !defaultValue) && isOpen) {
                      setOpenRegionId(null);
                      return;
                    }

                    if (willSelectDefaultOnOpen) {
                      selectArea(defaultValue, region.values);
                    }

                    if (hasRefinements || !defaultValue) {
                      openedRegionModesRef.current.add(openedRegionModeKey);
                      setOpenRegionId(region.id);
                    } else if (isDefaultAssignedInMode) {
                      setOpenRegionId(null);
                      selectArea(defaultValue, region.values);
                    }
                  }}
                  disabled={disabled}
                >
                  <span className="material-symbols-outlined lz-onboarding-muscle-card__icon" aria-hidden="true">
                    {region.icon}
                  </span>
                  <span className="lz-onboarding-muscle-card__title">{region.label}</span>
                  {assignments.length ? (
                    <span className="lz-onboarding-muscle-card__badges" aria-hidden="true">
                      {assignments.map((option) => (
                        <span
                          key={option.value}
                          className={`lz-onboarding-assignment lz-onboarding-assignment--${option.assignment}`}
                        >
                          {option.assignment === "main"
                            ? "Main"
                            : option.assignment === "secondary"
                              ? "Secondary"
                              : "Reduced"}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>

                {isOpen && (hasRefinements || !defaultValue) ? (
                  <section
                    ref={openPanelRef}
                    className="lz-onboarding-muscle-options lz-onboarding-muscle-options--inline"
                    id={`lz-onboarding-muscle-options-${region.id}`}
                    aria-labelledby={`lz-onboarding-muscle-options-title-${region.id}`}
                  >
                    <div>
                      <h2 id={`lz-onboarding-muscle-options-title-${region.id}`}>
                        {region.label}
                      </h2>
                      <p>
                        {defaultValue && isDefaultAssignedInMode
                          ? `${region.label} is selected as ${modeLabel.toLowerCase()}. If you want, choose a specific ${region.label} area instead.`
                          : activeModeAssignment
                            ? `${activeModeAssignment.label} is selected as ${modeLabel.toLowerCase()}. If you want, choose another ${region.label} area instead.`
                            : `Choose a ${region.label} area to assign it as ${modeLabel.toLowerCase()}.`}
                      </p>
                    </div>
                    <div className="lz-onboarding-muscle-options__grid">
                      {region.options.map((option) => {
                        const assignment = getAssignment(priorities, option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={`lz-onboarding-muscle-option ${assignment ? `lz-onboarding-muscle-option--${assignment}` : ""}`.trim()}
                            aria-pressed={Boolean(assignment)}
                            onClick={() => selectArea(option.value, region.values)}
                            disabled={disabled}
                          >
                            <span>{option.label}</span>
                            {assignment ? (
                              <span className={`lz-onboarding-assignment lz-onboarding-assignment--${assignment}`}>
                                {assignment === "main" ? "Main" : assignment === "secondary" ? "Secondary" : "Reduced"}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>
    </OnboardingStepLayout>
  );
}
