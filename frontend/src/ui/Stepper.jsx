import Button from "./Button";

export default function Stepper({ value, min = 0, max = 10, onChange }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-3 py-2">
      <Button variant="secondary" size="sm" onClick={dec} disabled={value <= min}>
        -
      </Button>

      <div className="text-center">
        <div className="text-xs font-semibold text-ink/60">Per week</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>

      <Button variant="secondary" size="sm" onClick={inc} disabled={value >= max}>
        +
      </Button>
    </div>
  );
}
