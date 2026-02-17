import { NavLink } from "react-router-dom";

function Tab({ to, label, icon }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium",
          isActive
            ? "bg-accent/10 text-ink"
            : "text-ink/60 active:bg-black/5",
        ].join(" ")
      }
    >
      <div className="text-[18px] leading-none">{icon}</div>
      <div className="leading-none">{label}</div>
    </NavLink>
  );
}

export default function BottomTabs() {
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white/80 backdrop-blur">
      <div className="mx-auto grid w-full max-w-[420px] grid-cols-5 gap-2 px-3 pt-2 pb-4">
        <Tab to="/" label="Home" icon="🏠" />
        <Tab to="/program" label="Program" icon="🗓️" />
        <Tab to="/train" label="Train" icon="🏋️" />
        <Tab to="/progress" label="Progress" icon="📈" />
        <Tab to="/ai" label="AI" icon="✨" />
      </div>
    </nav>
  );
}
