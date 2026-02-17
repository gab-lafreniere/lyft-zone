export const GOALS = [
    { id: "strength", label: "Force", icon: "💪" },
    { id: "hypertrophy", label: "Masse", icon: "🏗️" },
    { id: "cardio", label: "Cardio", icon: "🏃" },
    { id: "mobility", label: "Mobilité", icon: "🧘" },
  ];
  
  export const PROGRAM_WEEKS = [
    { id: 6, label: "6 semaines" },
    { id: 7, label: "7 semaines" },
    { id: 8, label: "8 semaines" },
  ];
  
  
  export const COACH_MODE = [
    {
      id: "ai",
      label: "Coach IA",
      hint:
        "Propose des ajustements pendant le programme (deload, substitutions, volume), suit l’historique et demande un check-in à la fin pour régénérer le prochain programme.",
    },
    {
      id: "fixed",
      label: "Plan fixe",
      hint:
        "Génère un programme stable. Rien ne change automatiquement. Tu regénères un nouveau programme seulement quand tu le demandes.",
    },
  ];
  
  
  export const ENVIRONMENTS = [
    { id: "full_gym", label: "Gym complet", icon: "🏋️" },
    { id: "commercial_gym", label: "Gym commercial", icon: "🏢" },
    { id: "home_gym", label: "Maison", icon: "🏠" },
    { id: "bodyweight", label: "Bodyweight", icon: "🤸" },
    { id: "machines_only", label: "Machines", icon: "⚙️" },
  ];
  
  export const EQUIPMENT = [
    { id: "dumbbells", label: "Haltères" },
    { id: "barbell", label: "Barbell" },
    { id: "kettlebells", label: "Kettlebells" },
    { id: "bands", label: "Élastiques" },
    { id: "cables", label: "Câbles" },
    { id: "machines", label: "Machines guidées" },
    { id: "bench", label: "Banc" },
    { id: "squat_rack", label: "Rack à squat" },
    { id: "pullup_bar", label: "Barre traction" },
  ];
  export const EQUIPMENT_PRESETS = {
    full_gym: ["dumbbells", "barbell", "cables", "machines", "bench", "squat_rack", "pullup_bar"],
    commercial_gym: ["dumbbells", "machines", "cables", "bench"],
    home_gym: ["dumbbells", "bands", "bench"],
    bodyweight: [],
    machines_only: ["machines"],
  };
  
  
  export const AVOID = [
    { id: "no_heavy", label: "Pas de charges lourdes" },
    { id: "no_machines", label: "Pas de machines" },
    { id: "no_floor", label: "Pas d’exercices au sol" },
    { id: "no_overhead", label: "Pas au-dessus de la tête" },
    { id: "no_impact", label: "Pas d’impact / plyo" },
  ];
  
  export const SENSITIVE_AREAS = [
    { id: "shoulders", label: "Épaules", icon: "🟠" },
    { id: "knees", label: "Genoux", icon: "🟡" },
    { id: "back", label: "Dos", icon: "🔵" },
    { id: "hips", label: "Hanches", icon: "🟣" },
    { id: "elbows", label: "Coudes", icon: "🟤" },
    { id: "wrists", label: "Poignets", icon: "🟢" },
    { id: "other", label: "Autre", icon: "⚪" },
  ];
  
  export const MUSCLE_PRIORITIES = [
    {
      group: "Pectoraux",
      items: [{ id: "upper_chest", label: "Haut des pectoraux" }],
    },
    {
      group: "Épaules",
      items: [
        { id: "lateral_delt", label: "Deltoïde moyen" },
        { id: "rear_delt", label: "Deltoïde postérieur" },
      ],
    },
    {
      group: "Dos",
      items: [
        { id: "lats_width", label: "Grand dorsal" },
        { id: "midback_thickness", label: "Épaisseur milieu du dos" },
      ],
    },
    {
      group: "Bras",
      items: [
        { id: "biceps_long_head", label: "Biceps longue portion" },
        { id: "triceps_long_head", label: "Triceps longue portion" },
      ],
    },
    {
      group: "Jambes",
      items: [
        { id: "quads_vmo", label: "Quadriceps vaste interne" },
        { id: "hamstrings_all", label: "Ischios ensemble" },
        { id: "glute_max", label: "Grand fessier" },
        { id: "calves_gastro", label: "Mollets gastrocnémien" },
        { id: "calves_soleus", label: "Mollets soléaire" },
      ],
    },
    {
      group: "Abdominaux",
      items: [
        { id: "abs_rectus", label: "Grand droit" },
        { id: "abs_obliques", label: "Obliques" },
      ],
    },
  ];
  