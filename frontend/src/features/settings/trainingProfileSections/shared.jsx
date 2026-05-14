import { cn } from "../../../ui/cn";
import SectionBlock from "../SectionBlock";
import SelectableCard from "../SelectableCard";
import ChipSelector from "../ChipSelector";
import SegmentedSelector from "../SegmentedSelector";
import InlineStepper from "../InlineStepper";
import CollapsibleBlock from "../CollapsibleBlock";
import SummaryBadgeList from "../SummaryBadgeList";
import { findFieldError, fromTextList, toTextList } from "../settingsMappers";

export const INPUT_CLASSES =
  "mt-2 h-12 w-full rounded-[18px] border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15";

export const TEXTAREA_CLASSES =
  "mt-2 w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15";

function updateNestedValue(target, path, value) {
  let current = target;

  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];

    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  }

  current[path[path.length - 1]] = value;
}

export function applyDraftUpdate(currentDraft, onChange, producer) {
  const nextDraft = JSON.parse(JSON.stringify(currentDraft || {}));
  producer(nextDraft);
  onChange(nextDraft);
}

export function setDraftField(currentDraft, onChange, path, value) {
  applyDraftUpdate(currentDraft, onChange, (nextDraft) => {
    updateNestedValue(nextDraft, path, value);
  });
}

export function Field({ label, hint, error, children }) {
  return (
    <div>
      {label ? (
        <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </label>
      ) : null}
      {hint ? <p className="mt-1 text-sm leading-relaxed text-slate-500">{hint}</p> : null}
      {children}
      {error ? <p className="mt-2 text-sm font-medium text-red-500">{error}</p> : null}
    </div>
  );
}

export function CharacterCount({ current, limit }) {
  const isOverLimit = current > limit;

  return (
    <p className={cn("mt-2 text-right text-xs font-medium", isOverLimit ? "text-red-500" : "text-slate-400")}>
      {current}/{limit}
    </p>
  );
}

export function ReadonlyChipList({
  values,
  labelMap,
  emptyLabel = "None",
  tone = "neutral",
  tagLabel,
}) {
  if (!Array.isArray(values) || values.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold",
            tone === "strong"
              ? "border-primary/35 bg-primary/10 text-slate-900"
              : "border-slate-200 bg-slate-50 text-slate-600"
          )}
        >
          <span>{labelMap[value] || value}</span>
          {tagLabel ? (
            <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">
              {tagLabel}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function TextListField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea
        rows={4}
        className={TEXTAREA_CLASSES}
        value={toTextList(value)}
        onChange={(event) => onChange(fromTextList(event.target.value))}
        placeholder={placeholder}
      />
    </Field>
  );
}

export function SelectorTrigger({
  label,
  valueLabel,
  placeholder,
  onClick,
  error,
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-left transition"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className={cn("mt-1 text-sm font-medium", valueLabel ? "text-slate-900" : "text-slate-500")}>
            {valueLabel || placeholder}
          </p>
        </div>
        <span className="material-symbols-outlined text-slate-400">expand_more</span>
      </button>
      {error ? <p className="mt-2 text-sm font-medium text-red-500">{error}</p> : null}
    </div>
  );
}

export function formatTokenLabel(value) {
  return String(value || "")
    .replace(/^ex_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

export {
  ChipSelector,
  CollapsibleBlock,
  InlineStepper,
  SectionBlock,
  SegmentedSelector,
  SelectableCard,
  SummaryBadgeList,
  findFieldError,
};
