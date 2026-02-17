export default function Slider({ value, min, max, step = 5, onChange }) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white px-3 py-3">
        <input
          className="w-full accent-[color:var(--tw-prose-bold)]"
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
  
        <div className="mt-2 flex justify-between text-xs font-semibold text-ink/60">
          <span>{min} min</span>
          <span className="text-ink">{value} min</span>
          <span>{max} min</span>
        </div>
      </div>
    );
  }
  