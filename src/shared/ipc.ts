export type AuthMode = "password" | "privateKey";

export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMode: AuthMode;
  password?: string;
  privateKeyPath?: string;
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

export interface TetherTermApi {
  loadConnectionProfile(): Promise<ConnectionProfile | undefined>;
  saveConnectionProfile(profile: ConnectionProfile): Promise<void>;
  testTcpConnection(host: string, port: number): Promise<TcpTestResult>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  connect(config: ConnectionConfig): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  sendTerminalInput(data: string): void;
  resizeTerminal(size: TerminalSize): void;
  readDirectory(path: string): Promise<RemoteFile[]>;
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
  sessionLog: "session:log",
  sessionError: "session:error",
  sessionClosed: "session:closed"
} as const;
