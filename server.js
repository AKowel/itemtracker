const { startServer } = require("./server/app");

startServer().catch((error) => {
  console.error("Item tracker server failed to start.");
  console.error(error);
  process.exit(1);
});
