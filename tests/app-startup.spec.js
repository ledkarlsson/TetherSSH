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
  const server = "localhost";
  const port = "2222";
  const user = "test";
  const password = "testpass";
  const target = `${user}@${server}:${port}`;

  try {
    await expect(page.locator("h1")).toHaveText("TetherSSH");
    await expect(page.locator("#connection-form")).toBeVisible();
    await expect(page.locator("#terminal")).toBeVisible();
    await expect(page.locator("#terminal-title")).toHaveText("not connected");
    await expect(page.locator("#terminal")).not.toContainText("TetherSSH MVP ready");
    await expect(page.locator("#file-tree")).toBeVisible();
    await expect(page.locator("#session-log")).toBeVisible();
    await expect(page.locator("#refresh-files")).toHaveCount(0);
    await expect(page.locator("fieldset")).toHaveCount(0);
    await expect(page.locator("#privateKeyPath")).toHaveCount(0);

    await page.locator("#target").fill(target);
    await page.locator("#password").fill(password);

    await expect(page.locator("#target")).toHaveValue(target);
    await expect(page.locator("#password")).toHaveValue(password);
    await expect(page.locator("#tcp-status")).toContainText("TCP reachable");

    await page.locator("#password").press("Enter");

    await expect(page.locator("#terminal-title")).toHaveText(`Connected to ${user}@${server}`);
    await expect(page.locator("#status")).toHaveText(`Connected to ${user}@${server}`);
    await expect(page.locator("body")).toHaveClass(/connection-panel-collapsed/);
    await expect(page.locator("#connection-form")).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const terminal = document.querySelector("#terminal");
      return terminal?.contains(document.activeElement);
    })).toBe(true);

    await page.locator("#toggle-connection-panel").click();
    await expect(page.locator("body")).not.toHaveClass(/connection-panel-collapsed/);
    await expect(page.locator("#connection-form")).toBeVisible();

    await expect(page.locator("#terminal")).not.toContainText("No such file or directory");
    await expect(page.locator("#terminal")).not.toContainText("file://%s%s");
    await expect(page.locator("#terminal")).not.toContainText("TETHERSSH_RC");
    await expect(page.locator("#terminal")).not.toContainText("__tetherssh_emit_cwd");
    await expect(page.locator("#follow-pwd")).toBeChecked();
    await expect(page.locator("#file-tree")).toContainText("projects");

    await page.locator(".file-item-directory button", { hasText: "projects" }).click();
    await expect(page.locator("#cwd")).toHaveText(/\/home\/test\/projects/);

    await page.evaluate(() => window.tetherTerm.writeClipboardText("PASTE_ONCE"));

    await page.evaluate(() => {
      const terminal = document.querySelector("#terminal");
      terminal.dispatchEvent(new KeyboardEvent("keydown", {
        key: "v",
        code: "KeyV",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      }));
      terminal.dispatchEvent(new KeyboardEvent("keyup", {
        key: "v",
        code: "KeyV",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      }));
    });
    await expect(page.locator("#terminal")).toContainText("PASTE_ONCE");
    await expect.poll(() => page.locator("#terminal").textContent().then((text) => {
      return (text.match(/PASTE_ONCE/g) ?? []).length;
    })).toBe(1);

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("shows a friendly authentication failure for a wrong password", async () => {
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

  try {
    await page.locator("#target").fill("test@localhost:2222");
    await page.locator("#password").fill("wrong-password");
    await expect(page.locator("#tcp-status")).toContainText("TCP reachable");

    await page.locator("#password").press("Enter");

    await expect(page.locator("#status")).toHaveText("Authentication failed. Check username, password, SSH agent, or key.");
    await expect(page.locator("#session-log")).toContainText("Connect failed: Authentication failed. Check username, password, SSH agent, or key.");
    await expect(page.locator("#connect-button")).toBeEnabled();
    await expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
