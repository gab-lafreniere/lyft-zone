import { Outlet, useLocation } from "react-router-dom";
import BottomTabs from "../components/BottomTabs";

export default function MainLayout() {
  const location = useLocation();
  const isCycleBuilderRoute = /^\/program\/cycles\/[^/]+\/builder(?:\/|$)/.test(
    location.pathname
  );
  const hideTabs =
    location.pathname.startsWith("/train") ||
    location.pathname.startsWith("/program/manual") ||
    isCycleBuilderRoute;

  return (
    <div className="min-h-[100dvh] bg-surface text-ink flex flex-col">
      <main className="flex-1 min-h-0 px-6">
        <Outlet />
      </main>

      {!hideTabs && <BottomTabs />}
    </div>
  );
}
