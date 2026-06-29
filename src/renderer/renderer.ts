type XTermTerminal = {
  open(element: HTMLElement): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  resize(cols: number, rows: number): void;
};

type AuthMode = "password" | "privateKey";

interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMode: AuthMode;
  password?: string;
  privateKeyPath?: string;
}

interface ConnectionProfile {
  host: string;
  port: number;
  username: string;
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
}

const XTerm = (globalThis as unknown as {
  Terminal: new (options: Record<string, unknown>) => XTermTerminal;
}).Terminal;

const terminalElement = requireElement<HTMLDivElement>("#terminal");
const form = requireElement<HTMLFormElement>("#connection-form");
const hostInput = requireElement<HTMLInputElement>("#host");
const portInput = requireElement<HTMLInputElement>("#port");
const usernameInput = requireElement<HTMLInputElement>("#username");
const connectButton = requireElement<HTMLButtonElement>("#connect-button");
const disconnectButton = requireElement<HTMLButtonElement>("#disconnect-button");
const refreshButton = requireElement<HTMLButtonElement>("#refresh-files");
const toggleSessionLogButton = requireElement<HTMLButtonElement>("#toggle-session-log");
const statusElement = requireElement<HTMLDivElement>("#status");
const tcpStatusElement = requireElement<HTMLDivElement>("#tcp-status");
const sessionLog = requireElement<HTMLOListElement>("#session-log");
const terminalTitle = requireElement<HTMLSpanElement>("#terminal-title");
const cwdElement = requireElement<HTMLElement>("#cwd");
const fileTree = requireElement<HTMLOListElement>("#file-tree");
const passwordRow = requireElement<HTMLLabelElement>("#password-row");
const keyRow = requireElement<HTMLLabelElement>("#key-row");

let currentPath = ".";
let connected = false;
let loggedRemoteCwd = ".";
let sftpAvailable = true;
let sftpMessage = "";
let tcpCheckTimer: number | undefined;
let tcpCheckSequence = 0;

const terminal = new XTerm({
  cursorBlink: true,
  fontFamily: "Cascadia Mono, Consolas, monospace",
  fontSize: 13,
  theme: {
    background: "#101316",
    foreground: "#d7dde5",
    cursor: "#f5c84b",
    selectionBackground: "#3c4656"
  }
});

terminal.open(terminalElement);
terminal.write("TetherSSH MVP ready.\r\n");
terminal.onData((data) => {
  if (connected && window.tetherTerm) {
    window.tetherTerm.sendTerminalInput(data);
  }
});

window.addEventListener("resize", resizeTerminal);

void loadSavedConnectionProfile();

form.addEventListener("change", () => {
  const authMode = new FormData(form).get("authMode");
  passwordRow.hidden = authMode !== "password";
  keyRow.hidden = authMode !== "privateKey";
});

hostInput.addEventListener("input", scheduleTcpCheck);
portInput.addEventListener("input", scheduleTcpCheck);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await connect();
});

async function connect(): Promise<void> {
  const config = readConnectionConfig();
  clearSessionLog();
  appendSessionLog("Connect requested.");
  setStatus("Connecting...");
  connectButton.disabled = true;

  try {
    await window.tetherTerm.saveConnectionProfile(toConnectionProfile(config));
    appendSessionLog("Saved host, port, and user.");
    const result = await window.tetherTerm.connect(config);
    connected = true;
    sftpAvailable = true;
    sftpMessage = "";
    disconnectButton.disabled = false;
    currentPath = result.cwd;
    updateCwd(currentPath);
    updateTerminalTitle(config);
    setStatus(`Connected to ${config.username}@${config.host}`);
    appendSessionLog("Connected.");
    await refreshFiles(currentPath);
    resizeTerminal();
  } catch (error) {
    connected = false;
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    const message = toErrorMessage(error);
    setStatus(message);
    appendSessionLog(`Connect failed: ${message}`);
  }
}

disconnectButton.addEventListener("click", async () => {
  await window.tetherTerm.disconnect();
  connected = false;
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  resetTerminalTitle();
  setStatus("Disconnected");
});

refreshButton.addEventListener("click", () => {
  void refreshFiles(currentPath);
});

toggleSessionLogButton.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("session-log-collapsed");
  toggleSessionLogButton.textContent = collapsed ? "Show" : "Hide";
  toggleSessionLogButton.setAttribute("aria-expanded", String(!collapsed));
});

if (window.tetherTerm) {
  window.tetherTerm.onTerminalData((data) => {
    terminal.write(data);
  });

  window.tetherTerm.onRemoteCwd((path) => {
    if (path === currentPath) {
      return;
    }

    currentPath = path;
    updateCwd(path);

    if (path !== loggedRemoteCwd) {
      loggedRemoteCwd = path;
      appendSessionLog(`Remote cwd: ${path}`);
    }

    void refreshFiles(path);
  });

  window.tetherTerm.onSftpStatus((status) => {
    sftpAvailable = status.available;
    sftpMessage = status.message ?? "";

    if (!status.available) {
      fileTree.replaceChildren(emptyItem(`SFTP unavailable: ${sftpMessage || "not connected"}`));
    } else {
      void refreshFiles(currentPath);
    }
  });

  window.tetherTerm.onSessionLog((message) => {
    appendSessionLog(message);
  });

  window.tetherTerm.onSessionError((message) => {
    setStatus(message);
    appendSessionLog(`Error: ${message}`);
  });

  window.tetherTerm.onSessionClosed(() => {
    connected = false;
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    resetTerminalTitle();
    setStatus("Disconnected");
    appendSessionLog("Session closed.");
  });
} else {
  setStatus("Preload failed. Check DevTools console.");
  appendSessionLog("Preload API is unavailable.");
}

