import fs from "fs";
import path from "path";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import LegacyButton from "../../ui/Button";
import { Button, DesignV2Scope } from "..";

function readDesignV2Style(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

describe("DesignV2Scope", () => {
  test("marks only its own subtree as Design V2", () => {
    render(
      <div>
        <div data-testid="legacy-root">Existing UI</div>
        <DesignV2Scope data-testid="v2-root" className="feature-shell">
          <Button>Design V2 action</Button>
        </DesignV2Scope>
      </div>
    );

    expect(screen.getByTestId("v2-root")).toHaveClass("lz-v2", "feature-shell");
    expect(screen.getByTestId("v2-root")).toHaveAttribute("data-design-version", "v2");
    expect(screen.getByTestId("legacy-root")).not.toHaveClass("lz-v2");
  });

  test("does not alter existing UI component contracts", () => {
    render(
      <div>
        <LegacyButton>Existing action</LegacyButton>
        <DesignV2Scope>
          <Button>New action</Button>
        </DesignV2Scope>
      </div>
    );

    const existingButton = screen.getByRole("button", { name: "Existing action" });
    const designV2Button = screen.getByRole("button", { name: "New action" });

    expect(existingButton).toHaveClass("bg-accent", "text-white", "rounded-2xl");
    expect(existingButton).not.toHaveClass("lz-v2-button");
    expect(designV2Button).toHaveClass("lz-v2-button", "lz-v2-button--primary");
  });

  test("keeps tokens and primitive selectors scoped", () => {
    const tokens = readDesignV2Style("tokens.css");
    const primitives = readDesignV2Style("components/primitives.css");
    const styles = `${tokens}\n${primitives}`;

    expect(tokens.trimStart()).toMatch(/^\.lz-v2\s*\{/);
    expect(styles).not.toMatch(/(^|})\s*:root\b/m);
    expect(styles).not.toMatch(/(^|})\s*html\b/m);
    expect(styles).not.toMatch(/(^|})\s*body\b/m);
    expect(styles).not.toMatch(/(^|})\s*#root\b/m);
    expect(primitives).toMatch(/\.lz-v2 \.lz-v2-button/);
    expect(primitives).toMatch(/\.lz-v2 \.lz-v2-mobile-page/);
  });

  test("defines scoped reduced-motion and safe-area behavior", () => {
    const tokens = readDesignV2Style("tokens.css");
    const primitives = readDesignV2Style("components/primitives.css");

    expect(tokens).toContain("@media (prefers-reduced-motion: reduce)");
    expect(tokens).toContain("transition-duration: 0.01ms !important");
    expect(tokens).toContain("--lz-v2-safe-area-bottom: env(safe-area-inset-bottom, 0px)");
    expect(primitives).toContain("var(--lz-v2-safe-area-bottom)");
    expect(primitives).toContain(".lz-v2 .lz-v2-sticky-actions");
  });
});

