const { defineConfig } = require("@playwright/test");
const os = require("node:os");
const path = require("node:path");

module.exports = defineConfig({
  testDir: "tests",
  outputDir: path.join(os.tmpdir(), "tetherssh-playwright-results"),
  timeout: 30_000,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]]
});
