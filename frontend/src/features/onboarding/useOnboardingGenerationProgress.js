import { useCallback, useEffect, useRef, useState } from "react";
import { getAIWeeklyPlanGenerationProgress } from "../../services/api";
import {
  advanceVisualPercent,
  GENERATION_PROGRESS_CEILING,
  getCompletionTiming,
  getGenerationMessage,
  getProgramPacingProfile,
  MINIMUM_VISIBLE_DURATION_MS,
  resolveProgressTarget,
  resolveDisplayStage,
  resolveGenerationStage,
} from "./onboardingGenerationProgress";

const POLL_INTERVAL_MS = 2000;
const PROGRESS_INTERVAL_MS = 16;
const MESSAGE_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export default function useOnboardingGenerationProgress(
  phase,
  sessionsPerWeek,
  durationPerSession
) {
  const [percent, setPercent] = useState(0);
  const [targetPercent, setTargetPercent] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [displayStage, setDisplayStage] = useState("PROFILE_SETUP");
  const [backendStage, setBackendStage] = useState(null);
  const [activeGenerationId, setActiveGenerationId] = useState(null);
  const [completionState, setCompletionState] = useState("idle");
  const percentRef = useRef(0);
  const targetPercentRef = useRef(0);
  const generationStartedAtRef = useRef(null);
  const finalizationStartedAtRef = useRef(null);
  const stageStartedAtRef = useRef(Date.now());
  const phaseStartedAtRef = useRef(Date.now());
  const lastProgressAtRef = useRef(Date.now());
  const displayStageRef = useRef("PROFILE_SETUP");
  const messageStartedAtRef = useRef(Date.now());
  const completionDelayTimeoutRef = useRef(null);
  const terminalStatusRef = useRef(null);
  const terminalWaitersRef = useRef([]);
  const { pacingMultiplier } = getProgramPacingProfile({
    sessionsPerWeek,
    durationPerSession,
  });

  const updateTargetPercent = useCallback((nextTarget) => {
    const normalized = Math.max(
      targetPercentRef.current,
      Math.min(100, Number(nextTarget) || 0)
    );
    targetPercentRef.current = normalized;
    setTargetPercent(normalized);
  }, []);

  const reset = useCallback(() => {
    if (completionDelayTimeoutRef.current != null) {
      window.clearTimeout(completionDelayTimeoutRef.current);
      completionDelayTimeoutRef.current = null;
    }
    terminalWaitersRef.current.splice(0).forEach((resolve) => resolve("STOPPED"));
    terminalStatusRef.current = null;
    setPercent(0);
    percentRef.current = 0;
    setTargetPercent(0);
    targetPercentRef.current = 0;
    setMessageIndex(0);
    setDisplayStage("PROFILE_SETUP");
    setBackendStage(null);
    setActiveGenerationId(null);
    setCompletionState("idle");
    generationStartedAtRef.current = null;
    finalizationStartedAtRef.current = null;
    stageStartedAtRef.current = Date.now();
    phaseStartedAtRef.current = Date.now();
    lastProgressAtRef.current = Date.now();
    displayStageRef.current = "PROFILE_SETUP";
    messageStartedAtRef.current = Date.now();
  }, []);

  const beginAI = useCallback((generationId) => {
    if (completionDelayTimeoutRef.current != null) {
      window.clearTimeout(completionDelayTimeoutRef.current);
      completionDelayTimeoutRef.current = null;
    }
    terminalWaitersRef.current.splice(0).forEach((resolve) => resolve("STOPPED"));
    terminalStatusRef.current = null;
    targetPercentRef.current = percentRef.current;
    setTargetPercent(percentRef.current);
    setBackendStage(null);
    setMessageIndex(0);
    setDisplayStage("PROFILE_SETUP");
    setActiveGenerationId(generationId);
    setCompletionState("idle");
    generationStartedAtRef.current = Date.now();
    finalizationStartedAtRef.current = null;
    stageStartedAtRef.current = Date.now();
    phaseStartedAtRef.current = Date.now();
    lastProgressAtRef.current = Date.now();
    displayStageRef.current = "PROFILE_SETUP";
    messageStartedAtRef.current = Date.now();
  }, []);

  const stopAI = useCallback(() => setActiveGenerationId(null), []);
  const waitForAICompletion = useCallback(() => {
    if (terminalStatusRef.current) {
      return Promise.resolve(terminalStatusRef.current);
    }
    return new Promise((resolve) => {
      terminalWaitersRef.current.push(resolve);
    });
  }, []);
  const markWeeklyPlanReady = useCallback(() => {
    finalizationStartedAtRef.current = Date.now();
    updateTargetPercent(GENERATION_PROGRESS_CEILING);
  }, [updateTargetPercent]);
  const markCycleReady = useCallback(() => {
    updateTargetPercent(97);
  }, [updateTargetPercent]);
  const unlockSuccess = useCallback(() => {
    completionDelayTimeoutRef.current = null;
    updateTargetPercent(100);
    setCompletionState("animating");
  }, [updateTargetPercent]);
  const markSuccess = useCallback(() => {
    if (completionDelayTimeoutRef.current != null) {
      return;
    }
    const generationStartedAt = generationStartedAtRef.current;
    const visibleElapsedMs = generationStartedAt == null
      ? MINIMUM_VISIBLE_DURATION_MS
      : Date.now() - generationStartedAt;
    const remainingMs = Math.max(
      0,
      MINIMUM_VISIBLE_DURATION_MS - visibleElapsedMs
    );
    if (remainingMs === 0) {
      unlockSuccess();
      return;
    }
    completionDelayTimeoutRef.current = window.setTimeout(
      unlockSuccess,
      remainingMs
    );
  }, [unlockSuccess]);

  useEffect(() => {
    const now = Date.now();
    phaseStartedAtRef.current = now;
    lastProgressAtRef.current = now;
  }, [phase]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      const progressElapsedMs = Math.max(
        0,
        now - lastProgressAtRef.current
      );
      lastProgressAtRef.current = now;
      const elapsedMs = generationStartedAtRef.current
        ? now - generationStartedAtRef.current
        : 0;
      const targetStage = resolveGenerationStage(backendStage, elapsedMs);
      const computedTarget = resolveProgressTarget(percentRef.current, {
        phase,
        backendStage,
        displayStage: displayStageRef.current,
        elapsedMs,
        stageElapsedMs: now - stageStartedAtRef.current,
        phaseElapsedMs: now - phaseStartedAtRef.current,
        finalizationElapsedMs: finalizationStartedAtRef.current == null
          ? now - phaseStartedAtRef.current
          : now - finalizationStartedAtRef.current,
        pacingMultiplier,
      });
      const nextTarget = Math.max(targetPercentRef.current, computedTarget);
      if (nextTarget !== targetPercentRef.current) {
        targetPercentRef.current = nextTarget;
        setTargetPercent(nextTarget);
      }
      const nextPercent = advanceVisualPercent(
        percentRef.current,
        nextTarget,
        { elapsedMs: progressElapsedMs, pacingMultiplier }
      );
      percentRef.current = nextPercent;
      setPercent((current) => current === nextPercent ? current : nextPercent);

      const nextDisplayStage = resolveDisplayStage({
        displayStage: displayStageRef.current,
        targetStage,
        visualPercent: nextPercent,
      });
      if (nextDisplayStage !== displayStageRef.current) {
        displayStageRef.current = nextDisplayStage;
        stageStartedAtRef.current = now;
        messageStartedAtRef.current = now;
        setDisplayStage(nextDisplayStage);
        setMessageIndex(0);
      }

      if (phase === "generating") {
        if (now - messageStartedAtRef.current >= MESSAGE_INTERVAL_MS) {
          messageStartedAtRef.current = now;
          setMessageIndex((current) => current + 1);
        }
      }
    }, PROGRESS_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [backendStage, pacingMultiplier, phase]);

  useEffect(() => {
    if (completionState === "animating" && percent >= 100) {
      setCompletionState("holding");
    }
  }, [completionState, percent]);

  useEffect(() => {
    if (completionState !== "holding" && completionState !== "exiting") {
      return undefined;
    }
    const reducedMotion = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timing = getCompletionTiming(reducedMotion);
    const timeout = window.setTimeout(() => {
      setCompletionState(
        completionState === "holding" ? "exiting" : "ready"
      );
    }, completionState === "holding" ? timing.holdMs : timing.fadeMs);
    return () => window.clearTimeout(timeout);
  }, [completionState]);

  useEffect(() => {
    if (!activeGenerationId || phase !== "generating") {
      return undefined;
    }
    let stopped = false;
    let activeController = null;
    let consecutiveFailures = 0;

    async function poll() {
      activeController?.abort();
      activeController = new AbortController();
      try {
        const progress = await getAIWeeklyPlanGenerationProgress(
          activeGenerationId,
          { signal: activeController.signal }
        );
        if (stopped) return;
        consecutiveFailures = 0;
        if (progress?.stage) setBackendStage(progress.stage);
        if (progress?.status === "SUCCEEDED" || progress?.status === "FAILED") {
          terminalStatusRef.current = progress.status;
          terminalWaitersRef.current
            .splice(0)
            .forEach((resolve) => resolve(progress.status));
          setActiveGenerationId(null);
        }
      } catch (error) {
        if (stopped || error?.name === "AbortError") return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          // Bound recovery when the best-effort in-process registry disappears.
          // The page surfaces its existing explicit retry state; it does not regenerate here.
          terminalStatusRef.current = "UNAVAILABLE";
          terminalWaitersRef.current
            .splice(0)
            .forEach((resolve) => resolve("UNAVAILABLE"));
          setActiveGenerationId(null);
        }
      }
    }

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      activeController?.abort();
      window.clearInterval(interval);
    };
  }, [activeGenerationId, phase]);

  useEffect(() => () => {
    terminalWaitersRef.current.splice(0).forEach((resolve) => resolve("STOPPED"));
    if (completionDelayTimeoutRef.current != null) {
      window.clearTimeout(completionDelayTimeoutRef.current);
    }
  }, []);

  const generationElapsedMs = generationStartedAtRef.current == null
    ? 0
    : Math.max(0, Date.now() - generationStartedAtRef.current);
  let message = getGenerationMessage({
    stage: displayStage,
    messageIndex,
    generationElapsedMs,
  });
  if (phase === "checking") {
    message = {
      title: "Checking Your Schedule",
      description: "Finding the right six-week training window.",
    };
  } else if (phase === "converting") {
    message = {
      title: "Preparing Your 6-Week Cycle",
      description: "Scheduling your weekly plan across six weeks.",
    };
  } else if (phase === "completing") {
    message = {
      title: "Finalizing Your Program",
      description: "Saving your onboarding progress and getting everything ready.",
    };
  }

  return {
    percent,
    targetPercent,
    message,
    backendStage,
    displayStage,
    completionReady: completionState === "ready",
    isCompletionExiting:
      completionState === "exiting" || completionState === "ready",
    beginAI,
    markCycleReady,
    markSuccess,
    markWeeklyPlanReady,
    reset,
    stopAI,
    waitForAICompletion,
  };
}
