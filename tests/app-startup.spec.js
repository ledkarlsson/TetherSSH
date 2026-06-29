const { _electron: electron, expect, test } = require("@playwright/test");
const path = require("node:path");

test("starts the app without renderer errors", async () => {
  const appRoot = path.resolve(__dirname, "..");
  const app = await electron.launch({
    args: [appRoot],
    cwd: appRoot
  });

  const errors = [];
  const page = await app.firstWindow();

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  const server = "localhost"
  const port = "2222"
  const user = "test"
  const password = "testpass"

  await expect(page.locator("h1")).toHaveText("TetherSSH");
  await expect(page.locator("#connection-form")).toBeVisible();
  await expect(page.locator("#terminal")).toBeVisible();
  await expect(page.locator("#file-tree")).toBeVisible();
  await expect(page.locator("#session-log")).toBeVisible();

  await page.locator("#host").fill(server);
  await page.locator("#port").fill(port);
  await page.locator("#username").fill(user);
  await page.locator("#password").fill(password);

  await expect(page.locator("#host")).toHaveValue(server);
  await expect(page.locator("#port")).toHaveValue(port);
  await expect(page.locator("#username")).toHaveValue(user);
await expect(page.locator("#password")).toHaveValue(password);

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);

  await app.close();
});
