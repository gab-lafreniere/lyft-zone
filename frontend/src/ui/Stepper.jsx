import Button from "./Button";

export default function Stepper({ value, min = 0, max = 10, onChange, tone = "dark" }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  const shell =
    tone === "dark"
      ? "rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
      : "rounded-2xl border border-black/10 bg-white px-3 py-2";

  const labelTone = tone === "dark" ? "text-white/60" : "text-ink/60";
  const valueTone = tone === "dark" ? "text-white" : "text-ink";
  const btnTone = tone === "dark" ? "bg-white/10 text-white touch-manipulation" : "touch-manipulation";

  return (
    <div className={`select-none flex items-center justify-between ${shell}`}>
      <Button variant="secondary" size="sm" onClick={dec} disabled={value <= min} className={btnTone}>
        -
      </Button>

      <div className="text-center">
        <div className={`text-xs font-semibold ${labelTone}`}>Par semaine</div>
        <div className={`text-xl font-semibold ${valueTone}`}>{value}</div>
      </div>

      <Button variant="secondary" size="sm" onClick={inc} disabled={value >= max} className={btnTone}>
        +
      </Button>
    </div>
  );
}
