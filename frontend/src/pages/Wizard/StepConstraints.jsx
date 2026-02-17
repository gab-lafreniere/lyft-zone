import Card from "../../ui/Card";
import Chip from "../../ui/Chip";
import { AVOID, SENSITIVE_AREAS } from "./wizardData";

function toggle(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function StepConstraints({ data, set }) {
  return (
    <div className="space-y-4">
      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Exercices à éviter</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {AVOID.map((it) => (
              <Chip
                key={it.id}
                selected={data.avoid.includes(it.id)}
                onClick={() => set({ avoid: toggle(data.avoid, it.id) })}
                className="bg-white/5 border-white/10 text-white/80"
              >
                {it.label}
              </Chip>
            ))}
          </div>
        </div>
      </Card>

      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Zones sensibles</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {SENSITIVE_AREAS.map((z) => {
              const selected = data.sensitiveAreas.includes(z.id);
              return (
                <button
                  key={z.id}
                  onClick={() => set({ sensitiveAreas: toggle(data.sensitiveAreas, z.id) })}
                  className={[
                    "flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                    selected
                      ? "border-accent/40 bg-accent/15"
                      : "border-white/10 bg-white/5 active:bg-white/10",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold">{z.label}</div>
                  <div className="text-lg">{z.icon}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <label className="text-xs font-semibold text-white/60">Détails optionnels</label>
            <textarea
              value={data.otherNote}
              onChange={(e) => set({ otherNote: e.target.value })}
              placeholder="Ex: douleur épaule droite, éviter overhead lourd"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/85 placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-accent/40"
              rows={3}
            />
          </div>
        </div>
      </Card>

      <Card className="bg-white/10 border-white/10">
        <div className="p-4 text-xs font-semibold text-white/70">
          Le programme s’adapte à ces contraintes. Aucun calcul mental pendant l’entraînement.
        </div>
      </Card>
    </div>
  );
}
