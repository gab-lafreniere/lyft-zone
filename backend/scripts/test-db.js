require("dotenv/config");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const created = await prisma.exercise.create({
    data: {
      exerciseId: "exr_barbell_bench_press",
      name: "Barbell Bench Press",
      equipmentCategory: "barbell",
      movementPattern: "horizontal_push",
      mechanicType: "compound",
      difficulty: "intermediate",
      trainingType: "strength",
      overview: "Classic barbell chest press.",
    },
  });

  console.log("Exercice créé :", created);

  const allExercises = await prisma.exercise.findMany();
  console.log("Tous les exercices :", allExercises);
}

main()
  .catch((error) => {
    console.error("Erreur :", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });