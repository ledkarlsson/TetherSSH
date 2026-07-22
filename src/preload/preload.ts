import { contextBridge, ipcRenderer, webUtils } from "electron";

interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
}

interface ConnectionProfile {
  host: string;
  port: number;
  username: string;
}

interface TerminalSize {
  cols: number;
  rows: number;
}

interface TcpTestResult {
  reachable: boolean;
  message?: string;
}

interface RemoteFile {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt?: number;
  permissions?: string;
}

interface FileOperationResult {
  ok: boolean;
  message: string;
  localPath?: string;
}

interface FileActivity {
  message: string;
  remotePath?: string;
  timestamp?: number;
}

type FileEditStatusKind = "editing" | "closed" | "uploading" | "synced" | "failed" | "conflict";

interface FileEditStatus {
  remotePath: string;
  status: FileEditStatusKind;
  message?: string;
  timestamp?: number;
}

interface ConnectResult {
  cwd: string;
}

type ConnectResponse =
  | { ok: true; result: ConnectResult }
  | { ok: false; message: string };

interface TetherTermApi {
  loadConnectionProfile(): Promise<ConnectionProfile | undefined>;
  saveConnectionProfile(profile: ConnectionProfile): Promise<void>;
  testTcpConnection(host: string, port: number): Promise<TcpTestResult>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  getPathForFile(file: File): string;
  connect(config: ConnectionConfig): Promise<ConnectResponse>;
  disconnect(): Promise<void>;
  sendTerminalInput(data: string): void;
  resizeTerminal(size: TerminalSize): void;
  readDirectory(path: string): Promise<RemoteFile[]>;
  downloadRemoteItem(file: RemoteFile): Promise<FileOperationResult>;
  openRemoteFile(file: RemoteFile): Promise<FileOperationResult>;
  uploadLocalItems(localPaths: string[], remotePath: string): Promise<FileOperationResult>;
  onFileActivity(callback: (activity: FileActivity) => void): () => void;
  onFileEditStatus(callback: (status: FileEditStatus) => void): () => void;
  onTerminalData(callback: (data: string) => void): () => void;
  onRemoteCwd(callback: (path: string) => void): () => void;
  onSftpStatus(callback: (status: { available: boolean; message?: string }) => void): () => void;
  onSessionLog(callback: (message: string) => void): () => void;
  onSessionError(callback: (message: string) => void): () => void;
  onSessionClosed(callback: () => void): () => void;
}

const ipcChannels = {
  loadConnectionProfile: "settings:load-connection-profile",
  saveConnectionProfile: "settings:save-connection-profile",
  testTcpConnection: "network:test-tcp-connection",
  readClipboardText: "clipboard:read-text",
  writeClipboardText: "clipboard:write-text",
  connect: "session:connect",
  disconnect: "session:disconnect",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalData: "terminal:data",
  remoteCwd: "remote:cwd",
  sftpStatus: "sftp:status",
  readDirectory: "sftp:read-directory",
  downloadRemoteItem: "sftp:download-remote-item",
  openRemoteFile: "sftp:open-remote-file",
  uploadLocalItems: "sftp:upload-local-items",
  fileActivity: "file:activity",
  fileEditStatus: "file:edit-status",
  sessionLog: "session:log",
  sessionError: "session:error",
  sessionClosed: "session:closed"
} as const;

const api: TetherTermApi = {
  loadConnectionProfile() {
    return ipcRenderer.invoke(ipcChannels.loadConnectionProfile);
  },

  saveConnectionProfile(profile: ConnectionProfile) {
    return ipcRenderer.invoke(ipcChannels.saveConnectionProfile, profile);
  },

  testTcpConnection(host: string, port: number) {
    return ipcRenderer.invoke(ipcChannels.testTcpConnection, host, port);
  },

  async readClipboardText() {
    return ipcRenderer.invoke(ipcChannels.readClipboardText);
  },

  async writeClipboardText(text: string) {
    return ipcRenderer.invoke(ipcChannels.writeClipboardText, text);
  },

  getPathForFile(file: File) {
    return webUtils.getPathForFile(file);
  },

  connect(config: ConnectionConfig) {
    return ipcRenderer.invoke(ipcChannels.connect, config);
  },

  disconnect() {
    return ipcRenderer.invoke(ipcChannels.disconnect);
  },

  sendTerminalInput(data: string) {
    ipcRenderer.send(ipcChannels.terminalInput, data);
  },

  resizeTerminal(size: TerminalSize) {
    ipcRenderer.send(ipcChannels.terminalResize, size);
  },

  readDirectory(path: string) {
    return ipcRenderer.invoke(ipcChannels.readDirectory, path);
  },

  downloadRemoteItem(file: RemoteFile) {
    return ipcRenderer.invoke(ipcChannels.downloadRemoteItem, file);
  },

  openRemoteFile(file: RemoteFile) {
    return ipcRenderer.invoke(ipcChannels.openRemoteFile, file);
  },

  uploadLocalItems(localPaths: string[], remotePath: string) {
    return ipcRenderer.invoke(ipcChannels.uploadLocalItems, localPaths, remotePath);
  },

  onFileActivity(callback: (activity: FileActivity) => void) {
    return subscribe(ipcChannels.fileActivity, callback);
  },

  onFileEditStatus(callback: (status: FileEditStatus) => void) {
    return subscribe(ipcChannels.fileEditStatus, callback);
  },

  onTerminalData(callback: (data: string) => void) {
    return subscribe(ipcChannels.terminalData, callback);
  },

  onRemoteCwd(callback: (path: string) => void) {
    return subscribe(ipcChannels.remoteCwd, callback);
  },

  onSftpStatus(callback: (status: { available: boolean; message?: string }) => void) {
    return subscribe(ipcChannels.sftpStatus, callback);
  },

  onSessionLog(callback: (message: string) => void) {
    return subscribe(ipcChannels.sessionLog, callback);
  },

  onSessionError(callback: (message: string) => void) {
    return subscribe(ipcChannels.sessionError, callback);
  },

  onSessionClosed(callback: () => void) {
    return subscribe(ipcChannels.sessionClosed, callback);
  }
};

contextBridge.exposeInMainWorld("tetherTerm", api);

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
