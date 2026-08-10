import { useId, useState } from "react";
import { buildCompactSummaryText } from "./profileSummary";

export default function ProfileSummaryPanel({ items }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const compactSummary = buildCompactSummaryText(items);

  if (!items.length) {
    return null;
  }

  return (
    <section className={`lz-onboarding-sticky-summary${expanded ? " lz-onboarding-sticky-summary--expanded" : ""}`}>
      <button
        type="button"
        className="lz-onboarding-sticky-summary__toggle"
        aria-label={expanded ? "Collapse profile summary" : "Expand profile summary"}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>
          <span className="lz-onboarding-sticky-summary__label">Profile summary</span>
          <span className="lz-onboarding-sticky-summary__compact">{compactSummary}</span>
        </span>
        <span className="lz-onboarding-sticky-summary__chevron" aria-hidden="true">⌃</span>
      </button>

      <div
        className="lz-onboarding-sticky-summary__panel"
        id={panelId}
        role="region"
        aria-label="Full profile summary"
        aria-hidden={!expanded}
      >
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <span className={`lz-onboarding-summary__icon lz-onboarding-summary__icon--${item.tone || "neutral"}`} aria-hidden="true">
                <span className="material-symbols-outlined">{item.icon}</span>
              </span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
