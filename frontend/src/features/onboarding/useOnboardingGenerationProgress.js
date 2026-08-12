import { useCallback, useEffect, useRef, useState } from "react";
import { getAIWeeklyPlanGenerationProgress } from "../../services/api";
import {
  advanceVisualPercent,
  getCompletionTiming,
  getGenerationMessage,
  getProgramPacingProfile,
  resolveProgressTarget,
  resolveDisplayStage,
  resolveGenerationStage,
} from "./onboardingGenerationProgress";

const POLL_INTERVAL_MS = 2000;
const PROGRESS_INTERVAL_MS = 16;
const MESSAGE_INTERVAL_MS = 5000;

function createGenerationId() {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `generation_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

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

  const beginAI = useCallback(() => {
    const generationId = createGenerationId();
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
    return generationId;
  }, []);

  const stopAI = useCallback(() => setActiveGenerationId(null), []);
  const markWeeklyPlanReady = useCallback(() => {
    finalizationStartedAtRef.current = Date.now();
    updateTargetPercent(95);
  }, [updateTargetPercent]);
  const markCycleReady = useCallback(() => {
    updateTargetPercent(97);
  }, [updateTargetPercent]);
  const markSuccess = useCallback(() => {
    updateTargetPercent(100);
    setCompletionState("animating");
  }, [updateTargetPercent]);

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

    async function poll() {
      activeController?.abort();
      activeController = new AbortController();
      try {
        const progress = await getAIWeeklyPlanGenerationProgress(
          activeGenerationId,
          { signal: activeController.signal }
        );
        if (stopped) return;
        if (progress?.stage) setBackendStage(progress.stage);
        if (progress?.status === "SUCCEEDED" || progress?.status === "FAILED") {
          setActiveGenerationId(null);
        }
      } catch (_error) {
        // Progress is best effort. The simulated model remains active.
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

  let message = getGenerationMessage({
    stage: displayStage,
    messageIndex,
    sessionsPerWeek,
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
  };
}
