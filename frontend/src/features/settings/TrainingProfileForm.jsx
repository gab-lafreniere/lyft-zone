import Card from "../../ui/Card";
import AvailabilitySection from "./trainingProfileSections/AvailabilitySection";
import CardioProfileSection from "./trainingProfileSections/CardioProfileSection";
import EnvironmentSection from "./trainingProfileSections/EnvironmentSection";
import ExercisePreferenceSection from "./trainingProfileSections/ExercisePreferenceSection";
import ExperienceSection from "./trainingProfileSections/ExperienceSection";
import GoalsSection from "./trainingProfileSections/GoalsSection";
import MovementConstraintsSection from "./trainingProfileSections/MovementConstraintsSection";
import PhysicalNotesSection from "./trainingProfileSections/PhysicalNotesSection";

const SECTION_COMPONENTS = {
  goals: GoalsSection,
  experience: ExperienceSection,
  availability: AvailabilitySection,
  environment: EnvironmentSection,
  movementConstraints: MovementConstraintsSection,
  exercisePreference: ExercisePreferenceSection,
  cardioProfile: CardioProfileSection,
  physicalNotes: PhysicalNotesSection,
};

export default function TrainingProfileForm({
  sectionId,
  draft,
  onChange,
  fieldErrors,
}) {
  const SectionComponent = SECTION_COMPONENTS[sectionId];

  if (!SectionComponent) {
    return (
      <Card className="border-slate-200 bg-slate-50 shadow-none">
        <div className="p-4 text-sm text-slate-600">
          This settings screen is not available yet.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <SectionComponent draft={draft} onChange={onChange} fieldErrors={fieldErrors} />

      <Card className="border-slate-200 bg-slate-50/90 shadow-none">
        <div className="p-4 text-sm text-slate-600 md:p-5">
          <p className="font-semibold text-slate-800">Signal behavior in V1</p>
          <p className="mt-2 leading-relaxed">
            Caution fields stay soft signals. Blocked fields are explicit hard blocks.
            AI-detected and confirmed patterns are preserved, but never promoted to hard
            blocks automatically.
          </p>
        </div>
      </Card>
    </div>
  );
}
