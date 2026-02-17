import { cn } from "./cn";

export default function Chip({ selected, className, children, ...props }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-2xl px-3 py-2 text-sm font-semibold transition border",
        selected
          ? "bg-accent/12 border-accent/30 text-ink"
          : "bg-white border-black/10 text-ink/70 active:bg-black/5",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
