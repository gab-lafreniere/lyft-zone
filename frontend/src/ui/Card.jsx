import { cn } from "./cn";

export default function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white shadow-soft border border-black/5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
