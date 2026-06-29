import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { SshSession } from "./sshSession";
import { ConnectionConfig, ipcChannels, TerminalSize } from "../shared/ipc";
import { loadConnectionProfile, saveConnectionProfile } from "./settingsStore";

let mainWindow: BrowserWindow | undefined;
let session: SshSession | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "TetherSSH",
    backgroundColor: "#101316",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  session?.disconnect();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.loadConnectionProfile, async () => {
    return loadConnectionProfile();
  });

  ipcMain.handle(ipcChannels.saveConnectionProfile, async (_event, profile) => {
    await saveConnectionProfile(profile);
  });

  ipcMain.handle(ipcChannels.connect, async (_event, config: ConnectionConfig) => {
    session?.disconnect();
    session = new SshSession(config);

    session.on("data", (data) => {
      mainWindow?.webContents.send(ipcChannels.terminalData, data);
    });

    session.on("cwd", (cwd) => {
      mainWindow?.webContents.send(ipcChannels.remoteCwd, cwd);
    });

    session.on("sftpStatus", (status) => {
      mainWindow?.webContents.send(ipcChannels.sftpStatus, status);
    });

    session.on("log", (message) => {
      mainWindow?.webContents.send(ipcChannels.sessionLog, message);
    });

    session.on("error", (error) => {
      mainWindow?.webContents.send(ipcChannels.sessionError, error.message);
    });

    session.on("close", () => {
      mainWindow?.webContents.send(ipcChannels.sessionClosed);
    });

    return session.connect();
  });

  ipcMain.handle(ipcChannels.disconnect, async () => {
    session?.disconnect();
    session = undefined;
  });

  ipcMain.handle(ipcChannels.readDirectory, async (_event, remotePath: string) => {
    if (!session) {
      return [];
    }

    try {
      return await session.readDirectory(remotePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mainWindow?.webContents.send(ipcChannels.sessionLog, `Could not read remote directory: ${message}`);
      return [];
    }
  });

  ipcMain.on(ipcChannels.terminalInput, (_event, data: string) => {
    session?.write(data);
  });

  ipcMain.on(ipcChannels.terminalResize, (_event, size: TerminalSize) => {
    session?.resize(size);
  });
}
