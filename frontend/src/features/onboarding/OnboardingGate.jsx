import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Button, DesignV2Scope, MobilePage } from "../../design-v2";
import { getUserSettings } from "../../services/api";
import { isOnboardingFrontendEnabled } from "./featureFlags";

export function isOnboardingComplete(settings) {
  const onboarding = settings?.meta?.onboarding;
  if (onboarding) {
    return onboarding.isComplete === true || onboarding.status === "COMPLETED";
  }

  return settings?.meta?.hasTrainingProfile === true;
}

export default function OnboardingGate() {
  const location = useLocation();
  const [state, setState] = useState({ status: "loading", settings: null, error: "" });
  const enabled = isOnboardingFrontendEnabled();

  const load = useCallback(async () => {
    setState({ status: "loading", settings: null, error: "" });
    try {
      const settings = await getUserSettings();
      setState({ status: "loaded", settings, error: "" });
    } catch (error) {
      setState({
        status: "error",
        settings: null,
        error: error?.message || "Unable to load your profile.",
      });
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      load();
    }
  }, [enabled, load]);

  if (!enabled) {
    return <Outlet />;
  }

  if (state.status !== "loaded") {
    return (
      <DesignV2Scope>
        <MobilePage>
          <div className="mx-auto grid min-h-[60dvh] max-w-md place-content-center gap-4 text-center">
            {state.status === "error" ? (
              <>
                <h1 className="font-lz-v2-display text-2xl font-bold text-lz-v2-text-strong">
                  We couldn&apos;t load your profile
                </h1>
                <p className="text-lz-v2-text-muted" role="alert">{state.error}</p>
                <Button onClick={load}>Try again</Button>
              </>
            ) : (
              <p className="text-lz-v2-text-muted" role="status">Loading your profile…</p>
            )}
          </div>
        </MobilePage>
      </DesignV2Scope>
    );
  }

  if (!isOnboardingComplete(state.settings)) {
    return (
      <Navigate
        to="/onboarding"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}

