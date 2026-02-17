import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../../ui/Button";
import Card from "../../ui/Card";

import StepGoal from "./StepGoal";
import StepAvailability from "./StepAvailability";
import StepEquipment from "./StepEquipment";
import StepConstraints from "./StepConstraints";
import StepSummary from "./StepSummary";

const steps = [
  { id: "goal", label: "Objectif" },
  { id: "availability", label: "Disponibilités" },
  { id: "equipment", label: "Équipement" },
  { id: "constraints", label: "Contraintes" },
  { id: "summary", label: "Résumé" },
];

const initial = {
  goal: null,
  coachMode: "ai",
  programWeeks: 8,

  sessionsPerWeek: 4,
  minutesPerSession: 60,

  environment: null,
  equipment: [],
  equipmentTouched: false,


  avoid: [],
  sensitiveAreas: [],
  otherNote: "",

  musclePriorities: [],
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default function Wizard() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setData] = useState(initial);

  const step = steps[stepIndex];
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  const canNext = useMemo(() => {
    if (step.id === "goal") return Boolean(data.goal) && Boolean(data.environment) === false ? true : true;
    if (step.id === "equipment") return Boolean(data.environment);
    return true;
  }, [step.id, data.goal, data.environment]);

  const next = () => setStepIndex((s) => clamp(s + 1, 0, steps.length - 1));
  const back = () => {
    if (stepIndex === 0) navigate(-1);
    else setStepIndex((s) => clamp(s - 1, 0, steps.length - 1));
  };

  const set = (patch) => setData((prev) => ({ ...prev, ...patch }));

  const onGenerate = () => {
    console.log("WIZARD_PAYLOAD", data);
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      <div className="mx-auto w-full max-w-[420px] px-4 pt-6 pb-28">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold text-white/60">
              Step {stepIndex + 1} sur {steps.length}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Créer ton programme d’entraînement</h1>
            <p className="mt-1 text-sm text-white/70">{step.label}</p>
          </div>

          <button
            onClick={() => navigate(-1)}
            className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 active:bg-white/15"
          >
            Quitter
          </button>
        </div>

        <div className="mt-4 h-1.5 w-full rounded-full bg-white/10">
          <div
            className="h-1.5 rounded-full bg-accent"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-5 space-y-4">
          {step.id === "goal" && <StepGoal data={data} set={set} />}
          {step.id === "availability" && <StepAvailability data={data} set={set} />}
          {step.id === "equipment" && <StepEquipment data={data} set={set} />}
          {step.id === "constraints" && <StepConstraints data={data} set={set} />}
          {step.id === "summary" && <StepSummary data={data} />}
        </div>

        <Card className="mt-6 bg-white/10 border-white/10">
          <div className="p-4">
            <div className="text-xs font-semibold text-white/60">Aperçu</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/10 p-3">
                <div className="text-[11px] font-semibold text-white/60">Durée du programme</div>
                <div className="text-sm font-semibold">{data.programWeeks} semaines</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <div className="text-[11px] font-semibold text-white/60">Mode</div>
                <div className="text-sm font-semibold">
                  {data.coachMode === "ai" ? "Coach IA" : "Plan fixe"}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0b0f1a]/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[420px] gap-2 px-4 pt-3 pb-5">
          <Button variant="secondary" className="flex-1 bg-white/10 text-white" onClick={back}>
            Retour
          </Button>

          {step.id !== "summary" ? (
            <Button className="flex-1" onClick={next} disabled={!canNext}>
              Continuer
            </Button>
          ) : (
            <Button className="flex-1" onClick={onGenerate}>
              Générer mon programme
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
