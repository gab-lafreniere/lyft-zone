import Card from "../../ui/Card";
import Stepper from "../../ui/Stepper";
import Slider from "../../ui/Slider";

export default function StepAvailability({ data, set }) {
  return (
    <div className="space-y-4">
      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Séances par semaine</div>
          <div className="mt-3">
            <Stepper
              value={data.sessionsPerWeek}
              min={2}
              max={6}
              onChange={(v) => set({ sessionsPerWeek: v })}
            />
          </div>
        </div>
      </Card>

      <Card className="bg-white/10 border-white/10">
        <div className="p-4">
          <div className="text-sm font-semibold">Durée par séance</div>
          <div className="mt-3">
            <Slider
              value={data.minutesPerSession}
              min={30}
              max={90}
              step={5}
              onChange={(v) => set({ minutesPerSession: v })}
            />
          </div>
          <div className="mt-3 rounded-2xl bg-white/5 p-3 text-xs font-semibold text-white/70">
            Total semaine: {data.sessionsPerWeek * data.minutesPerSession} min
          </div>
        </div>
      </Card>
    </div>
  );
}
