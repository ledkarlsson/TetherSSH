const { _electron: electron, expect, test } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("starts the app without renderer errors", async () => {
  const appRoot = path.resolve(__dirname, "..");
  const keyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tetherssh-keys-"));
  fs.writeFileSync(path.join(keyDirectory, "id_alpha"), "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n");
  fs.writeFileSync(path.join(keyDirectory, "work-key.ppk"), "PuTTY-User-Key-File-3: ssh-ed25519\n");
  fs.writeFileSync(path.join(keyDirectory, "id_alpha.pub"), "ssh-ed25519 public-key\n");
  fs.writeFileSync(path.join(keyDirectory, "notes.txt"), "not a private key\n");
  const app = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: { ...process.env, TETHERSSH_TEST_TRUST_HOST_KEYS: "1" }
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
    await expect(page.locator(".connection-panel > header")).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].getTitle();
    })).toBe("TetherSSH 0.1.0");
    await expect(page.locator("#connection-form")).toBeVisible();
    await expect(page.locator("#terminal .xterm")).toBeVisible();
    const applicationMenu = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      return {
        labels: menu.items.map((item) => item.label),
        helpItems: menu.items
          .find((item) => item.label === "Help")
          .submenu.items.map((item) => item.label)
      };
    });
    expect(applicationMenu.labels).toEqual(["File", "Edit", "View", "Window", "Settings", "Help"]);
    expect(applicationMenu.helpItems).toEqual(["About TetherSSH"]);
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel);
    }, "app:show-about");
    await expect(page.locator("#about-dialog")).toBeVisible();
    await expect(page.locator("#app-version")).toHaveText("0.1.0");
    await expect(page.locator("#about-dialog")).toContainText("Daniel Karlsson");
    await expect(page.locator("#update-status"))
      .toHaveText("Update checks are available in the installed version of TetherSSH.");
    await page.locator("#close-about-button").click();
    await expect(page.locator("#about-dialog")).toBeHidden();
    await app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send("app:update-available", payload);
    }, "0.2.0");
    await expect(page.locator("#about-dialog")).toBeVisible();
    await expect(page.locator("#update-status"))
      .toHaveText("Version 0.2.0 is available and is being downloaded.");
    await page.locator("#close-about-button").click();
    await expect(page.locator("#terminal")).toBeVisible();
    await expect(page.locator("#terminal-title")).toHaveText("not connected");
    await expect(page.locator(".files-pane")).toBeHidden();
    await expect(page.locator("#terminal")).not.toContainText("TetherSSH MVP ready");
    await expect(page.locator("#file-tree")).toBeHidden();
    await expect(page.locator("#file-status")).toHaveText("No file activity");
    await expect(page.locator("#session-log")).toBeVisible();
    await expect(page.locator("#refresh-files")).toHaveCount(0);
    await expect(page.locator("fieldset")).toHaveCount(0);
    await expect(page.locator("#profile-select")).toBeVisible();
    await expect(page.locator("#auth-method")).toHaveValue("auto");
    await expect(page.locator("#private-key-path")).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel);
    }, "app:show-connection-settings");
    await expect(page.locator("#connection-settings-dialog")).toBeVisible();
    await expect(page.locator("#private-key-directory")).toBeVisible();
    await expect(page.locator("#agent-socket")).toBeVisible();

    await page.locator("#private-key-directory").fill(keyDirectory);
    await page.locator("#private-key-directory").dispatchEvent("change");
    await expect(page.locator("#private-key-status")).toHaveText("2 private keys found.");
    await expect(page.locator("#global-private-key-list li")).toHaveCount(2);
    await expect(page.locator("#global-private-key-list li")).toHaveText([
      "id_alpha (OpenSSH)",
      "work-key.ppk (PuTTY)"
    ]);
    await expect(page.locator("#global-private-key-list li", { hasText: "id_alpha.pub" })).toHaveCount(0);
    await expect(page.locator("#global-private-key-list li", { hasText: "notes.txt" })).toHaveCount(0);
    await page.locator("#save-connection-settings").click();
    await expect(page.locator("#connection-settings-dialog")).toBeHidden();

    await page.locator("#target").fill("");
    await page.locator("#target").fill(target);
    await page.locator("#profile-name").fill("Local test server");
    await page.locator("#password").fill(password);
    await page.locator("#remember-password").check();

    await expect(page.locator("#target")).toHaveValue(target);
    await expect(page.locator("#password")).toHaveValue(password);
    await expect(page.locator("#tcp-status")).toContainText("TCP reachable");

    await page.locator("#password").press("Enter");

    await expect(page.locator("#terminal-title")).toHaveText(`Connected to ${user}@${server}`);
    await expect(page.locator("#status")).toHaveText(`Connected to ${user}@${server}`);
    await expect(page.locator(".files-pane")).toBeVisible();
    await expect(page.locator("#system-status")).toBeVisible();
    await expect(page.locator("#system-cpu")).toHaveText(/\d+\.\d%/);
    await expect(page.locator("#system-memory")).toHaveText(/\d+\.\d GiB \/ \d+\.\d GiB/);
    await expect(page.locator("#system-disk")).toContainText("Filesystem");
    await expect(page.locator("body")).toHaveClass(/connection-panel-collapsed/);
    await expect(page.locator("#connection-form")).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const terminal = document.querySelector("#terminal");
      return terminal?.contains(document.activeElement);
    })).toBe(true);

    const clipboardAvailable = await app.evaluate(({ clipboard }) => {
      clipboard.writeText("PASTE_ONCE");
      return clipboard.readText() === "PASTE_ONCE";
    });

    if (clipboardAvailable) {
      await page.keyboard.press("Control+Shift+V");
      await expect(page.locator("#terminal")).toContainText("PASTE_ONCE");
      await expect.poll(() => page.locator("#terminal").textContent().then((text) => {
        return (text.match(/PASTE_ONCE/g) ?? []).length;
      })).toBe(1);
    }

    await page.locator("#toggle-connection-panel").click();
    await expect(page.locator("body")).not.toHaveClass(/connection-panel-collapsed/);
    await expect(page.locator("#connection-form")).toBeVisible();
    await expect(page.locator("#profile-select option", { hasText: "Local test server" })).toHaveCount(1);
    await expect(page.locator("#session-log")).toContainText(/Host key (accepted|verified)/);
    await expect(page.locator("#session-log")).toContainText("SSH authenticated with password");

    const userDataPath = await app.evaluate(({ app }) => app.getPath("userData"));
    const settingsContents = fs.readFileSync(path.join(userDataPath, "settings.json"), "utf8");
    const savedSettings = JSON.parse(settingsContents);
    const knownHostsContents = fs.readFileSync(path.join(userDataPath, "known_hosts"), "utf8");
    expect(settingsContents).not.toContain(password);
    expect(savedSettings.connectionSettings.privateKeyDirectory).toBe(keyDirectory);
    expect(savedSettings.profiles[0]).not.toHaveProperty("privateKeyDirectory");
    expect(savedSettings.profiles[0]).not.toHaveProperty("privateKeyPath");
    expect(savedSettings.profiles[0]).not.toHaveProperty("agentSocket");
    expect(knownHostsContents).toContain("[localhost]:2222");

    await expect(page.locator("#terminal")).not.toContainText("No such file or directory");
    await expect(page.locator("#terminal")).not.toContainText("file://%s%s");
    await expect(page.locator("#terminal")).not.toContainText("TETHERSSH_RC");
    await expect(page.locator("#terminal")).not.toContainText("__tetherssh_emit_cwd");
    await expect(page.locator("#follow-pwd")).toBeChecked();
    await expect(page.locator("#file-tree")).toContainText("projects");
    await expect(page.locator(".file-item-file button", { hasText: "README.txt" })).toBeEnabled();
    await expect(page.locator("#file-summary")).toContainText(/\d+ files?/);
    await expect(page.locator("#file-summary")).toContainText(/\d+ folders?/);
    await expect(page.locator("#file-summary")).toContainText("Total");
    await expect(page.locator(".file-item-file button", { hasText: "README.txt" }).locator(".file-metadata"))
      .toContainText(/^-rw/);
    await expect(page.locator("#file-sort")).toHaveValue("name");
    await page.locator("#file-sort").selectOption("size");
    await expect(page.locator("#file-sort")).toHaveValue("size");
    await page.locator("#sort-direction").click();
    await expect(page.locator("#sort-direction")).toHaveAttribute("aria-label", "Sort descending");

    const readmeStatus = page.locator(".file-item-file button", { hasText: "README.txt" }).locator(".file-edit-status");
    const syncedAt = Date.now();
    await app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send("file:edit-status", payload);
    }, { remotePath: "/home/test/README.txt", status: "editing", message: "Editing README.txt." });
    await expect(readmeStatus).toHaveText("editing");

    await app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send("file:edit-status", payload);
    }, { remotePath: "/home/test/README.txt", status: "synced", message: "Synced README.txt.", timestamp: syncedAt });
    await expect(readmeStatus).toHaveText("editing, synced");
    const expectedSyncTime = await page.evaluate((timestamp) => new Date(timestamp).toLocaleString(), syncedAt);
    await expect(readmeStatus).toHaveAttribute("title", `Last synced: ${expectedSyncTime}`);

    await app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send("file:edit-status", payload);
    }, { remotePath: "/home/test/README.txt", status: "closed", message: "Closed README.txt." });
    await expect(readmeStatus).toHaveText("synced");

    await page.locator(".file-item-file button", { hasText: "README.txt" }).click({ button: "right" });
    await expect(page.locator(".file-context-menu")).toBeVisible();
    await expect(page.locator(".file-context-menu")).toContainText("Download");
    await page.locator("#terminal").click();
    await expect(page.locator(".file-context-menu")).toBeHidden();

    const projectsDirectory = page.locator(".file-item-directory button", { hasText: "projects" }).first();
    const cwdBeforeExpand = await page.locator("#cwd").textContent();
    await projectsDirectory.click();
    await expect(projectsDirectory).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".file-item-directory button", { hasText: "demo" })).toBeVisible();
    await expect(page.locator("#cwd")).toHaveText(cwdBeforeExpand);
    await expect.poll(() => page.evaluate(() => {
      const terminal = document.querySelector("#terminal");
      return terminal?.contains(document.activeElement);
    })).toBe(true);

    await projectsDirectory.click();
    await expect(projectsDirectory).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".file-item-directory button", { hasText: "demo" })).toHaveCount(0);

    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "e2e-upload-input";
      input.type = "file";
      input.hidden = true;
      document.body.append(input);
    });
    await page.locator("#e2e-upload-input").setInputFiles(path.join(appRoot, "package.json"));
    await page.evaluate(() => {
      const input = document.querySelector("#e2e-upload-input");
      const logs = [...document.querySelectorAll(".file-item-directory button")]
        .find((button) => button.textContent.includes("logs"));
      const transfer = new DataTransfer();
      transfer.items.add(input.files[0]);
      logs.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.locator("#file-status")).toHaveText("Uploaded 1 file and 0 folders.");

    const logsDirectory = page.locator(".file-item-directory button", { hasText: "logs" }).first();
    await logsDirectory.click();
    await expect(page.locator(".file-item-file button", { hasText: "package.json" })).toBeVisible();
    await page.evaluate(() => window.tetherTerm.sendTerminalInput("rm -f '/home/test/logs/package.json'\n"));

    await projectsDirectory.dblclick();
    await expect(page.locator("#cwd")).toHaveText(/\/home\/test\/projects/);
    await expect(page.evaluate(() => typeof window.tetherTerm.getPathForFile)).resolves.toBe("function");
    await expect(page.evaluate(() => typeof window.tetherTerm.uploadLocalItems)).resolves.toBe("function");

    await page.locator("#disconnect-button").click();
    await expect(page.locator("#terminal-title")).toHaveText("not connected");
    await expect(page.locator("#cwd")).toHaveText(".");
    await expect(page.locator(".files-pane")).toBeHidden();
    await expect(page.locator("#system-status")).toBeHidden();
    await expect(page.locator("#terminal .xterm-rows")).toHaveText("");

    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(keyDirectory, { recursive: true, force: true });
  }
});

test("shows a friendly authentication failure for a wrong password", async () => {
  const appRoot = path.resolve(__dirname, "..");
  const app = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: { ...process.env, TETHERSSH_TEST_TRUST_HOST_KEYS: "1" }
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
    await page.locator("#target").fill("");
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
