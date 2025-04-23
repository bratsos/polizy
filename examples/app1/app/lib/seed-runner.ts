import { seedDatabase, prisma } from "./polizy.server";

async function main() {
  console.log("Starting seed runner...");
  await seedDatabase();
  console.log("Seed runner finished.");
}

main()
  .catch((e) => {
    console.error("Error running seed script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
