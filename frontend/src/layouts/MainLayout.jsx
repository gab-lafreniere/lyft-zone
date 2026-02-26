import { Outlet, useLocation } from "react-router-dom";
import BottomTabs from "../components/BottomTabs";

export default function MainLayout() {
  const location = useLocation();
  const hideTabs = location.pathname.startsWith("/train");

  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <main className="flex-1 px-6 space-y-2.5 overflow-y-auto hide-scrollbar">
        <Outlet />
      </main>

      {!hideTabs && <BottomTabs />}
    </div>
  );
}