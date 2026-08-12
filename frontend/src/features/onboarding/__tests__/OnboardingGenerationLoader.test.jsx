import "@testing-library/jest-dom";
import fs from "fs";
import path from "path";
import { render, screen } from "@testing-library/react";
import { DesignV2Scope } from "../../../design-v2";
import OnboardingGenerationLoader from "../OnboardingGenerationLoader";

test("renders the Stitch-inspired progress hierarchy with curated profile context", () => {
  render(
    <DesignV2Scope>
      <OnboardingGenerationLoader
        stage="generating"
        percent={64.8}
        message={{
          title: "Structuring Your Workouts",
          description: "Turning the strategy into workouts and training blocks.",
        }}
        profile={{
          primaryGoal: "HYPERTROPHY",
          experience: "intermediate",
          availability: { sessionsPerWeek: 4 },
          musclePriorities: { primaryFocus: "chest" },
          environment: { equipmentPreset: "minimal" },
        }}
      />
    </DesignV2Scope>
  );

  expect(screen.getByText("64%")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Structuring Your Workouts" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Program generation progress" })).toHaveAttribute(
    "aria-valuenow",
    "64.8"
  );
  expect(screen.getByLabelText("Training profile context")).toHaveTextContent(
    "4 Sessions/Wk"
  );
  expect(screen.getByLabelText("Training profile context")).toHaveTextContent(
    "Hypertrophy"
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText(/Back|Cancel|Home/)).not.toBeInTheDocument();
});

test("floors numeric text while ring and lower bar retain precise visual progress", () => {
  const { container } = render(
    <DesignV2Scope>
      <OnboardingGenerationLoader stage="generating" percent={64.8} />
    </DesignV2Scope>
  );

  const visualPercent = 64.8;
  const displayPercent = 64;
  const circumference = 2 * Math.PI * 47;
  const ring = container.querySelector(".lz-onboarding-generation-ring__fill");
  const lowerBar = container.querySelector(".lz-v2-progress__fill");

  expect(screen.getByText(`${displayPercent}%`)).toHaveAttribute(
    "data-progress-value",
    String(displayPercent)
  );
  expect(screen.queryByText(`${visualPercent}%`)).not.toBeInTheDocument();
  expect(Number(ring.getAttribute("stroke-dashoffset"))).toBeCloseTo(
    circumference * (1 - visualPercent / 100)
  );
  expect(ring).toHaveAttribute("data-progress-value", String(visualPercent));
  expect(screen.getByRole("progressbar", {
    name: "Program generation progress",
  })).toHaveAttribute("aria-valuenow", String(visualPercent));
  expect(lowerBar.style.getPropertyValue("--lz-v2-progress-value"))
    .toBe(`${visualPercent}%`);
});

test("visible progress remains whole-number and monotonic across fractional values", () => {
  const view = render(
    <DesignV2Scope>
      <OnboardingGenerationLoader stage="completing" percent={96.1} />
    </DesignV2Scope>
  );

  expect(screen.getByText("96%")).toBeInTheDocument();
  expect(screen.queryByText(/96\.1%/)).not.toBeInTheDocument();

  view.rerender(
    <DesignV2Scope>
      <OnboardingGenerationLoader stage="completing" percent={96.9} />
    </DesignV2Scope>
  );
  expect(screen.getByText("96%")).toBeInTheDocument();

  view.rerender(
    <DesignV2Scope>
      <OnboardingGenerationLoader stage="completing" percent={97.2} />
    </DesignV2Scope>
  );
  expect(screen.getByText("97%")).toBeInTheDocument();
});

test("keeps the reduced-motion loader treatment", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../onboarding.css"),
    "utf8"
  );

  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(css).toMatch(/\.lz-onboarding-generation-message[\s\S]*animation: none/);
  expect(css).toMatch(/\.lz-onboarding-generation[\s\S]*transition: none/);
});

test("does not apply an independent long transition to either visual progress fill", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../onboarding.css"),
    "utf8"
  );

  expect(css).toMatch(
    /\.lz-onboarding-generation-ring__fill\s*\{[^}]*transition: none/
  );
  expect(css).toMatch(
    /\.lz-onboarding-generation-progress \.lz-v2-progress__fill\s*\{[^}]*transition: none/
  );
});

test("exposes the completion fade state without changing progress semantics", () => {
  const { container } = render(
    <DesignV2Scope>
      <OnboardingGenerationLoader
        stage="completing"
        percent={100}
        isExiting
      />
    </DesignV2Scope>
  );

  expect(container.querySelector(".lz-onboarding-generation"))
    .toHaveClass("lz-onboarding-generation--exiting");
  expect(screen.getByRole("progressbar", {
    name: "Program generation progress",
  })).toHaveAttribute("aria-valuenow", "100");
});
