import { useMemo, useState } from "react";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Chip from "../../ui/Chip";
import { PROGRAM_WEEKS, COACH_MODE, GOALS, MUSCLE_PRIORITIES } from "./wizardData";


const PRIORITY_LABELS = Object.fromEntries(
  MUSCLE_PRIORITIES.flatMap((sec) => sec.items.map((it) => [it.id, it.label]))
);


function toggleMax2(list, id) {
    if (list.includes(id)) return list.filter((x) => x !== id);
    if (list.length >= 2) return list;
    return [...list, id];
}
  


export default function StepGoal({ data, set }) {
  const [openMuscles, setOpenMuscles] = useState(false);

  const selectedCount = useMemo(() => data.musclePriorities.length, [data.musclePriorities]);

  return (
    <div className="space-y-4">
      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Objectif principal</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {GOALS.map((g) => (
              <button
                key={g.id}
                onClick={() => set({ goal: g.id })}
                className={[
                  "rounded-2xl border px-3 py-3 text-left transition",
                  data.goal === g.id
                    ? "border-accent/40 bg-accent/15"
                    : "border-white/10 bg-white/5 active:bg-white/10",
                ].join(" ")}
              >
                <div className="text-xl">{g.icon}</div>
                <div className="mt-1 text-sm font-semibold">{g.label}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Card className="bg-white/10 border-white/10">
          <div className="p-4">
            <div className="text-sm font-semibold">Durée du programme</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PROGRAM_WEEKS.map((w) => (
                <Chip
                  key={w.id}
                  tone="dark"
                  selected={data.programWeeks === w.id}
                  onClick={() => set({ programWeeks: w.id })}
                  className="bg-white/5 border-white/10 text-white/80"
                >
                  {w.label}
                </Chip>
              ))}
            </div>
          </div>
        </Card>

        <Card className="bg-white/10 border-white/10">
          <div className="p-4">
            <div className="text-sm font-semibold">Mode</div>
            <div className="mt-3 space-y-2">
              {COACH_MODE.map((m) => (
                <button
                  key={m.id}
                  onClick={() => set({ coachMode: m.id })}
                  className={[
                    "w-full rounded-2xl border px-3 py-2 text-left transition",
                    data.coachMode === m.id
                      ? "border-accent/40 bg-accent/15"
                      : "border-white/10 bg-white/5 active:bg-white/10",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold">{m.label}</div>
                  <div className="text-[11px] text-white/60">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Priorités musculaires</div>
              <div className="mt-1 text-xs text-white/60">
                Optionnel. Aide à orienter le focus du plan d'entraînement.
              </div>
            </div>

            <Button
              variant="secondary"
              className="bg-white/10 text-white"
              size="sm"
              onClick={() => setOpenMuscles(true)}
            >
              Choisir
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {data.musclePriorities.slice(0, 4).map((id) => (
              <span
                key={id}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80"
              >
                {PRIORITY_LABELS[id] || id}
              </span>
            ))}
            {selectedCount > 4 && (
              <span className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60">
                +{selectedCount - 4}
              </span>
            )}
            {selectedCount === 0 && (
              <span className="text-xs font-semibold text-white/50">
                Aucune priorité sélectionnée
              </span>
            )}
          </div>
        </div>
      </Card>

      {openMuscles && (
        <div className="fixed inset-0 z-50">
          <button
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpenMuscles(false)}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[420px] rounded-t-3xl border border-white/10 bg-[#0b0f1a] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Priorités musculaires</div>
                <div className="text-xs text-white/60">Multi sélection</div>
              </div>
              <Button
                variant="secondary"
                className="bg-white/10 text-white"
                size="sm"
                onClick={() => setOpenMuscles(false)}
              >
                Fermer
              </Button>
            </div>

            <div className="mt-4 max-h-[55vh] space-y-4 overflow-auto pr-1">
              {MUSCLE_PRIORITIES.map((sec) => (
                <div key={sec.group}>
                  <div className="text-xs font-semibold text-white/60">{sec.group}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sec.items.map((it) => (
                      <Chip
                        key={it.id}
                        tone="dark"
                        selected={data.musclePriorities.includes(it.id)}
                        onClick={() =>
                          set({ musclePriorities: toggleMax2(data.musclePriorities, it.id) })
                        }
                        className="bg-white/5 border-white/10 text-white/80"
                      >
                        {it.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <Button className="w-full" onClick={() => setOpenMuscles(false)}>
                OK ({selectedCount} sélectionnés)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
