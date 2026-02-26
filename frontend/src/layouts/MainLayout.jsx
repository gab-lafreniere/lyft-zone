import { Outlet, useLocation } from "react-router-dom";
import BottomTabs from "../components/BottomTabs";

export default function MainLayout() {
  const location = useLocation();
  const hideTabs = location.pathname.startsWith("/train");

  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <main
        className={[
          "mx-auto w-full max-w-[420px] px-6 pt-3 bg-surface",
          hideTabs ? "pb-6" : "pb-20",
        ].join(" ")}
      >
        <Outlet />
      </main>

      {!hideTabs && <BottomTabs />}
    </div>
  );
}