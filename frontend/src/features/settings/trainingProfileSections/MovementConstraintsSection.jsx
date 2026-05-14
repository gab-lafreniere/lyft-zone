import {
  AFFECTED_AREA_OPTIONS,
  PAIN_SEVERITY_OPTIONS,
  TRAINING_RULE_OPTIONS,
} from "../settingsOptions";
import {
  CollapsibleBlock,
  Field,
  ReadonlyChipList,
  SectionBlock,
  SegmentedSelector,
  SelectableCard,
  SummaryBadgeList,
  TEXTAREA_CLASSES,
  TextListField,
  findFieldError,
  formatTokenLabel,
  setDraftField,
} from "./shared";

function buildSummaryItems(values, meta) {
  return (Array.isArray(values) ? values : []).map((value) => ({
    label: formatTokenLabel(value),
    meta,
  }));
}

export default function MovementConstraintsSection({ draft, onChange, fieldErrors }) {
  const movementConstraints = draft?.movementConstraints || {};
  const aiDetectedPatterns = Array.isArray(movementConstraints.aiDetectedPatterns)
    ? movementConstraints.aiDetectedPatterns
    : [];
  const confirmedPatterns = Array.isArray(movementConstraints.confirmedPatterns)
    ? movementConstraints.confirmedPatterns
    : [];

  const restrictedItems = [
    ...buildSummaryItems(movementConstraints.blockedMovementPatterns, "Movement"),
    ...buildSummaryItems(movementConstraints.blockedJointStressTags, "Stress"),
    ...buildSummaryItems(movementConstraints.blockedExerciseIds, "Exercise"),
  ];

  const cautionItems = [
    ...buildSummaryItems(movementConstraints.cautionMovementPatterns, "Movement"),
    ...buildSummaryItems(movementConstraints.cautionJointStressTags, "Stress"),
  ];

  const hasActiveConstraints = restrictedItems.length > 0 || cautionItems.length > 0;

  return (
    <div className="space-y-6">
      <SectionBlock
        title="Active Constraints"
        description="See exactly what the system will avoid or treat more carefully before opening advanced fields."
      >
        {hasActiveConstraints ? (
          <div className="space-y-3">
            <SummaryBadgeList title="Restricted movements" items={restrictedItems} tone="danger" />
            <SummaryBadgeList title="Caution movements" items={cautionItems} />
          </div>
        ) : (
          <SummaryBadgeList
            title="Active constraints"
            items={[]}
            emptyLabel="No active movement restrictions"
          />
        )}
      </SectionBlock>

      <SectionBlock
        title="Pain Description"
        description="Optional context in your own words. No medical interpretation is performed."
      >
        <Field error={findFieldError(fieldErrors, ["movementConstraints.painDescription"])}>
          <textarea
            rows={4}
            className={TEXTAREA_CLASSES}
            value={movementConstraints.painDescription || ""}
            onChange={(event) =>
              setDraftField(
                draft,
                onChange,
                ["movementConstraints", "painDescription"],
                event.target.value
              )
            }
            placeholder="Describe the movement or joint issue in your own words."
          />
        </Field>
      </SectionBlock>

      <SectionBlock
        title="Affected Area"
        description="Point to the main joint or region involved."
        error={findFieldError(fieldErrors, ["movementConstraints.affectedArea"])}
      >
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() =>
              setDraftField(draft, onChange, ["movementConstraints", "affectedArea"], null)
            }
            className={[
              "rounded-[18px] border px-4 py-3 text-left text-sm font-medium transition",
              !movementConstraints.affectedArea
                ? "border-primary/40 bg-primary/10 text-slate-900"
                : "border-slate-200 bg-white text-slate-600",
            ].join(" ")}
          >
            None
          </button>
          {AFFECTED_AREA_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                setDraftField(
                  draft,
                  onChange,
                  ["movementConstraints", "affectedArea"],
                  option.value
                )
              }
              className={[
                "rounded-[18px] border px-4 py-3 text-left text-sm font-medium transition",
                movementConstraints.affectedArea === option.value
                  ? "border-primary/40 bg-primary/10 text-slate-900"
                  : "border-slate-200 bg-white text-slate-600",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Pain Severity"
        description="Set the rough level of sensitivity you want the plan to respect."
        error={findFieldError(fieldErrors, ["movementConstraints.painSeverity"])}
      >
        <SegmentedSelector
          options={PAIN_SEVERITY_OPTIONS}
          value={movementConstraints.painSeverity || "none"}
          onChange={(value) =>
            setDraftField(draft, onChange, ["movementConstraints", "painSeverity"], value)
          }
        />
      </SectionBlock>

      <SectionBlock
        title="Training Rule"
        description="Choose how strict the system should be around this issue."
        error={findFieldError(fieldErrors, ["movementConstraints.trainingRule"])}
      >
        <div className="space-y-3">
          {TRAINING_RULE_OPTIONS.map((option) => (
            <SelectableCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              selected={(movementConstraints.trainingRule || "none") === option.value}
              tone={option.value === "avoid" ? "warning" : "default"}
              onClick={() =>
                setDraftField(draft, onChange, ["movementConstraints", "trainingRule"], option.value)
              }
            />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="AI Signals"
        description="These patterns are preserved in the draft, but never converted into hard blocks automatically."
      >
        <div className="space-y-4">
          <Field label="AI Detected Patterns">
            <ReadonlyChipList
              values={aiDetectedPatterns}
              labelMap={{}}
              emptyLabel="None"
              tagLabel="Detected"
            />
          </Field>

          <Field label="Confirmed Patterns">
            <ReadonlyChipList
              values={confirmedPatterns}
              labelMap={{}}
              emptyLabel="None"
              tone="strong"
              tagLabel="Confirmed"
            />
          </Field>
        </div>
      </SectionBlock>

      <CollapsibleBlock
        title="Advanced signals"
        description="Editable technical fields for explicit cautions and hard blocks."
        defaultOpen={false}
      >
        <div className="space-y-5">
          <TextListField
            label="Caution Movement Patterns"
            hint="Soft signal only. One entry per line."
            error={findFieldError(fieldErrors, ["movementConstraints.cautionMovementPatterns"])}
            value={movementConstraints.cautionMovementPatterns || []}
            onChange={(value) =>
              setDraftField(
                draft,
                onChange,
                ["movementConstraints", "cautionMovementPatterns"],
                value
              )
            }
            placeholder={"horizontal_press\nvertical_push"}
          />

          <TextListField
            label="Blocked Movement Patterns"
            hint="Explicit hard blocks only. One entry per line."
            error={findFieldError(fieldErrors, ["movementConstraints.blockedMovementPatterns"])}
            value={movementConstraints.blockedMovementPatterns || []}
            onChange={(value) =>
              setDraftField(
                draft,
                onChange,
                ["movementConstraints", "blockedMovementPatterns"],
                value
              )
            }
            placeholder={"vertical_push"}
          />

          <TextListField
            label="Caution Joint Stress Tags"
            hint="Soft signal only. One tag per line."
            error={findFieldError(fieldErrors, ["movementConstraints.cautionJointStressTags"])}
            value={movementConstraints.cautionJointStressTags || []}
            onChange={(value) =>
              setDraftField(
                draft,
                onChange,
                ["movementConstraints", "cautionJointStressTags"],
                value
              )
            }
            placeholder={"shoulder_rotation"}
          />

          <TextListField
            label="Blocked Joint Stress Tags"
            hint="Explicit hard blocks only. One tag per line."
            error={findFieldError(fieldErrors, ["movementConstraints.blockedJointStressTags"])}
            value={movementConstraints.blockedJointStressTags || []}
            onChange={(value) =>
              setDraftField(
                draft,
                onChange,
                ["movementConstraints", "blockedJointStressTags"],
                value
              )
            }
            placeholder={"shoulder_compression"}
          />

          <TextListField
            label="Blocked Exercise IDs"
            hint="Most precise hard blocks. One exercise ID per line."
            error={findFieldError(fieldErrors, ["movementConstraints.blockedExerciseIds"])}
            value={movementConstraints.blockedExerciseIds || []}
            onChange={(value) =>
              setDraftField(
                draft,
                onChange,
                ["movementConstraints", "blockedExerciseIds"],
                value
              )
            }
            placeholder={"ex_barbell_press"}
          />
        </div>
      </CollapsibleBlock>
    </div>
  );
}
