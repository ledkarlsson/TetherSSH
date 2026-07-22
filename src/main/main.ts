import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { DownloadSummary, RemoteFileStat, SshSession } from "./sshSession";
import {
  ConnectResponse,
  ConnectionConfig,
  FileEditStatus,
  FileEditStatusKind,
  FileOperationResult,
  ipcChannels,
  RemoteFile,
  TerminalSize
} from "../shared/ipc";
import { loadConnectionProfile, saveConnectionProfile } from "./settingsStore";

let mainWindow: BrowserWindow | undefined;
let session: SshSession | undefined;
type EditWatcher = {
  id: number;
  close(): void;
  editorClosed: boolean;
  localPath: string;
  remotePath: string;
  remoteSnapshot: RemoteFileStat;
  uploadPromise?: Promise<void>;
  uploadTimer?: NodeJS.Timeout;
};

const editWatchers = new Map<string, EditWatcher>();
let nextEditWatcherId = 1;

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
  closeEditWatchers();
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

  ipcMain.handle(ipcChannels.connect, async (_event, config: ConnectionConfig): Promise<ConnectResponse> => {
    closeEditWatchers();
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

    try {
      const result = await session.connect();
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session = undefined;
      return { ok: false, message };
    }
  });

  ipcMain.handle(ipcChannels.disconnect, async () => {
    closeEditWatchers();
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

  ipcMain.handle(ipcChannels.downloadRemoteItem, async (_event, file: RemoteFile): Promise<FileOperationResult> => {
    if (!session || !mainWindow) {
      return { ok: false, message: "No active SSH session." };
    }

    try {
      const localPath = await chooseDownloadPath(file);

      if (!localPath) {
        return { ok: false, message: "Download cancelled." };
      }

      await downloadRemoteItem(file, localPath);
      const message = `Downloaded ${file.name}.`;
      sendToRenderer(ipcChannels.sessionLog, `Downloaded ${file.path} to ${localPath}`);
      sendToRenderer(ipcChannels.fileActivity, { message });
      return { ok: true, message, localPath };
    } catch (error) {
      const message = toErrorMessage(error);
      sendToRenderer(ipcChannels.sessionLog, `Download failed: ${message}`);
      return { ok: false, message };
    }
  });

  ipcMain.handle(ipcChannels.openRemoteFile, async (_event, file: RemoteFile): Promise<FileOperationResult> => {
    if (!session) {
      return { ok: false, message: "No active SSH session." };
    }

    if (file.type !== "file") {
      return { ok: false, message: "Only regular files can be opened for editing." };
    }

    try {
      const localPath = getEditCachePath(file.path);
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      const remoteSnapshot = await session.stat(file.path);
      await session.downloadFile(file.path, localPath);
      const watcherId = watchEditedFile(localPath, file.path, remoteSnapshot);
      sendFileEditStatus(file.path, "editing", `Editing ${file.name}.`);

      try {
        await openLocalFile(localPath, () => finishEditing(file.path, watcherId));
      } catch (error) {
        finishEditing(file.path, watcherId);
        throw error;
      }

      sendToRenderer(ipcChannels.sessionLog, `Opened ${file.path} for editing.`);
      sendToRenderer(ipcChannels.fileActivity, { message: `Editing ${file.name}. Saves upload automatically.`, remotePath: file.path });
      return { ok: true, message: `Opened ${file.name}.`, localPath };
    } catch (error) {
      const message = toErrorMessage(error);
      sendToRenderer(ipcChannels.sessionLog, `Open failed: ${message}`);
      return { ok: false, message };
    }
  });

  ipcMain.on(ipcChannels.terminalInput, (_event, data: string) => {
    session?.write(data);
  });

  ipcMain.on(ipcChannels.terminalResize, (_event, size: TerminalSize) => {
    session?.resize(size);
  });
}

async function chooseDownloadPath(file: RemoteFile): Promise<string | undefined> {
  if (!mainWindow) {
    return undefined;
  }

  if (file.type === "directory") {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Download ${file.name}`,
      defaultPath: app.getPath("downloads"),
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    return path.join(result.filePaths[0], file.name);
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Download ${file.name}`,
    defaultPath: path.join(app.getPath("downloads"), file.name)
  });

  return result.canceled ? undefined : result.filePath;
}

async function downloadRemoteItem(file: RemoteFile, localPath: string): Promise<DownloadSummary> {
  if (!session) {
    throw new Error("No active SSH session.");
  }

  if (file.type === "directory") {
    return session.downloadDirectory(file.path, localPath);
  }

  if (file.type === "file") {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    return session.downloadFile(file.path, localPath);
  }

  throw new Error("Only regular files and directories can be downloaded.");
}

function getEditCachePath(remotePath: string): string {
  const basename = sanitizeLocalName(path.posix.basename(remotePath) || "remote-file");
  const remoteHash = Buffer.from(remotePath, "utf8").toString("base64url");
  return path.join(app.getPath("userData"), "edit-cache", remoteHash, basename);
}

function sanitizeLocalName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function watchEditedFile(localPath: string, remotePath: string, remoteSnapshot: RemoteFileStat): number {
  const previous = editWatchers.get(remotePath);

  if (previous) {
    disposeEditWatcher(previous);
  }

  const id = nextEditWatcherId++;

  const watcher = fs.watch(localPath, () => {
    const existing = editWatchers.get(remotePath);

    if (!existing || existing.id !== id || existing.editorClosed) {
      return;
    }

    if (existing.uploadTimer) {
      clearTimeout(existing.uploadTimer);
    }

    existing.uploadTimer = setTimeout(() => {
      existing.uploadTimer = undefined;
      startWatcherUpload(existing);
    }, 600);
  });

  editWatchers.set(remotePath, {
    id,
    editorClosed: false,
    localPath,
    remotePath,
    remoteSnapshot,
    close() {
      watcher.close();
    }
  });

  return id;
}

