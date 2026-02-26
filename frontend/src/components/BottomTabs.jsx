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
    <nav className="bg-white/80 backdrop-blur-md border-t border-slate-100 px-6 flex items-center justify-between py-2 pb-6">
      <Tab to="/" icon="home" label="Home" />
      <Tab to="/program" icon="description" label="Program" />
      <Tab to="/progress" icon="bar_chart" label="Insights" />
      <Tab to="/coach" icon="person" label="Coach" />
    </nav>
  );
}