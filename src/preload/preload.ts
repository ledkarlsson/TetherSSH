import { contextBridge, ipcRenderer, webUtils } from "electron";

type AuthenticationMethod = "auto" | "password" | "key" | "agent";

interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMethod: AuthenticationMethod;
  password?: string;
  privateKeyPath?: string;
  privateKeyPaths?: string[];
  passphrase?: string;
  agentSocket?: string;
}

interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthenticationMethod;
  privateKeyDirectory?: string;
  privateKeyPath?: string;
  agentSocket?: string;
  favorite: boolean;
  rememberPassword: boolean;
  rememberPassphrase: boolean;
  lastUsedAt: number;
}

interface ProfileSecrets {
  password?: string;
  passphrase?: string;
}

interface GlobalConnectionSettings {
  privateKeyDirectory?: string;
  agentSocket?: string;
}

interface PrivateKeyCandidate {
  name: string;
  path: string;
  format: string;
}

interface PrivateKeyListResult {
  directory: string;
  keys: PrivateKeyCandidate[];
}

interface TerminalSize {
  cols: number;
  rows: number;
}

interface TcpTestResult {
  reachable: boolean;
  message?: string;
}

interface AppInfo {
  version: string;
}

interface UpdateCheckResult {
  status: "available" | "current" | "unavailable" | "error";
  message: string;
}

interface RemoteSystemStatus {
  cpuPercent?: number;
  freeMemory?: string;
  totalMemory?: string;
  diskUsage?: string;
  error?: string;
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
  getAppInfo(): Promise<AppInfo>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  loadGlobalConnectionSettings(): Promise<GlobalConnectionSettings>;
  saveGlobalConnectionSettings(settings: GlobalConnectionSettings): Promise<GlobalConnectionSettings>;
  listConnectionProfiles(): Promise<ConnectionProfile[]>;
  saveConnectionProfile(profile: ConnectionProfile, secrets: ProfileSecrets): Promise<ConnectionProfile>;
  deleteConnectionProfile(profileId: string): Promise<void>;
  loadProfileSecrets(profileId: string): Promise<ProfileSecrets>;
  selectPrivateKeyDirectory(currentDirectory?: string): Promise<string | undefined>;
  listPrivateKeys(directory?: string): Promise<PrivateKeyListResult>;
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
  onShowAbout(callback: () => void): () => void;
  onUpdateAvailable(callback: (version: string) => void): () => void;
  onShowConnectionSettings(callback: () => void): () => void;
  onSystemStatus(callback: (status: RemoteSystemStatus) => void): () => void;
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
  getAppInfo: "app:get-info",
  checkForUpdates: "app:check-for-updates",
  showAbout: "app:show-about",
  updateAvailable: "app:update-available",
  showConnectionSettings: "app:show-connection-settings",
  systemStatus: "system:status",
  loadGlobalConnectionSettings: "settings:load-global-connection-settings",
  saveGlobalConnectionSettings: "settings:save-global-connection-settings",
  listConnectionProfiles: "settings:list-connection-profiles",
  saveConnectionProfile: "settings:save-connection-profile",
  deleteConnectionProfile: "settings:delete-connection-profile",
  loadProfileSecrets: "settings:load-profile-secrets",
  selectPrivateKeyDirectory: "settings:select-private-key-directory",
  listPrivateKeys: "settings:list-private-keys",
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
  getAppInfo() {
    return ipcRenderer.invoke(ipcChannels.getAppInfo);
  },

  checkForUpdates() {
    return ipcRenderer.invoke(ipcChannels.checkForUpdates);
  },

  loadGlobalConnectionSettings() {
    return ipcRenderer.invoke(ipcChannels.loadGlobalConnectionSettings);
  },

  saveGlobalConnectionSettings(settings: GlobalConnectionSettings) {
    return ipcRenderer.invoke(ipcChannels.saveGlobalConnectionSettings, settings);
  },

  listConnectionProfiles() {
    return ipcRenderer.invoke(ipcChannels.listConnectionProfiles);
  },

  saveConnectionProfile(profile: ConnectionProfile, secrets: ProfileSecrets) {
    return ipcRenderer.invoke(ipcChannels.saveConnectionProfile, profile, secrets);
  },

  deleteConnectionProfile(profileId: string) {
    return ipcRenderer.invoke(ipcChannels.deleteConnectionProfile, profileId);
  },

  loadProfileSecrets(profileId: string) {
    return ipcRenderer.invoke(ipcChannels.loadProfileSecrets, profileId);
  },

  selectPrivateKeyDirectory(currentDirectory?: string) {
    return ipcRenderer.invoke(ipcChannels.selectPrivateKeyDirectory, currentDirectory);
  },

  listPrivateKeys(directory?: string) {
    return ipcRenderer.invoke(ipcChannels.listPrivateKeys, directory);
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

  onShowAbout(callback: () => void) {
    return subscribe(ipcChannels.showAbout, callback);
  },

  onUpdateAvailable(callback: (version: string) => void) {
    return subscribe(ipcChannels.updateAvailable, callback);
  },

  onShowConnectionSettings(callback: () => void) {
    return subscribe(ipcChannels.showConnectionSettings, callback);
  },

  onSystemStatus(callback: (status: RemoteSystemStatus) => void) {
    return subscribe(ipcChannels.systemStatus, callback);
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