function finishEditing(remotePath: string, watcherId: number): void {
  const watcher = editWatchers.get(remotePath);

  if (!watcher || watcher.id !== watcherId || watcher.editorClosed) {
    return;
  }

  watcher.editorClosed = true;
  watcher.close();
  sendFileEditStatus(remotePath, "closed", `Closed ${path.posix.basename(remotePath)}.`);

  if (watcher.uploadTimer) {
    clearTimeout(watcher.uploadTimer);
    watcher.uploadTimer = undefined;
    startWatcherUpload(watcher);
    return;
  }

  removeClosedWatcherWhenIdle(watcher);
}

function startWatcherUpload(watcher: EditWatcher): void {
  if (watcher.uploadPromise) {
    return;
  }

  const uploadPromise = uploadEditedFile(watcher);
  watcher.uploadPromise = uploadPromise;
  void uploadPromise.finally(() => {
    watcher.uploadPromise = undefined;
    removeClosedWatcherWhenIdle(watcher);
  });
}

function removeClosedWatcherWhenIdle(watcher: EditWatcher): void {
  if (!watcher.editorClosed || watcher.uploadTimer || watcher.uploadPromise) {
    return;
  }

  if (editWatchers.get(watcher.remotePath)?.id === watcher.id) {
    editWatchers.delete(watcher.remotePath);
  }
}

async function uploadEditedFile(watcher: EditWatcher): Promise<void> {
  if (!session) {
    return;
  }

  if (editWatchers.get(watcher.remotePath)?.id !== watcher.id) {
    return;
  }

  const { localPath, remotePath } = watcher;

  try {
    sendFileEditStatus(remotePath, "uploading", `Uploading ${path.posix.basename(remotePath)}...`);
    const remoteBeforeUpload = await session.stat(remotePath);

    if (remoteChangedSinceSnapshot(remoteBeforeUpload, watcher.remoteSnapshot)) {
      const message = `Conflict: ${path.posix.basename(remotePath)} changed on the server. Upload paused.`;
      sendToRenderer(ipcChannels.sessionLog, message);
      sendFileEditStatus(remotePath, "conflict", message);
      sendToRenderer(ipcChannels.fileActivity, { message, remotePath });
      return;
    }

    await session.uploadFile(localPath, remotePath);
    watcher.remoteSnapshot = await session.stat(remotePath);
    sendToRenderer(ipcChannels.sessionLog, `Uploaded saved changes to ${remotePath}`);
    sendFileEditStatus(remotePath, "synced", `Synced ${path.posix.basename(remotePath)}.`, Date.now());
    sendToRenderer(ipcChannels.fileActivity, {
      message: `file: ${path.posix.basename(remotePath)} changed 0 seconds ago`,
      remotePath,
      timestamp: Date.now()
    });
  } catch (error) {
    const message = `Upload failed for ${path.posix.basename(remotePath)}: ${toErrorMessage(error)}`;
    sendToRenderer(ipcChannels.sessionLog, `Upload failed for ${remotePath}: ${toErrorMessage(error)}`);
    sendFileEditStatus(remotePath, "failed", message);
    sendToRenderer(ipcChannels.fileActivity, { message, remotePath });
  }
}

function remoteChangedSinceSnapshot(current: RemoteFileStat, snapshot: RemoteFileStat): boolean {
  const sizeChanged = current.size !== snapshot.size;
  const currentModifiedAt = current.modifiedAt ?? 0;
  const snapshotModifiedAt = snapshot.modifiedAt ?? 0;
  const modifiedAtChanged = Math.abs(currentModifiedAt - snapshotModifiedAt) > 1_000;
  return sizeChanged || modifiedAtChanged;
}

function sendFileEditStatus(
  remotePath: string,
  status: FileEditStatusKind,
  message?: string,
  timestamp?: number
): void {
  const payload: FileEditStatus = { remotePath, status, message, timestamp };
  sendToRenderer(ipcChannels.fileEditStatus, payload);
}

function closeEditWatchers(): void {
  for (const watcher of editWatchers.values()) {
    disposeEditWatcher(watcher);
  }

  editWatchers.clear();
}

function disposeEditWatcher(watcher: EditWatcher): void {
  if (watcher.uploadTimer) {
    clearTimeout(watcher.uploadTimer);
  }

  watcher.close();
}

async function openLocalFile(localPath: string, onClosed: () => void): Promise<void> {
  if (await tryOpenWithCode(localPath, onClosed)) {
    return;
  }

  const error = await shell.openPath(localPath);

  if (error) {
    throw new Error(error);
  }
}

async function tryOpenWithCode(localPath: string, onClosed: () => void): Promise<boolean> {
  const codeExecutable = await findCodeExecutable();

  if (!codeExecutable) {
    return false;
  }

  return new Promise((resolve) => {
    const child = spawn(codeExecutable, ["--wait", "-g", localPath], {
      stdio: "ignore"
    });
    let spawned = false;
    let closed = false;

    child.once("error", () => {
      if (spawned && !closed) {
        closed = true;
        onClosed();
      }

      resolve(false);
    });
    child.once("spawn", () => {
      spawned = true;
      child.unref();
      resolve(true);
    });
    child.once("close", () => {
      if (spawned && !closed) {
        closed = true;
        onClosed();
      }
    });
  });
}

async function findCodeExecutable(): Promise<string | undefined> {
  if (process.platform !== "win32") {
    return "code";
  }

  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe") : undefined,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Microsoft VS Code", "Code.exe") : undefined,
    process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Microsoft VS Code", "Code.exe") : undefined
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
