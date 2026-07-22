import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter } from "react-router-dom";
import MainLayout from "../MainLayout";

function renderAt(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <MainLayout />
    </MemoryRouter>
  );
}

describe("MainLayout bottom navigation", () => {
  test.each([
    "/",
    "/program",
    "/program/all",
    "/program/cycles",
    "/program/cycles/cycle_1",
    "/progress",
    "/ai",
  ])("renders the global tabs on %s", (pathname) => {
    renderAt(pathname);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  test.each([
    "/train",
    "/program/manual-new",
    "/program/manual-builder",
    "/program/manual-builder/workout/workout_1",
    "/program/manual-builder-multi",
    "/program/manual-convert",
    "/program/cycles/cycle_1/builder",
    "/program/cycles/cycle_1/builder/week/2/workout/1",
    "/program/cycles/cycle_1/builder/workout/workout_1",
  ])("keeps the global tabs intentionally hidden on %s", (pathname) => {
    renderAt(pathname);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
