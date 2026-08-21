import {
  SPACED_DEFAULT_TRAINING_DAYS,
  adjustTrainingDaysForSessions,
  getSpacedDefaultTrainingDays,
  isValidPreferredTrainingDays,
} from "../trainingDayDefaults";

test("uses the locked spaced defaults for one through seven sessions", () => {
  expect(SPACED_DEFAULT_TRAINING_DAYS).toEqual({
    1: ["MONDAY"],
    2: ["MONDAY", "THURSDAY"],
    3: ["MONDAY", "WEDNESDAY", "FRIDAY"],
    4: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY"],
    5: ["MONDAY", "TUESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
    6: ["MONDAY", "TUESDAY", "WEDNESDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    7: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
  });
});

test("untouched session changes replace the selection with the new spaced default", () => {
  expect(
    adjustTrainingDaysForSessions(["MONDAY", "WEDNESDAY", "FRIDAY"], 5, false)
  ).toEqual(getSpacedDefaultTrainingDays(5));
});

test("touched session reductions drop only the latest weekdays", () => {
  expect(
    adjustTrainingDaysForSessions(
      ["TUESDAY", "THURSDAY", "SATURDAY", "SUNDAY"],
      2,
      true
    )
  ).toEqual(["TUESDAY", "THURSDAY"]);
});

test("touched session increases fill from the new default before remaining weekdays", () => {
  expect(
    adjustTrainingDaysForSessions(["TUESDAY", "SUNDAY"], 4, true)
  ).toEqual(["MONDAY", "TUESDAY", "THURSDAY", "SUNDAY"]);
});

test("preferred-day validation requires exact canonical unique values", () => {
  expect(isValidPreferredTrainingDays(["FRIDAY", "MONDAY", "WEDNESDAY"], 3)).toBe(true);
  expect(isValidPreferredTrainingDays(["MONDAY", "MONDAY", "FRIDAY"], 3)).toBe(false);
  expect(isValidPreferredTrainingDays(["MONDAY", "FUNDAY", "FRIDAY"], 3)).toBe(false);
  expect(isValidPreferredTrainingDays(["MONDAY", "FRIDAY"], 3)).toBe(false);
});
