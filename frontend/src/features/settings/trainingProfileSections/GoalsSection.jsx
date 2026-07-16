import { useMemo, useState } from "react";
import {
  AREA_LABELS,
  DEPRIORITIZED_AREA_GROUPS,
  MUSCLE_PRIORITY_GROUPS,
  PRIMARY_GOAL_OPTIONS,
} from "../settingsOptions";
import {
  ChipSelector,
  SectionBlock,
  SelectableCard,
  SelectorTrigger,
  findFieldError,
  setDraftField,
} from "./shared";

export default function GoalsSection({ draft, onChange, fieldErrors }) {
  const [openSelector, setOpenSelector] = useState(null);
  const currentDraft = draft || {};
  const primaryFocus = currentDraft?.musclePriorities?.primaryFocus || "";
  const secondaryFocuses = useMemo(
    () =>
      Array.isArray(currentDraft?.musclePriorities?.secondaryFocuses)
        ? currentDraft.musclePriorities.secondaryFocuses
        : [],
    [currentDraft?.musclePriorities?.secondaryFocuses]
  );
  const deprioritizedArea = currentDraft?.musclePriorities?.deprioritizedArea || "";

  const secondaryFocusOptions = useMemo(
    () =>
      MUSCLE_PRIORITY_GROUPS.map((group) => ({
        ...group,
        options: group.options.filter(
          (option) =>
            secondaryFocuses.includes(option.value) ||
            (option.value !== primaryFocus && option.value !== deprioritizedArea)
        ),
      })).filter((group) => group.options.length > 0),
    [deprioritizedArea, primaryFocus, secondaryFocuses]
  );

  function handlePrimaryFocusSelect(nextValue) {
    setDraftField(draft, onChange, ["musclePriorities", "primaryFocus"], nextValue || null);
    setOpenSelector(null);
  }

  function handleDeprioritizedAreaSelect(nextValue) {
    setDraftField(
      draft,
      onChange,
      ["musclePriorities", "deprioritizedArea"],
      nextValue || null
    );
    setOpenSelector(null);
  }

  function toggleSecondaryFocus(value) {
    const isSelected = secondaryFocuses.includes(value);

    if (isSelected) {
      setDraftField(
        draft,
        onChange,
        ["musclePriorities", "secondaryFocuses"],
        secondaryFocuses.filter((entry) => entry !== value)
      );
      return;
    }

    if (secondaryFocuses.length >= 2) {
      return;
    }

    setDraftField(draft, onChange, ["musclePriorities", "secondaryFocuses"], [
      ...secondaryFocuses,
      value,
    ]);
  }

  return (
    <div className="space-y-6">
      <SectionBlock
        title="Primary Goal"
        description="Choose what you want to prioritize visually."
        error={findFieldError(fieldErrors, ["primaryGoal"])}
      >
        <div className="space-y-3">
          {PRIMARY_GOAL_OPTIONS.map((option) => (
            <SelectableCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              selected={currentDraft?.primaryGoal === option.value}
              disabled={option.disabled}
              onClick={() => setDraftField(draft, onChange, ["primaryGoal"], option.value)}
            />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Muscle Priorities"
        description="Guide the system toward the areas you most want to bring up."
      >
        <SelectorTrigger
          label="Primary focus"
          valueLabel={AREA_LABELS[primaryFocus] || ""}
          placeholder="Choose one area to prioritize most"
          onClick={() =>
            setOpenSelector((currentValue) =>
              currentValue === "primary" ? null : "primary"
            )
          }
          error={findFieldError(fieldErrors, ["musclePriorities.primaryFocus"])}
        />

        {openSelector === "primary" ? (
          <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-3">
            <ChipSelector
              grouped
              options={MUSCLE_PRIORITY_GROUPS}
              selectedValues={primaryFocus ? [primaryFocus] : []}
              onToggle={handlePrimaryFocusSelect}
            />
          </div>
        ) : null}

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            Secondary focuses
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Add up to two supporting areas you also want to emphasize.
          </p>
          <div className="mt-3">
            <ChipSelector
              grouped
              options={secondaryFocusOptions}
              selectedValues={secondaryFocuses}
              onToggle={toggleSecondaryFocus}
              maxSelected={2}
            />
          </div>
          {findFieldError(fieldErrors, ["musclePriorities.secondaryFocuses"]) ? (
            <p className="mt-2 text-sm font-medium text-red-500">
              {findFieldError(fieldErrors, ["musclePriorities.secondaryFocuses"])}
            </p>
          ) : null}
        </div>

        <SelectorTrigger
          label="Deprioritized area"
          valueLabel={AREA_LABELS[deprioritizedArea] || ""}
          placeholder="Optional area to deprioritize"
          onClick={() =>
            setOpenSelector((currentValue) =>
              currentValue === "deprioritized" ? null : "deprioritized"
            )
          }
          error={findFieldError(fieldErrors, ["musclePriorities.deprioritizedArea"])}
        />

        {openSelector === "deprioritized" ? (
          <div className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50 p-3">
            <button
              type="button"
              onClick={() => handleDeprioritizedAreaSelect(null)}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition"
            >
              None
            </button>
            <ChipSelector
              grouped
              options={DEPRIORITIZED_AREA_GROUPS}
              selectedValues={deprioritizedArea ? [deprioritizedArea] : []}
              onToggle={handleDeprioritizedAreaSelect}
            />
          </div>
        ) : null}
      </SectionBlock>
    </div>
  );
}
