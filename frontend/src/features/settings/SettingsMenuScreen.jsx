import SettingsMenuGroup from "./SettingsMenuGroup";
import SettingsMenuRow from "./SettingsMenuRow";

export default function SettingsMenuScreen({
  eyebrow,
  title,
  description,
  showTitle = true,
  groups,
  items,
  itemStateMap = {},
  onSelect,
  showIcons = true,
}) {
  return (
    <div className="space-y-5">
      {showTitle ? (
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h2 className="mt-2 text-[1.9rem] font-black tracking-tight text-slate-900">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
      ) : description ? (
        <p className="max-w-xl text-sm leading-relaxed text-slate-500">{description}</p>
      ) : null}

      {Array.isArray(groups) && groups.length > 0 ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <SettingsMenuGroup
              key={group.label}
              label={group.label}
              items={group.items}
              itemStateMap={itemStateMap}
              onSelect={onSelect}
              showIcons={showIcons}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map((item, index) => {
            const state = itemStateMap[item.id] || {};

            return (
              <SettingsMenuRow
                key={item.id}
                label={item.label}
                description={item.menuDescription ?? item.description}
                icon={item.icon}
                showIcon={showIcons}
                badge={state.badge}
                meta={state.meta}
                showSeparator={index > 0}
                onClick={() => onSelect(item)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
