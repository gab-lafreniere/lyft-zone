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

  return (
    <div className={`select-none flex items-center justify-between ${shell}`}>
      <Button
        variant="secondary"
        size="sm"
        onClick={dec}
        disabled={value <= min}
        className={`touch-manipulation ${tone === "dark" ? "bg-white/10 text-white" : ""}`}
      >
        -
      </Button>

      <div className="text-center">
        <div className={`touch-manipulation ${tone === "dark" ? "bg-white/10 text-white" : ""}`}>Par semaine</div>
        <div className={`touch-manipulation ${tone === "dark" ? "bg-white/10 text-white" : ""}`}>{value}</div>
      </div>

      <Button
        variant="secondary"
        size="sm"
        onClick={inc}
        disabled={value >= max}
        className={`touch-manipulation ${tone === "dark" ? "bg-white/10 text-white" : ""}`}
      >
        +
      </Button>
    </div>
  );
}
