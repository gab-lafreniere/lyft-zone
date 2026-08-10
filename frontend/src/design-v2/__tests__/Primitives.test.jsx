import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Button,
  Chip,
  DesignV2Scope,
  Disclosure,
  Field,
  MobilePage,
  ProgressIndicator,
  SegmentedControl,
  SelectMenu,
  SelectableCard,
  Stepper,
  StickyBottomActions,
} from "..";

function renderInScope(children) {
  return render(<DesignV2Scope>{children}</DesignV2Scope>);
}

describe("Design V2 primitives", () => {
  test("Button exposes disabled and loading states without firing actions", () => {
    const onClick = jest.fn();
    renderInScope(
      <>
        <Button disabled onClick={onClick}>Disabled action</Button>
        <Button isLoading loadingLabel="Saving profile" onClick={onClick}>
          Save
        </Button>
      </>
    );

    const disabledButton = screen.getByRole("button", { name: "Disabled action" });
    const loadingButton = screen.getByRole("button", { name: "Saving profile" });

    expect(disabledButton).toBeDisabled();
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(disabledButton);
    fireEvent.click(loadingButton);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("native interactive primitives receive keyboard focus in order", () => {
    renderInScope(
      <>
        <Button>Continue</Button>
        <Chip>Cardio</Chip>
        <SelectableCard title="Home gym" />
      </>
    );

    userEvent.tab();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
    userEvent.tab();
    expect(screen.getByRole("button", { name: "Cardio" })).toHaveFocus();
    userEvent.tab();
    expect(screen.getByRole("button", { name: "Home gym" })).toHaveFocus();
  });

  test("Field connects labels, hints, errors, and invalid state", () => {
    renderInScope(
      <Field label="Age" hint="Use your current age" error="Enter a valid age" required>
        <input type="number" />
      </Field>
    );

    const input = screen.getByRole("spinbutton", { name: "Age" });
    const hint = screen.getByText("Use your current age");
    const error = screen.getByRole("alert");

    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby").split(" ")).toEqual([
      hint.id,
      error.id,
    ]);
  });

  test("SelectableCard and Chip expose selection semantics", () => {
    renderInScope(
      <>
        <div role="radiogroup" aria-label="Training setup">
          <SelectableCard
            title="Commercial gym"
            description="Machines and free weights"
            selectionMode="single"
            selected
          />
        </div>
        <Chip selected>Warm-up</Chip>
      </>
    );

    expect(screen.getByRole("radio", { name: "Commercial gym" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("button", { name: "Warm-up" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("SegmentedControl maps a compact radio choice and respects disabled options", () => {
    const onChange = jest.fn();
    renderInScope(
      <SegmentedControl
        label="Experience"
        value="beginner"
        onChange={onChange}
        options={[
          { value: "beginner", label: "Beginner" },
          { value: "advanced", label: "Advanced", disabled: true },
        ]}
      />
    );

    expect(screen.getByRole("radio", { name: "Beginner" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("radio", { name: "Advanced" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Beginner" }));
    expect(onChange).toHaveBeenCalledWith("beginner");
  });

  test("SelectMenu supports mouse and keyboard listbox selection", () => {
    const onChange = jest.fn();
    renderInScope(
      <SelectMenu
        label="Training experience"
        value={null}
        onChange={onChange}
        options={[
          { value: "beginner", label: "Beginner" },
          { value: "intermediate", label: "Intermediate" },
          { value: "advanced", label: "Advanced" },
        ]}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Training experience" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    userEvent.keyboard("{arrowdown}{arrowdown}{enter}");
    expect(onChange).toHaveBeenCalledWith("intermediate");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Advanced" }));
    expect(onChange).toHaveBeenLastCalledWith("advanced");
  });

  test("Stepper announces its value and respects boundaries", () => {
    const onDecrement = jest.fn();
    const onIncrement = jest.fn();
    renderInScope(
      <Stepper
        label="Days per week"
        value={4}
        unit="days"
        onDecrement={onDecrement}
        onIncrement={onIncrement}
        canDecrement={false}
        decrementLabel="Decrease training days"
        incrementLabel="Increase training days"
      />
    );

    expect(screen.getByRole("group", { name: "Days per week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decrease training days" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Increase training days" }));
    expect(onIncrement).toHaveBeenCalledTimes(1);
    expect(screen.getByText("4").closest("output")).toHaveAttribute("aria-live", "polite");
  });

  test("ProgressIndicator exposes bounded progressbar values", () => {
    renderInScope(
      <ProgressIndicator value={8} min={0} max={5} label="Profile progress" showValue />
    );

    const progress = screen.getByRole("progressbar", { name: "Profile progress" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "5");
    expect(progress).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  test("Disclosure toggles with keyboard activation and reports state", () => {
    const onOpenChange = jest.fn();
    renderInScope(
      <Disclosure title="Anything else?" onOpenChange={onOpenChange}>
        <p>Optional details</p>
      </Disclosure>
    );

    const trigger = screen.getByRole("button", { name: "Anything else?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Optional details")).not.toBeVisible();

    trigger.focus();
    userEvent.keyboard("{enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Optional details")).toBeVisible();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  test("MobilePage and StickyBottomActions expose the layout hooks", () => {
    renderInScope(
      <MobilePage header={<span>Header</span>} hasStickyActions>
        <p>Page content</p>
        <StickyBottomActions aria-label="Page actions">
          <Button>Continue</Button>
        </StickyBottomActions>
      </MobilePage>
    );

    expect(screen.getByText("Page content").closest(".lz-v2-mobile-page")).toHaveClass(
      "lz-v2-mobile-page--with-sticky-actions"
    );
    expect(screen.getByLabelText("Page actions")).toHaveClass("lz-v2-sticky-actions");
  });
});
