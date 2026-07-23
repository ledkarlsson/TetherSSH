export type AuthenticationMethod = "auto" | "password" | "key" | "agent";

export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMethod: AuthenticationMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  agentSocket?: string;
}

export interface ConnectionProfile {
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

export interface ProfileSecrets {
  password?: string;
  passphrase?: string;
}

export interface GlobalConnectionSettings {
  privateKeyDirectory?: string;
  agentSocket?: string;
}

export interface PrivateKeyCandidate {
  name: string;
  path: string;
  format: string;
}

export interface PrivateKeyListResult {
  directory: string;
  keys: PrivateKeyCandidate[];
}

export interface RemoteFile {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt?: number;
  permissions?: string;
}

export interface FileOperationResult {
  ok: boolean;
  message: string;
  localPath?: string;
}

export interface FileActivity {
  message: string;
  remotePath?: string;
  timestamp?: number;
}

export type FileEditStatusKind = "editing" | "closed" | "uploading" | "synced" | "failed" | "conflict";

export interface FileEditStatus {
  remotePath: string;
  status: FileEditStatusKind;
  message?: string;
  timestamp?: number;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TcpTestResult {
  reachable: boolean;
  message?: string;
}

export interface AppInfo {
  version: string;
}

export interface UpdateCheckResult {
  status: "available" | "current" | "unavailable" | "error";
  message: string;
}

export interface RemoteSystemStatus {
  cpuPercent?: number;
  freeMemory?: string;
  totalMemory?: string;
  diskUsage?: string;
  error?: string;
}

export interface ConnectResult {
  cwd: string;
}

export type ConnectResponse =
  | { ok: true; result: ConnectResult }
  | { ok: false; message: string };

export interface TetherTermApi {
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

export const ipcChannels = {
  getAppInfo: "app:get-info",
  checkForUpdates: "app:check-for-updates",
  showAbout: "app:show-about",
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
