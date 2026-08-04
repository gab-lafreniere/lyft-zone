import { useEffect, useState } from "react";
import Button from "../../ui/Button";
import SegmentedSelector from "./SegmentedSelector";
import { updateUserProfile } from "../../services/api";

const SEX_OPTIONS = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
];

function displayValue(value) {
  return value == null || value === "" ? "Not set" : String(value);
}

function formatSex(value) {
  return value === "MALE" ? "Male" : value === "FEMALE" ? "Female" : displayValue(value);
}

function ReadonlyRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0 last:pb-0">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-900">{displayValue(value)}</dd>
    </div>
  );
}

export default function AccountProfileScreen({ profile = {}, onProfileChange }) {
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const status = profile.demographicsStatus || "NOT_COLLECTED";
  const numericAge = Number(age);
  const isAgeValid =
    age.trim() !== "" &&
    Number.isInteger(numericAge) &&
    numericAge >= 18 &&
    numericAge <= 100;
  const isSexValid = sex === "MALE" || sex === "FEMALE";
  const isFormValid = isAgeValid && isSexValid;

  useEffect(() => {
    if (status === "NOT_COLLECTED") {
      setAge("");
      setSex("");
      setFieldErrors({});
      setSaveError("");
    }
  }, [status]);

  function validate() {
    const nextErrors = {};

    if (!isAgeValid) {
      nextErrors.age = "Age must be an integer from 18 through 100.";
    }
    if (!isSexValid) {
      nextErrors.sex = "Select Male or Female.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 ? numericAge : null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const numericAge = validate();
    if (numericAge == null) {
      return;
    }

    setIsSaving(true);
    setSaveError("");
    try {
      const response = await updateUserProfile({ age: numericAge, sex });
      onProfileChange?.({
        ...profile,
        ...response.profile,
      });
    } catch (error) {
      const nextFieldErrors = {};
      (Array.isArray(error?.details) ? error.details : []).forEach((issue) => {
        if (issue?.path === "age" || issue?.path === "sex") {
          nextFieldErrors[issue.path] = issue.message;
        }
      });
      setFieldErrors(nextFieldErrors);
      setSaveError(error?.message || "Unable to save profile information.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div>
      <dl>
        <ReadonlyRow label="Name" value={profile.name} />
        <ReadonlyRow label="Email" value={profile.email} />
        <ReadonlyRow label="Username" value={profile.username} />
        <ReadonlyRow label="Profile Picture" value={profile.profilePicture} />
      </dl>

      <section className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
          Personalization
        </h3>

        {status === "NOT_COLLECTED" ? (
          <form className="mt-3 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1 text-sm leading-relaxed text-slate-500">
              <p>Used to personalize AI-generated programs.</p>
              <p>These values can’t currently be changed after saving.</p>
            </div>

            <div>
              <label htmlFor="profile-age" className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Age
              </label>
              <input
                id="profile-age"
                type="number"
                min="18"
                max="100"
                step="1"
                value={age}
                onChange={(event) => {
                  setAge(event.target.value);
                  setFieldErrors((current) => ({ ...current, age: undefined }));
                }}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                aria-describedby={fieldErrors.age ? "profile-age-error" : undefined}
                disabled={isSaving}
              />
              {fieldErrors.age ? <p id="profile-age-error" className="mt-2 text-sm font-medium text-red-500">{fieldErrors.age}</p> : null}
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Sex</p>
              <SegmentedSelector
                options={SEX_OPTIONS}
                value={sex}
                onChange={(value) => {
                  setSex(value);
                  setFieldErrors((current) => ({ ...current, sex: undefined }));
                }}
              />
              {fieldErrors.sex ? <p className="mt-2 text-sm font-medium text-red-500">{fieldErrors.sex}</p> : null}
            </div>

            {saveError ? (
              <p className="text-sm font-medium text-red-600" role="alert">
                {saveError}
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                className="min-w-28 !bg-primary !text-white hover:!bg-primary/90 disabled:!bg-primary/40 disabled:!text-white"
                disabled={isSaving || !isFormValid}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-3">
            <p className="mb-2 text-sm leading-relaxed text-slate-500">
              {status === "LOCKED"
                ? "Saved and currently locked."
                : "Some profile information is incomplete and cannot currently be changed."}
            </p>
            <dl>
              <ReadonlyRow
                label="Age"
                value={status === "LOCKED" ? profile.currentAge : profile.age}
              />
              <ReadonlyRow label="Sex" value={formatSex(profile.sex)} />
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}
