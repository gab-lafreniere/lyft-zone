import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AccountProfileScreen from "../AccountProfileScreen";
import { updateUserProfile } from "../../../services/api";

jest.mock("../../../services/api", () => ({
  updateUserProfile: jest.fn(),
}));

function createProfile(overrides = {}) {
  return {
    name: "Alex",
    email: "alex@example.com",
    username: "alex",
    profilePicture: null,
    age: null,
    sex: null,
    currentAge: null,
    demographicsStatus: "NOT_COLLECTED",
    ...overrides,
  };
}

beforeEach(() => {
  updateUserProfile.mockReset();
});

test("collects age and sex together with explicit validation and no input date", async () => {
  const onProfileChange = jest.fn();
  updateUserProfile.mockResolvedValue({
    profile: {
      age: 29,
      sex: "MALE",
      currentAge: 29,
      demographicsStatus: "LOCKED",
    },
  });

  render(
    <AccountProfileScreen
      profile={createProfile()}
      onProfileChange={onProfileChange}
    />
  );

  expect(screen.getByText("Personalization")).toBeInTheDocument();
  expect(screen.getByText("Used to personalize AI-generated programs.")).toBeInTheDocument();
  expect(screen.getByText("These values can’t currently be changed after saving.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Age"), { target: { value: "17" } });
  fireEvent.click(screen.getByRole("button", { name: "Male" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Age"), { target: { value: "29" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateUserProfile).toHaveBeenCalledTimes(1));
  expect(updateUserProfile).toHaveBeenCalledWith({ age: 29, sex: "MALE" });
  expect(JSON.stringify(updateUserProfile.mock.calls[0][0])).not.toMatch(/ageInputDate/);
  expect(onProfileChange).toHaveBeenCalledWith(
    expect.objectContaining({
      age: 29,
      sex: "MALE",
      demographicsStatus: "LOCKED",
    })
  );
});

test("shows locked demographics without editable controls", () => {
  render(
    <AccountProfileScreen
      profile={createProfile({
        age: 29,
        sex: "FEMALE",
        currentAge: 30,
        demographicsStatus: "LOCKED",
      })}
    />
  );

  expect(screen.queryByText("Personalization")).not.toBeInTheDocument();
  expect(screen.queryByText("Saved and currently locked.")).not.toBeInTheDocument();
  expect(screen.getByText("30")).toBeInTheDocument();
  expect(screen.getByText("Female")).toBeInTheDocument();
  expect(screen.queryByLabelText("Age")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
});

test("shows inconsistent values read-only and does not expose a repair form", () => {
  render(
    <AccountProfileScreen
      profile={createProfile({
        age: 29,
        sex: null,
        demographicsStatus: "INCONSISTENT",
      })}
    />
  );

  expect(
    screen.getByText("Some profile information is incomplete and cannot currently be changed.")
  ).toBeInTheDocument();
  expect(screen.getByText("29")).toBeInTheDocument();
  expect(screen.queryByLabelText("Age")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
});

test("keeps backend validation errors visible", async () => {
  const error = new Error("Profile demographics payload is invalid");
  error.details = [{ path: "age", message: "Server rejected this age." }];
  updateUserProfile.mockRejectedValue(error);

  render(<AccountProfileScreen profile={createProfile()} />);
  fireEvent.change(screen.getByLabelText("Age"), { target: { value: "29" } });
  fireEvent.click(screen.getByRole("button", { name: "Female" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Server rejected this age.")).toBeInTheDocument();
  expect(screen.getByText("Profile demographics payload is invalid")).toBeInTheDocument();
});