function readConnectionConfig(): ConnectionConfig {
  const data = new FormData(form);
  const authMode = data.get("authMode") === "privateKey" ? "privateKey" : "password";

  return {
    host: String(data.get("host") ?? "").trim(),
    port: Number(data.get("port") ?? 22),
    username: String(data.get("username") ?? "").trim(),
    authMode,
    password: String(data.get("password") ?? ""),
    privateKeyPath: String(data.get("privateKeyPath") ?? "").trim()
  };
}

async function loadSavedConnectionProfile(): Promise<void> {
  if (!window.tetherTerm) {
    return;
  }

  try {
    const profile = await window.tetherTerm.loadConnectionProfile();

    if (!profile) {
      return;
    }

    setInputValue("host", profile.host);
    setInputValue("port", String(profile.port));
    setInputValue("username", profile.username);
    appendSessionLog("Loaded saved host, port, and user.");
    scheduleTcpCheck();
  } catch (error) {
    appendSessionLog(`Could not load saved connection: ${toErrorMessage(error)}`);
  }
}

function toConnectionProfile(config: ConnectionConfig): ConnectionProfile {
  return {
    host: config.host,
    port: config.port,
    username: config.username
  };
}

function setInputValue(id: string, value: string): void {
  const input = document.getElementById(id);

  if (input instanceof HTMLInputElement) {
    input.value = value;
  }
}

function scheduleTcpCheck(): void {
  window.clearTimeout(tcpCheckTimer);
  setTcpStatus("idle", "Waiting to test TCP reachability");
  tcpCheckTimer = window.setTimeout(() => {
    void runTcpCheck();
  }, 450);
}

async function runTcpCheck(): Promise<void> {
  const host = hostInput.value.trim();
  const port = Number(portInput.value);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !window.tetherTerm) {
    setTcpStatus("idle", "Enter host and port");
    return;
  }

  const sequence = ++tcpCheckSequence;
  setTcpStatus("checking", "Checking TCP...");

  try {
    const result: TcpTestResult = await window.tetherTerm.testTcpConnection(host, port);

    if (sequence !== tcpCheckSequence) {
      return;
    }

    if (result.reachable) {
      setTcpStatus("reachable", `✓ TCP reachable on ${host}:${port}`);
    } else {
      setTcpStatus("unreachable", result.message ? `TCP not reachable: ${result.message}` : "TCP not reachable");
    }
  } catch (error) {
    if (sequence !== tcpCheckSequence) {
      return;
    }

    setTcpStatus("unreachable", `TCP check failed: ${toErrorMessage(error)}`);
  }
}

function setTcpStatus(state: "idle" | "checking" | "reachable" | "unreachable", message: string): void {
  tcpStatusElement.className = `tcp-status tcp-status-${state}`;
  tcpStatusElement.textContent = message;
}

function updateTerminalTitle(config: ConnectionConfig): void {
  terminalTitle.textContent = `Connected to ${config.username}@${config.host}`;
}

function resetTerminalTitle(): void {
  terminalTitle.textContent = "Terminal";
}

async function refreshFiles(path: string): Promise<void> {
  if (!sftpAvailable) {
    fileTree.replaceChildren(emptyItem(`SFTP unavailable: ${sftpMessage || "not connected"}`));
    return;
  }

  fileTree.replaceChildren(emptyItem("Loading..."));

  try {
    const files = await window.tetherTerm.readDirectory(path);
    renderFiles(files);
  } catch (error) {
    fileTree.replaceChildren(emptyItem(toErrorMessage(error)));
  }
}

function renderFiles(files: RemoteFile[]): void {
  if (files.length === 0) {
    fileTree.replaceChildren(emptyItem("Empty directory"));
    return;
  }

  const nodes = files.map((file) => {
    const item = document.createElement("li");
    item.className = `file-item file-item-${file.type}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${iconFor(file)} ${file.name}`;
    button.title = file.path;

    if (file.type === "directory") {
      button.addEventListener("click", () => {
        currentPath = file.path;
        updateCwd(currentPath);
        void refreshFiles(currentPath);
      });
    } else {
      button.disabled = true;
    }

    item.append(button);
    return item;
  });

  fileTree.replaceChildren(...nodes);
}

function emptyItem(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "file-empty";
  item.textContent = text;
  return item;
}

function updateCwd(path: string): void {
  cwdElement.textContent = path;
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function clearSessionLog(): void {
  loggedRemoteCwd = ".";
  sessionLog.replaceChildren();
}

function appendSessionLog(message: string): void {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString();
  item.textContent = `${time} ${message}`;
  sessionLog.append(item);
  sessionLog.scrollTop = sessionLog.scrollHeight;
}

function resizeTerminal(): void {
  const cols = Math.max(80, Math.floor(terminalElement.clientWidth / 8));
  const rows = Math.max(24, Math.floor(terminalElement.clientHeight / 18));
  terminal.resize(cols, rows);

  if (connected) {
    window.tetherTerm.resizeTerminal({ cols, rows });
  }
}

function iconFor(file: RemoteFile): string {
  if (file.type === "directory") return "[d]";
  if (file.type === "symlink") return "[l]";
  return "[f]";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}
