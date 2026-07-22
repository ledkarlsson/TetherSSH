export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
}

export interface ConnectionProfile {
  host: string;
  port: number;
  username: string;
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

export interface ConnectResult {
  cwd: string;
}

export type ConnectResponse =
  | { ok: true; result: ConnectResult }
  | { ok: false; message: string };

export interface TetherTermApi {
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

export const ipcChannels = {
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
