import { NavLink } from "react-router-dom";

const base =
  "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600";
const active = "text-primary";

function Tab({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `${base} ${isActive ? active : ""}`}
      end={to === "/"}
    >
      <span className="material-symbols-outlined text-[28px]">{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-widest">
        {label}
      </span>
    </NavLink>
  );
}

export default function BottomTabs() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-t border-slate-100 px-5 py-2">
      <div className="mx-auto w-full max-w-[420px] flex items-center justify-between">
        <Tab to="/" icon="home" label="Home" />
        <Tab to="/program" icon="description" label="Program" />
        <Tab to="/progress" icon="bar_chart" label="Insights" />
        <Tab to="/coach" icon="person" label="Coach" />
      </div>
    </nav>
  );
}