import Card from "../../ui/Card";
import Chip from "../../ui/Chip";
import { ENVIRONMENTS, EQUIPMENT } from "./wizardData";
import { ENVIRONMENTS, EQUIPMENT, EQUIPMENT_PRESETS } from "./wizardData";

const chooseEnv = (envId) => {
  if (!data.equipmentTouched) {
    set({ environment: envId, equipment: EQUIPMENT_PRESETS[envId] || [] });
  } else {
    set({ environment: envId });
  }
};

function toggle(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function StepEquipment({ data, set }) {
  return (
    <div className="space-y-4">
      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Environnement</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {ENVIRONMENTS.map((e) => (
              <button
                key={e.id}
                onClick={() => set({ environment: e.id })}
                className={[
                  "rounded-2xl border px-3 py-3 text-left transition",
                  data.environment === e.id
                    ? "border-accent/40 bg-accent/15"
                    : "border-white/10 bg-white/5 active:bg-white/10",
                ].join(" ")}
              >
                <div className="text-xl">{e.icon}</div>
                <div className="mt-1 text-sm font-semibold">{e.label}</div>
              </button>
            ))}
          </div>
          {!data.environment && (
            <div className="mt-3 text-xs font-semibold text-white/60">
              Choisis un environnement pour continuer.
            </div>
          )}
        </div>
      </Card>

      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Équipements disponibles</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EQUIPMENT.map((it) => (
              <Chip
                key={it.id}
                selected={data.equipment.includes(it.id)}
                onClick={() => set({ equipment: toggle(data.equipment, it.id) })}
                className="bg-white/5 border-white/10 text-white/80"
              >
                {it.label}
              </Chip>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
