const { config } = require("../server/config");
const { ItemTrackerService } = require("../server/itemTrackerService");

async function main() {
  const service = new ItemTrackerService(config);
  const report = await service.bootstrap();
  console.log("PocketBase bootstrap complete.");
  for (const line of report) {
    console.log(`- ${line}`);
  }
}

main().catch((error) => {
  console.error("PocketBase bootstrap failed.");
  console.error(error);
  process.exit(1);
});
