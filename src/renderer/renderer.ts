type XTermTerminal = {
  open(element: HTMLElement): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  resize(cols: number, rows: number): void;
  getSelection(): string;
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

type ConnectResponse =
  | { ok: true; result: { cwd: string } }
  | { ok: false; message: string };

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
const targetInput = requireElement<HTMLInputElement>("#target");
const connectButton = requireElement<HTMLButtonElement>("#connect-button");
const disconnectButton = requireElement<HTMLButtonElement>("#disconnect-button");
const refreshButton = requireElement<HTMLButtonElement>("#refresh-files");
const followPwdCheckbox = requireElement<HTMLInputElement>("#follow-pwd");
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
let transientStatusTimer: number | undefined;
let lastClipboardShortcut = "";
let lastClipboardShortcutAt = 0;

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
terminalElement.addEventListener("keydown", (event) => {
  void handleTerminalClipboardShortcut(event);
}, { capture: true });

void loadSavedConnectionProfile();

form.addEventListener("change", () => {
  const authMode = new FormData(form).get("authMode");
  passwordRow.hidden = authMode !== "password";
  keyRow.hidden = authMode !== "privateKey";
});

targetInput.addEventListener("input", scheduleTcpCheck);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await connect();
});

async function connect(): Promise<void> {
  const config = readConnectionConfig();
  clearSessionLog();
  appendSessionLog("Connect requested.");

  if (!isValidConnectionConfig(config)) {
    setStatus("Use the format user@hostname:port.");
    appendSessionLog("Connect failed: invalid connection target.");
    return;
  }

  setStatus("Connecting...");
  connectButton.disabled = true;

  try {
    await window.tetherTerm.saveConnectionProfile(toConnectionProfile(config));
    appendSessionLog("Saved host, port, and user.");
    const response: ConnectResponse = await window.tetherTerm.connect(config);

    if (!response.ok) {
      connected = false;
      connectButton.disabled = false;
      disconnectButton.disabled = true;
      setStatus(response.message);
      appendSessionLog(`Connect failed: ${response.message}`);
      return;
    }

    connected = true;
    sftpAvailable = true;
    sftpMessage = "";
    disconnectButton.disabled = false;
    currentPath = response.result.cwd;
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

    if (followPwdCheckbox.checked) {
      void refreshFiles(path);
    }
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
    if (!connected) {
      return;
    }

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
  const target = parseConnectionTarget(String(data.get("target") ?? ""));

  return {
    host: target.host,
    port: target.port,
    username: target.username,
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

    setTargetValue(profile);
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

function setTargetValue(profile: ConnectionProfile): void {
  targetInput.value = `${profile.username}@${profile.host}:${profile.port}`;
}

function scheduleTcpCheck(): void {
  window.clearTimeout(tcpCheckTimer);
  setTcpStatus("idle", "Waiting to test TCP reachability");
  tcpCheckTimer = window.setTimeout(() => {
    void runTcpCheck();
  }, 450);
}

async function runTcpCheck(): Promise<void> {
  const target = parseConnectionTarget(targetInput.value);

  if (!target.host || !target.username || !isValidPort(target.port) || !window.tetherTerm) {
    setTcpStatus("idle", "Enter user@hostname:port");
    return;
  }

  const sequence = ++tcpCheckSequence;
  setTcpStatus("checking", "Checking TCP...");

  try {
    const result: TcpTestResult = await window.tetherTerm.testTcpConnection(target.host, target.port);

    if (sequence !== tcpCheckSequence) {
      return;
    }

    if (result.reachable) {
      setTcpStatus("reachable", `\u2713 TCP reachable on ${target.host}:${target.port}`);
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

function parseConnectionTarget(value: string): ConnectionProfile {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf("@");
  const username = atIndex > -1 ? trimmed.slice(0, atIndex).trim() : "";
  const hostAndPort = atIndex > -1 ? trimmed.slice(atIndex + 1).trim() : trimmed;
  const portSeparator = hostAndPort.lastIndexOf(":");
  const hasPort = portSeparator > 0 && portSeparator < hostAndPort.length - 1;
  const host = hasPort ? hostAndPort.slice(0, portSeparator).trim() : hostAndPort.trim();
  const parsedPort = hasPort ? Number(hostAndPort.slice(portSeparator + 1)) : 22;

  return {
    username,
    host,
    port: hasPort ? parsedPort : 22
  };
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isValidConnectionConfig(config: ConnectionConfig): boolean {
  return Boolean(config.username && config.host && isValidPort(config.port));
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
  const nodes: HTMLLIElement[] = [];

  if (currentPath !== "/" && currentPath !== ".") {
    nodes.push(renderDirectoryItem({
      name: "..",
      path: parentRemotePath(currentPath),
      type: "directory",
      size: 0
    }, true));
  }

  if (files.length === 0) {
    if (nodes.length > 0) {
      fileTree.replaceChildren(...nodes);
      return;
    }

    fileTree.replaceChildren(emptyItem("Empty directory"));
    return;
  }

  nodes.push(...files.map((file) => {
    if (file.type === "directory") {
      return renderDirectoryItem(file, false);
    }

    const item = document.createElement("li");
    item.className = `file-item file-item-${file.type}`;

    const button = document.createElement("button");
    button.type = "button";
    button.title = file.path;
    button.disabled = true;
    button.append(fileIcon(file), fileLabel(file.name));

    item.append(button);
    return item;
  }));

  fileTree.replaceChildren(...nodes);
}

function renderDirectoryItem(file: RemoteFile, isParent: boolean): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "file-item file-item-directory";

  const button = document.createElement("button");
  button.type = "button";
  button.title = file.path;
  button.append(fileIcon(file), fileLabel(file.name));
  button.addEventListener("click", () => {
    currentPath = file.path;
    updateCwd(currentPath);
    sendTerminalCd(file.path);
    void refreshFiles(currentPath);
  });

  if (isParent) {
    item.classList.add("file-item-parent");
  }

  item.append(button);
  return item;
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

function sendTerminalCd(path: string): void {
  if (!connected || !window.tetherTerm) {
    return;
  }

  window.tetherTerm.sendTerminalInput(`cd ${shellQuote(path)}\n`);
}

async function handleTerminalClipboardShortcut(event: KeyboardEvent): Promise<void> {
  if (!isTerminalClipboardShortcut(event)) {
    return;
  }

  const key = event.key.toLowerCase();
  const now = Date.now();

  if (lastClipboardShortcut === key && now - lastClipboardShortcutAt < 75) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  lastClipboardShortcut = key;
  lastClipboardShortcutAt = now;

  if (key === "c") {
    event.preventDefault();
    event.stopPropagation();
    await copyTerminalSelection();
    return;
  }

  if (key === "v") {
    event.preventDefault();
    event.stopPropagation();
    await pasteClipboardToTerminal();
  }
}

function isTerminalClipboardShortcut(event: KeyboardEvent): boolean {
  if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey || event.altKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  return key === "c" || key === "v";
}

async function copyTerminalSelection(): Promise<void> {
  const selection = readTerminalSelection();

  if (selection) {
    await window.tetherTerm.writeClipboardText(selection);
    setTransientStatus("Copied terminal selection.");
  } else {
    setTransientStatus("No terminal selection to copy.");
  }
}

async function pasteClipboardToTerminal(): Promise<void> {
  const clipboardText = await window.tetherTerm.readClipboardText();

  if (clipboardText && connected) {
    window.tetherTerm.sendTerminalInput(clipboardText);
  }
}

function readTerminalSelection(): string {
  const xtermSelection = terminal.getSelection();

  if (xtermSelection) {
    return xtermSelection;
  }

  const browserSelection = window.getSelection();

  if (browserSelection?.toString() && selectionIsInsideTerminal(browserSelection)) {
    return browserSelection.toString();
  }

  return "";
}

function selectionIsInsideTerminal(selection: Selection): boolean {
  if (selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  return terminalElement.contains(range.commonAncestorContainer);
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function setTransientStatus(message: string): void {
  window.clearTimeout(transientStatusTimer);
  const previous = statusElement.textContent || "Disconnected";
  setStatus(message);
  transientStatusTimer = window.setTimeout(() => {
    setStatus(previous);
  }, 1_500);
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

function fileIcon(file: RemoteFile): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = `file-icon file-icon-${file.type}`;
  icon.textContent = iconFor(file);
  return icon;
}

function fileLabel(name: string): HTMLSpanElement {
  const label = document.createElement("span");
  label.className = "file-label";
  label.textContent = name;
  return label;
}

function iconFor(file: RemoteFile): string {
  if (file.type === "directory") return "▸";
  if (file.type === "symlink") return "↪";
  return "•";
}

function parentRemotePath(path: string): string {
  if (path === "/" || path === ".") {
    return path;
  }

  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const slashIndex = normalized.lastIndexOf("/");

  if (slashIndex <= 0) {
    return "/";
  }

  return normalized.slice(0, slashIndex);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
