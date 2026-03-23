const { runAgent } = require("./agent");

(async () => {
  const result = await runAgent("businesses for sale Florida under 1 million");

  console.log("\n🔥 RESULT:\n");
  console.log(result);
})();