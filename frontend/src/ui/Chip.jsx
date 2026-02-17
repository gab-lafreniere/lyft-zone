import { cn } from "./cn";

export default function Chip({ selected, tone = "dark", className, children, ...props }) {
  const base =
    "inline-flex items-center justify-center rounded-2xl px-3 py-2 text-sm font-semibold transition border";

  const styles =
    tone === "dark"
      ? selected
        ? "bg-accent/20 border-accent/40 text-white"
        : "bg-white/5 border-white/10 text-white/70 active:bg-white/10"
      : selected
        ? "bg-accent/12 border-accent/30 text-ink"
        : "bg-white border-black/10 text-ink/70 active:bg-black/5";

  return (
    <button className={cn(base, styles, className)} {...props}>
      {children}
    </button>
  );
}
