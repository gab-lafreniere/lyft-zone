import { cn } from "./cn";

const variants = {
  primary:
    "bg-accent text-white shadow-soft active:opacity-90 disabled:opacity-50",
  secondary:
    "bg-black/5 text-ink active:bg-black/10 disabled:opacity-50",
  ghost:
    "bg-transparent text-ink/70 hover:text-ink active:bg-black/5 disabled:opacity-50",
};

const sizes = {
  md: "h-11 px-4 text-sm rounded-2xl",
  sm: "h-9 px-3 text-sm rounded-xl",
  lg: "h-12 px-5 text-sm rounded-2xl",
};

export default function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}
