import { Outlet, useLocation } from "react-router-dom";
import BottomTabs from "../components/BottomTabs";

export default function MainLayout() {
  const location = useLocation();
  const hideTabs = location.pathname.startsWith("/train");

  return (
    <div className="min-h-screen bg-surface text-ink">
      <main className="mx-auto w-full max-w-[420px] px-4 pt-4 pb-24">
        <Outlet />
      </main>

      {!hideTabs && <BottomTabs />}
    </div>
  );
}
