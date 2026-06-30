import { app, BrowserWindow, clipboard, ipcMain } from "electron";
import net from "node:net";
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

  mainWindow.on("closed", () => {
    mainWindow = undefined;
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

  ipcMain.handle(ipcChannels.testTcpConnection, async (_event, host: string, port: number) => {
    return testTcpConnection(host, port);
  });

  ipcMain.handle(ipcChannels.readClipboardText, async () => {
    return clipboard.readText();
  });

  ipcMain.handle(ipcChannels.writeClipboardText, async (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle(ipcChannels.connect, async (_event, config: ConnectionConfig) => {
    session?.disconnect();
    session = new SshSession(config);

    session.on("data", (data) => {
      sendToRenderer(ipcChannels.terminalData, data);
    });

    session.on("cwd", (cwd) => {
      sendToRenderer(ipcChannels.remoteCwd, cwd);
    });

    session.on("sftpStatus", (status) => {
      sendToRenderer(ipcChannels.sftpStatus, status);
    });

    session.on("log", (message) => {
      sendToRenderer(ipcChannels.sessionLog, message);
    });

    session.on("error", (error) => {
      sendToRenderer(ipcChannels.sessionError, error.message);
    });

    session.on("close", () => {
      sendToRenderer(ipcChannels.sessionClosed);
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
      sendToRenderer(ipcChannels.sessionLog, `Could not read remote directory: ${message}`);
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

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, ...args);
}

function testTcpConnection(host: string, port: number): Promise<{ reachable: boolean; message?: string }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result: { reachable: boolean; message?: string }) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1_500);
    socket.once("connect", () => finish({ reachable: true }));
    socket.once("timeout", () => finish({ reachable: false, message: "Timed out" }));
    socket.once("error", (error) => finish({ reachable: false, message: error.message }));
  });
}
