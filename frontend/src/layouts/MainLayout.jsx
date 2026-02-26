import { Outlet, useLocation } from "react-router-dom";
import BottomTabs from "../components/BottomTabs";

export default function MainLayout() {
  const location = useLocation();
  const hideTabs = location.pathname.startsWith("/train");

  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <main
        className={[
          "mx-auto w-full max-w-[420px] px-4 pt-4",
          hideTabs
            ? "pb-4"
            : "pb-[calc(96px+env(safe-area-inset-bottom))]",
        ].join(" ")}
      >
        <Outlet />
      </main>

      {!hideTabs && <BottomTabs />}
    </div>
  );
}