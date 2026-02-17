import Card from "../../ui/Card";
import { GOALS, ENVIRONMENTS, EQUIPMENT, AVOID, SENSITIVE_AREAS } from "./wizardData";

function labelFrom(list, id) {
  return list.find((x) => x.id === id)?.label || id || "Non défini";
}

export default function StepSummary({ data }) {
  return (
    <div className="space-y-4">
      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Résumé</div>

          <div className="mt-3 space-y-3">
            <div className="rounded-2xl bg-white/5 p-3">
              <div className="text-[11px] font-semibold text-white/60">Objectif</div>
              <div className="text-sm font-semibold">{labelFrom(GOALS, data.goal)}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/5 p-3">
                <div className="text-[11px] font-semibold text-white/60">Cycle</div>
                <div className="text-sm font-semibold">{data.cycleWeeks} semaines</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-3">
                <div className="text-[11px] font-semibold text-white/60">Mode</div>
                <div className="text-sm font-semibold">
                  {data.coachMode === "ai" ? "Coach IA" : "Plan fixe"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/5 p-3">
                <div className="text-[11px] font-semibold text-white/60">Séances</div>
                <div className="text-sm font-semibold">{data.sessionsPerWeek} par semaine</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-3">
                <div className="text-[11px] font-semibold text-white/60">Durée</div>
                <div className="text-sm font-semibold">{data.minutesPerSession} min</div>
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 p-3">
              <div className="text-[11px] font-semibold text-white/60">Environnement</div>
              <div className="text-sm font-semibold">{labelFrom(ENVIRONMENTS, data.environment)}</div>
            </div>

            <div className="rounded-2xl bg-white/5 p-3">
              <div className="text-[11px] font-semibold text-white/60">Équipement</div>
              <div className="mt-1 text-sm font-semibold">
                {data.equipment.length ? data.equipment.map((id) => labelFrom(EQUIPMENT, id)).join(", ") : "Aucun"}
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 p-3">
              <div className="text-[11px] font-semibold text-white/60">À éviter</div>
              <div className="mt-1 text-sm font-semibold">
                {data.avoid.length ? data.avoid.map((id) => labelFrom(AVOID, id)).join(", ") : "Rien"}
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 p-3">
              <div className="text-[11px] font-semibold text-white/60">Zones sensibles</div>
              <div className="mt-1 text-sm font-semibold">
                {data.sensitiveAreas.length
                  ? data.sensitiveAreas.map((id) => labelFrom(SENSITIVE_AREAS, id)).join(", ")
                  : "Aucune"}
              </div>
            </div>

            {data.otherNote?.trim() && (
              <div className="rounded-2xl bg-white/5 p-3">
                <div className="text-[11px] font-semibold text-white/60">Notes</div>
                <div className="mt-1 text-sm font-semibold">{data.otherNote.trim()}</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="bg-white/10 border-white/10">
        <div className="p-4 text-xs font-semibold text-white/70">
          En appuyant sur Générer, on crée un cycle et on planifie les séances. Plus tard, on branchera ça sur ton endpoint backend.
        </div>
      </Card>
    </div>
  );
}
