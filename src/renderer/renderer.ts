type XTermTerminal = {
  open(element: HTMLElement): void;
  focus(): void;
  reset(): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  resize(cols: number, rows: number): void;
  getSelection(): string;
};

type AuthenticationMethod = "auto" | "password" | "key" | "agent";

interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMethod: AuthenticationMethod;
  password?: string;
  privateKeyPath?: string;
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

interface ConnectionTarget {
  host: string;
  port: number;
  username: string;
}

interface ProfileSecrets {
  password?: string;
  passphrase?: string;
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

interface TcpTestResult {
  reachable: boolean;
  message?: string;
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

type ConnectResponse =
  | { ok: true; result: { cwd: string } }
  | { ok: false; message: string };

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
type FileSortKey = "name" | "size" | "date";

interface FileEditStatus {
  remotePath: string;
  status: FileEditStatusKind;
  message?: string;
  timestamp?: number;
}

interface FileEditViewState {
  editing: boolean;
  message?: string;
  syncStatus?: Exclude<FileEditStatusKind, "editing" | "closed">;
  syncedAt?: number;
}

const XTerm = (globalThis as unknown as {
  Terminal: new (options: Record<string, unknown>) => XTermTerminal;
}).Terminal;

const terminalElement = requireElement<HTMLDivElement>("#terminal");
const form = requireElement<HTMLFormElement>("#connection-form");
const profileSelect = requireElement<HTMLSelectElement>("#profile-select");
const profileNameInput = requireElement<HTMLInputElement>("#profile-name");
const favoriteProfileCheckbox = requireElement<HTMLInputElement>("#favorite-profile");
const newProfileButton = requireElement<HTMLButtonElement>("#new-profile");
const saveProfileButton = requireElement<HTMLButtonElement>("#save-profile");
const deleteProfileButton = requireElement<HTMLButtonElement>("#delete-profile");
const targetInput = requireElement<HTMLInputElement>("#target");
const passwordInput = requireElement<HTMLInputElement>("#password");
const rememberPasswordCheckbox = requireElement<HTMLInputElement>("#remember-password");
const authMethodSelect = requireElement<HTMLSelectElement>("#auth-method");
const privateKeyDirectoryInput = requireElement<HTMLInputElement>("#private-key-directory");
const privateKeyPathSelect = requireElement<HTMLSelectElement>("#private-key-path");
const browsePrivateKeyDirectoryButton = requireElement<HTMLButtonElement>("#browse-private-key-directory");
const privateKeyStatus = requireElement<HTMLDivElement>("#private-key-status");
const passphraseInput = requireElement<HTMLInputElement>("#passphrase");
const rememberPassphraseCheckbox = requireElement<HTMLInputElement>("#remember-passphrase");
const agentSocketInput = requireElement<HTMLInputElement>("#agent-socket");
const connectButton = requireElement<HTMLButtonElement>("#connect-button");
const disconnectButton = requireElement<HTMLButtonElement>("#disconnect-button");
const toggleConnectionPanelButton = requireElement<HTMLButtonElement>("#toggle-connection-panel");
const followPwdCheckbox = requireElement<HTMLInputElement>("#follow-pwd");
const toggleSessionLogButton = requireElement<HTMLButtonElement>("#toggle-session-log");
const statusElement = requireElement<HTMLDivElement>("#status");
const tcpStatusElement = requireElement<HTMLDivElement>("#tcp-status");
const sessionLog = requireElement<HTMLOListElement>("#session-log");
const terminalTitle = requireElement<HTMLSpanElement>("#terminal-title");
const cwdElement = requireElement<HTMLElement>("#cwd");
const fileTree = requireElement<HTMLOListElement>("#file-tree");
const fileStatus = requireElement<HTMLDivElement>("#file-status");
const fileSummary = requireElement<HTMLDivElement>("#file-summary");
const fileSort = requireElement<HTMLSelectElement>("#file-sort");
const sortDirectionButton = requireElement<HTMLButtonElement>("#sort-direction");
const aboutDialog = requireElement<HTMLDialogElement>("#about-dialog");
const appVersion = requireElement<HTMLElement>("#app-version");
const updateStatus = requireElement<HTMLDivElement>("#update-status");
const closeAboutButton = requireElement<HTMLButtonElement>("#close-about-button");
const systemCpu = requireElement<HTMLElement>("#system-cpu");
const systemMemory = requireElement<HTMLElement>("#system-memory");
const systemDisk = requireElement<HTMLElement>("#system-disk");

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
let latestFileActivity: FileActivity | undefined;
let fileActivityTimer: number | undefined;
let renderedFiles: RemoteFile[] = [];
const fileEditStatuses = new Map<string, FileEditViewState>();
const expandedDirectories = new Set<string>();
const directoryChildren = new Map<string, RemoteFile[]>();
const loadingDirectories = new Set<string>();
const directoryClickTimers = new Map<string, number>();
let fileSortKey: FileSortKey = "name";
let fileSortAscending = true;
let connectionProfiles: ConnectionProfile[] = [];
const fileContextMenu = createFileContextMenu();

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
terminal.onData((data) => {
  if (connected && window.tetherTerm) {
    window.tetherTerm.sendTerminalInput(data);
  }
});

window.addEventListener("resize", resizeTerminal);
window.addEventListener("click", hideFileContextMenu);
window.addEventListener("blur", hideFileContextMenu);
terminalElement.addEventListener("keydown", (event) => {
  void handleTerminalClipboardShortcut(event);
}, { capture: true });

void loadConnectionProfiles();

window.tetherTerm.onShowAbout(() => {
  void showAboutDialog().then(() => runUpdateCheck());
});
closeAboutButton.addEventListener("click", () => {
  aboutDialog.close();
});
aboutDialog.addEventListener("click", (event) => {
  if (event.target === aboutDialog) {
    aboutDialog.close();
  }
});

targetInput.addEventListener("input", scheduleTcpCheck);
profileSelect.addEventListener("change", () => {
  void selectConnectionProfile(profileSelect.value).catch(handleProfileError);
});
newProfileButton.addEventListener("click", createNewProfile);
saveProfileButton.addEventListener("click", () => {
  void saveCurrentProfile(false).catch(handleProfileError);
});
deleteProfileButton.addEventListener("click", () => {
  void deleteCurrentProfile().catch(handleProfileError);
});
authMethodSelect.addEventListener("change", updateAuthenticationFields);
browsePrivateKeyDirectoryButton.addEventListener("click", () => {
  void browsePrivateKeyDirectory().catch(handleProfileError);
});
privateKeyDirectoryInput.addEventListener("change", () => {
  void refreshPrivateKeys(privateKeyDirectoryInput.value).catch(handleProfileError);
});
fileSort.addEventListener("change", () => {
  fileSortKey = fileSort.value as FileSortKey;
  renderFiles(renderedFiles);
  terminal.focus();
});
sortDirectionButton.addEventListener("click", () => {
  fileSortAscending = !fileSortAscending;
  updateSortDirectionButton();
  renderFiles(renderedFiles);
  terminal.focus();
});
fileTree.addEventListener("dragover", handleFileTreeDragOver);
fileTree.addEventListener("dragleave", handleFileTreeDragLeave);
fileTree.addEventListener("drop", (event) => {
  void uploadDroppedItems(event, currentPath);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await connect();
});

async function showAboutDialog(): Promise<void> {
  const info = await window.tetherTerm.getAppInfo();
  appVersion.textContent = info.version;
  updateStatus.textContent = "";
  updateStatus.dataset.status = "";
  aboutDialog.showModal();
}

async function runUpdateCheck(): Promise<void> {
  updateStatus.textContent = "Checking for updates...";
  updateStatus.dataset.status = "checking";

  const result: UpdateCheckResult = await window.tetherTerm.checkForUpdates();
  updateStatus.textContent = result.message;
  updateStatus.dataset.status = result.status;
}

async function connect(): Promise<void> {
  const config = readConnectionConfig();
  clearSessionLog();
  clearFileEditStatuses();
  appendSessionLog("Connect requested.");

  if (!isValidConnectionConfig(config)) {
    setStatus("Use the format user@hostname:port.");
    appendSessionLog("Connect failed: invalid connection target.");
    return;
  }

  setStatus("Connecting...");
  connectButton.disabled = true;

  try {
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
    document.body.classList.remove("disconnected");
    sftpAvailable = true;
    sftpMessage = "";
    disconnectButton.disabled = false;
    currentPath = response.result.cwd;
    updateCwd(currentPath);
    updateTerminalTitle(config);
    setStatus(`Connected to ${config.username}@${config.host}`);
    appendSessionLog("Connected.");
    try {
      await saveCurrentProfile(true);
    } catch (error) {
      appendSessionLog(`Connected, but profile could not be saved: ${toErrorMessage(error)}`);
    }
    setConnectionPanelCollapsed(true);
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
  resetDisconnectedState();
});

toggleConnectionPanelButton.addEventListener("click", () => {
  setConnectionPanelCollapsed(!document.body.classList.contains("connection-panel-collapsed"));
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
    const pathChanged = path !== currentPath;

    if (pathChanged) {
      currentPath = path;
      clearExpandedDirectories();
      updateCwd(path);

      if (path !== loggedRemoteCwd) {
        loggedRemoteCwd = path;
        appendSessionLog(`Remote cwd: ${path}`);
      }
    }

    if (followPwdCheckbox.checked) {
      void refreshFiles(path, { showLoading: false });
    }
  });

  window.tetherTerm.onSftpStatus((status) => {
    sftpAvailable = status.available;
    sftpMessage = status.message ?? "";

    if (!status.available) {
      fileTree.replaceChildren(emptyItem(`SFTP unavailable: ${sftpMessage || "not connected"}`));
    } else {
      void refreshFiles(currentPath, { showLoading: fileTree.childElementCount === 0 });
    }
  });

  window.tetherTerm.onFileActivity((activity) => {
    setFileActivity(activity);
  });

  window.tetherTerm.onFileEditStatus((status) => {
    updateFileEditStatus(status);

    if (renderedFiles.length > 0) {
      renderFiles(renderedFiles);
    }
  });

  window.tetherTerm.onSessionLog((message) => {
    appendSessionLog(message);
  });

  window.tetherTerm.onSystemStatus((status: RemoteSystemStatus) => {
    if (status.error) {
      systemCpu.textContent = "unavailable";
      systemMemory.textContent = "unavailable";
      systemDisk.textContent = status.error;
      return;
    }

    systemCpu.textContent = status.cpuPercent === undefined ? "—" : `${status.cpuPercent.toFixed(1)}%`;
    systemMemory.textContent = status.freeMemory && status.totalMemory
      ? `${status.freeMemory} / ${status.totalMemory}`
      : status.freeMemory ?? "—";
    systemDisk.textContent = status.diskUsage ?? "df -h unavailable";
  });

  window.tetherTerm.onSessionError((message) => {
    setStatus(message);
    appendSessionLog(`Error: ${message}`);
  });

  window.tetherTerm.onSessionClosed(() => {
    if (!connected) {
      return;
    }

    resetDisconnectedState();
    appendSessionLog("Session closed.");
  });
} else {
  setStatus("Preload failed. Check DevTools console.");
  appendSessionLog("Preload API is unavailable.");
}

function readConnectionConfig(): ConnectionConfig {
  const data = new FormData(form);
  const target = parseConnectionTarget(String(data.get("target") ?? ""));

  return {
    host: target.host,
    port: target.port,
    username: target.username,
    authMethod: authMethodSelect.value as AuthenticationMethod,
    password: passwordInput.value,
    privateKeyPath: privateKeyPathSelect.value || undefined,
    passphrase: passphraseInput.value,
    agentSocket: agentSocketInput.value.trim() || undefined
  };
}

async function loadConnectionProfiles(preferredProfileId?: string): Promise<void> {
  if (!window.tetherTerm) {
    return;
  }

  try {
    connectionProfiles = await window.tetherTerm.listConnectionProfiles();
    renderConnectionProfiles();
    const profileId = preferredProfileId ?? connectionProfiles[0]?.id;

    if (!profileId) {
      createNewProfile();
      return;
    }

    profileSelect.value = profileId;
    await selectConnectionProfile(profileId);
    appendSessionLog(`Loaded ${connectionProfiles.length} connection profile${connectionProfiles.length === 1 ? "" : "s"}.`);
  } catch (error) {
    appendSessionLog(`Could not load connection profiles: ${toErrorMessage(error)}`);
  }
}

function currentConnectionProfile(markUsed: boolean): ConnectionProfile {
  const config = readConnectionConfig();
  const requestedName = profileNameInput.value.trim() || `${config.username}@${config.host}`;
  const existing = connectionProfiles.find((profile) => profile.id === profileSelect.value)
    ?? connectionProfiles.find((profile) => (
      profile.name.localeCompare(requestedName, undefined, { sensitivity: "base" }) === 0 &&
      profile.username === config.username &&
      profile.host.localeCompare(config.host, undefined, { sensitivity: "base" }) === 0 &&
      profile.port === config.port
    ));
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: requestedName,
    host: config.host,
    port: config.port,
    username: config.username,
    authMethod: config.authMethod,
    privateKeyDirectory: privateKeyDirectoryInput.value.trim() || undefined,
    privateKeyPath: config.privateKeyPath,
    agentSocket: config.agentSocket,
    favorite: favoriteProfileCheckbox.checked,
    rememberPassword: rememberPasswordCheckbox.checked,
    rememberPassphrase: rememberPassphraseCheckbox.checked,
    lastUsedAt: markUsed ? Date.now() : existing?.lastUsedAt ?? Date.now()
  };
}

function setTargetValue(profile: ConnectionProfile): void {
  targetInput.value = `${profile.username}@${profile.host}:${profile.port}`;
}

function renderConnectionProfiles(): void {
  const options = [new Option("New connection", "")];

  for (const profile of connectionProfiles) {
    const prefix = profile.favorite ? "* " : "";
    options.push(new Option(`${prefix}${profile.name}`, profile.id));
  }

  profileSelect.replaceChildren(...options);
}

async function selectConnectionProfile(profileId: string): Promise<void> {
  if (!profileId) {
    createNewProfile();
    return;
  }

  const profile = connectionProfiles.find((candidate) => candidate.id === profileId);

  if (!profile) {
    return;
  }

  const secrets = await window.tetherTerm.loadProfileSecrets(profile.id);
  profileSelect.value = profile.id;
  profileNameInput.value = profile.name;
  favoriteProfileCheckbox.checked = profile.favorite;
  setTargetValue(profile);
  authMethodSelect.value = profile.authMethod;
  privateKeyDirectoryInput.value = profile.privateKeyDirectory ?? "";
  await refreshPrivateKeys(profile.privateKeyDirectory, profile.privateKeyPath);
  agentSocketInput.value = profile.agentSocket ?? "";
  rememberPasswordCheckbox.checked = profile.rememberPassword;
  rememberPassphraseCheckbox.checked = profile.rememberPassphrase;
  passwordInput.value = secrets.password ?? "";
  passphraseInput.value = secrets.passphrase ?? "";
  deleteProfileButton.disabled = false;
  updateAuthenticationFields();
  scheduleTcpCheck();
}

async function saveCurrentProfile(markUsed: boolean): Promise<void> {
  const config = readConnectionConfig();

  if (!isValidConnectionConfig(config)) {
    throw new Error("Enter a valid connection before saving the profile.");
  }

  const saved = await window.tetherTerm.saveConnectionProfile(currentConnectionProfile(markUsed), {
    password: passwordInput.value,
    passphrase: passphraseInput.value
  });
  await loadConnectionProfiles(saved.id);

  if (!markUsed) {
    setTransientStatus(`Saved profile ${saved.name}.`);
  }
}

async function deleteCurrentProfile(): Promise<void> {
  const profile = connectionProfiles.find((candidate) => candidate.id === profileSelect.value);

  if (!profile || !window.confirm(`Delete profile "${profile.name}"?`)) {
    return;
  }

  await window.tetherTerm.deleteConnectionProfile(profile.id);
  await loadConnectionProfiles();
  setTransientStatus(`Deleted profile ${profile.name}.`);
}

function createNewProfile(): void {
  profileSelect.value = "";
  profileNameInput.value = "";
  favoriteProfileCheckbox.checked = false;
  targetInput.value = "";
  authMethodSelect.value = "auto";
  passwordInput.value = "";
  rememberPasswordCheckbox.checked = false;
  privateKeyDirectoryInput.value = "";
  privateKeyPathSelect.replaceChildren(new Option("No private keys found", ""));
  privateKeyStatus.textContent = "Scanning the default SSH folder...";
  passphraseInput.value = "";
  rememberPassphraseCheckbox.checked = false;
  agentSocketInput.value = "";
  deleteProfileButton.disabled = true;
  updateAuthenticationFields();
  setTcpStatus("idle", "Enter user@hostname:port");
  targetInput.focus();
  void refreshPrivateKeys().catch(handleProfileError);
}

async function browsePrivateKeyDirectory(): Promise<void> {
  const selectedDirectory = await window.tetherTerm.selectPrivateKeyDirectory(
    privateKeyDirectoryInput.value.trim() || undefined
  );

  if (selectedDirectory) {
    await refreshPrivateKeys(selectedDirectory);
  }
}

async function refreshPrivateKeys(directory?: string, preferredPath?: string): Promise<void> {
  privateKeyStatus.textContent = "Scanning for private keys...";
  const result: PrivateKeyListResult = await window.tetherTerm.listPrivateKeys(directory);
  privateKeyDirectoryInput.value = result.directory;
  const options = result.keys.map((key) => new Option(`${key.name} (${key.format})`, key.path));

  if (options.length === 0) {
    options.push(new Option("No private keys found", ""));
  }

  if (preferredPath && !result.keys.some((key) => key.path === preferredPath)) {
    options.push(new Option(`Unavailable: ${preferredPath}`, preferredPath));
  }

  privateKeyPathSelect.replaceChildren(...options);
  privateKeyPathSelect.value = preferredPath && options.some((option) => option.value === preferredPath)
    ? preferredPath
    : result.keys[0]?.path ?? "";
  privateKeyStatus.textContent = `${result.keys.length} private key${result.keys.length === 1 ? "" : "s"} found.`;
}

function updateAuthenticationFields(): void {
  const method = authMethodSelect.value;

  for (const field of Array.from(document.querySelectorAll<HTMLElement>("[data-auth-modes]"))) {
    const modes = field.dataset.authModes?.split(",") ?? [];
    field.hidden = !modes.includes(method);
  }
}

function handleProfileError(error: unknown): void {
  const message = toErrorMessage(error);
  setStatus(message);
  appendSessionLog(`Profile error: ${message}`);
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
  terminalTitle.textContent = "not connected";
}

function resetDisconnectedState(): void {
  connected = false;
  currentPath = ".";
  sftpAvailable = false;
  sftpMessage = "";
  renderedFiles = [];
  latestFileActivity = undefined;
  window.clearTimeout(fileActivityTimer);
  clearExpandedDirectories();
  clearFileEditStatuses();
  terminal.reset();
  updateCwd(".");
  fileTree.replaceChildren();
  fileSummary.textContent = "0 files | 0 folders | Total 0 B";
  fileStatus.textContent = "No file activity";
  systemCpu.textContent = "—";
  systemMemory.textContent = "—";
  systemDisk.textContent = "Connect to view df -h";
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  resetTerminalTitle();
  setConnectionPanelCollapsed(false);
  document.body.classList.add("disconnected");
  setStatus("Disconnected");
  resizeTerminal();
}

function setConnectionPanelCollapsed(collapsed: boolean): void {
  document.body.classList.toggle("connection-panel-collapsed", collapsed);
  toggleConnectionPanelButton.setAttribute("aria-expanded", String(!collapsed));
  toggleConnectionPanelButton.title = collapsed ? "Show connection panel" : "Hide connection panel";
  resizeTerminal();

  if (collapsed) {
    terminal.focus();
  }
}

function parseConnectionTarget(value: string): ConnectionTarget {
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

async function refreshFiles(path: string, options: { showLoading?: boolean } = {}): Promise<void> {
  if (!sftpAvailable) {
    fileTree.replaceChildren(emptyItem(`SFTP unavailable: ${sftpMessage || "not connected"}`));
    return;
  }

  if (options.showLoading ?? fileTree.childElementCount === 0) {
    fileTree.replaceChildren(emptyItem("Loading..."));
  }

  try {
    const files = await window.tetherTerm.readDirectory(path);

    if (path !== currentPath) {
      return;
    }

    renderFiles(files);
    void refreshExpandedDirectories();
  } catch (error) {
    fileTree.replaceChildren(emptyItem(toErrorMessage(error)));
  }
}

function renderFiles(files: RemoteFile[]): void {
  renderedFiles = files;
  updateDirectorySummary(files);
  const nodes: HTMLLIElement[] = [];

  if (currentPath !== "/" && currentPath !== ".") {
    nodes.push(renderParentDirectoryItem({
      name: "..",
      path: parentRemotePath(currentPath),
      type: "directory",
      size: 0
    }));
  }

  if (files.length === 0) {
    if (nodes.length > 0) {
      fileTree.replaceChildren(...nodes);
      return;
    }

    fileTree.replaceChildren(emptyItem("Empty directory"));
    return;
  }

  for (const file of sortFiles(files)) {
    nodes.push(...renderFileTreeEntry(file, 0));
  }

  fileTree.replaceChildren(...nodes);
}

function renderParentDirectoryItem(file: RemoteFile): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "file-item file-item-directory file-item-parent";

  const button = document.createElement("button");
  button.type = "button";
  button.title = file.path;
  button.append(fileIcon(file), fileEntryContent(file));
  button.addEventListener("click", () => {
    enterRemoteDirectory(file.path);
  });
  button.addEventListener("contextmenu", (event) => {
    showFileContextMenu(event, file);
  });

  item.append(button);
  return item;
}

function renderFileTreeEntry(file: RemoteFile, depth: number): HTMLLIElement[] {
  const item = document.createElement("li");
  item.className = `file-item file-item-${file.type}`;

  const button = document.createElement("button");
  button.type = "button";
  button.title = file.path;
  button.style.setProperty("--tree-depth", String(depth));
  button.addEventListener("contextmenu", (event) => {
    showFileContextMenu(event, file);
  });

  if (file.type === "directory") {
    const expanded = expandedDirectories.has(file.path);
    button.setAttribute("aria-expanded", String(expanded));
    button.addEventListener("click", (event) => handleDirectoryClick(event, file));
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      cancelDirectoryClick(file.path);
      enterRemoteDirectory(file.path);
    });
    attachDirectoryDropTarget(button, file.path);
  } else {
    button.addEventListener("click", () => {
      terminal.focus();
      void openRemoteFile(file);
    });
  }

  button.append(fileIcon(file), fileEntryContent(file), fileEditStatusBadge(file.path));
  item.append(button);
  const nodes = [item];

  if (file.type !== "directory" || !expandedDirectories.has(file.path)) {
    return nodes;
  }

  if (loadingDirectories.has(file.path)) {
    nodes.push(treeMessageItem("Loading...", depth + 1));
    return nodes;
  }

  const children = directoryChildren.get(file.path) ?? [];

  if (children.length === 0) {
    nodes.push(treeMessageItem("Empty directory", depth + 1));
    return nodes;
  }

  for (const child of sortFiles(children)) {
    nodes.push(...renderFileTreeEntry(child, depth + 1));
  }

  return nodes;
}

function handleDirectoryClick(event: MouseEvent, file: RemoteFile): void {
  if (event.detail > 1) {
    return;
  }

  cancelDirectoryClick(file.path);
  const timer = window.setTimeout(() => {
    directoryClickTimers.delete(file.path);
    void toggleDirectory(file.path);
    terminal.focus();
  }, 180);
  directoryClickTimers.set(file.path, timer);
}

function cancelDirectoryClick(remotePath: string): void {
  const timer = directoryClickTimers.get(remotePath);

  if (timer !== undefined) {
    window.clearTimeout(timer);
    directoryClickTimers.delete(remotePath);
  }
}

async function toggleDirectory(remotePath: string): Promise<void> {
  if (expandedDirectories.delete(remotePath)) {
    renderFiles(renderedFiles);
    return;
  }

  expandedDirectories.add(remotePath);
  loadingDirectories.add(remotePath);
  renderFiles(renderedFiles);
  await refreshDirectoryChildren(remotePath);
}

async function refreshDirectoryChildren(remotePath: string): Promise<void> {
  try {
    const children = await window.tetherTerm.readDirectory(remotePath);

    if (expandedDirectories.has(remotePath)) {
      directoryChildren.set(remotePath, children);
    }
  } catch (error) {
    appendSessionLog(`Could not expand ${remotePath}: ${toErrorMessage(error)}`);
  } finally {
    loadingDirectories.delete(remotePath);
    renderFiles(renderedFiles);
  }
}

async function refreshExpandedDirectories(): Promise<void> {
  await Promise.all([...expandedDirectories].map((remotePath) => refreshDirectoryChildren(remotePath)));
}

function clearExpandedDirectories(): void {
  for (const timer of directoryClickTimers.values()) {
    window.clearTimeout(timer);
  }

  directoryClickTimers.clear();
  expandedDirectories.clear();
  directoryChildren.clear();
  loadingDirectories.clear();
}

function enterRemoteDirectory(remotePath: string): void {
  currentPath = remotePath;
  clearExpandedDirectories();
  updateCwd(currentPath);
  sendTerminalCd(remotePath);
  void refreshFiles(currentPath);
  terminal.focus();
}

function treeMessageItem(text: string, depth: number): HTMLLIElement {
  const item = emptyItem(text);
  item.classList.add("file-tree-message");
  item.style.setProperty("--tree-depth", String(depth));
  return item;
}

function sortFiles(files: RemoteFile[]): RemoteFile[] {
  return [...files].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;

    let comparison = 0;

    if (fileSortKey === "size") {
      comparison = a.size - b.size;
    } else if (fileSortKey === "date") {
      comparison = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
    } else {
      comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    }

    if (comparison === 0 && fileSortKey !== "name") {
      comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    }

    return fileSortAscending ? comparison : -comparison;
  });
}

function updateSortDirectionButton(): void {
  const direction = fileSortAscending ? "ascending" : "descending";
  sortDirectionButton.textContent = fileSortAscending ? "↑" : "↓";
  sortDirectionButton.title = `Sort ${direction}`;
  sortDirectionButton.setAttribute("aria-label", `Sort ${direction}`);
}

function updateDirectorySummary(files: RemoteFile[]): void {
  const fileCount = files.filter((file) => file.type === "file").length;
  const folderCount = files.filter((file) => file.type === "directory").length;
  const totalSize = files
    .filter((file) => file.type === "file")
    .reduce((total, file) => total + file.size, 0);
  fileSummary.textContent = `${fileCount} file${fileCount === 1 ? "" : "s"} | ${folderCount} folder${folderCount === 1 ? "" : "s"} | Total ${formatBytes(totalSize)}`;
}

function createFileContextMenu(): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "file-context-menu";
  menu.hidden = true;

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.textContent = "Download";
  menu.append(downloadButton);
  document.body.append(menu);

  return menu;
}

function showFileContextMenu(event: MouseEvent, file: RemoteFile): void {
  event.preventDefault();
  event.stopPropagation();

  fileContextMenu.replaceChildren();

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.textContent = "Download";
  downloadButton.addEventListener("click", () => {
    hideFileContextMenu();
    void downloadRemoteItem(file);
  });

  fileContextMenu.append(downloadButton);

  if (file.type === "directory") {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "Open in terminal";
    openButton.addEventListener("click", () => {
      hideFileContextMenu();
      enterRemoteDirectory(file.path);
    });
    fileContextMenu.prepend(openButton);
  }
  fileContextMenu.style.left = `${event.clientX}px`;
  fileContextMenu.style.top = `${event.clientY}px`;
  fileContextMenu.hidden = false;
}

function hideFileContextMenu(): void {
  fileContextMenu.hidden = true;
}

async function downloadRemoteItem(file: RemoteFile): Promise<void> {
  if (!connected || !window.tetherTerm) {
    return;
  }

  appendSessionLog(`Downloading ${file.path}...`);
  const result: FileOperationResult = await window.tetherTerm.downloadRemoteItem(file);
  setTransientStatus(result.message);
  setFileActivity({ message: result.message });

  if (!result.ok) {
    appendSessionLog(`Download failed: ${result.message}`);
  }
}

async function openRemoteFile(file: RemoteFile): Promise<void> {
  if (!connected || !window.tetherTerm || file.type !== "file") {
    return;
  }

  appendSessionLog(`Opening ${file.path}...`);
  terminal.focus();
  const result: FileOperationResult = await window.tetherTerm.openRemoteFile(file);
  setTransientStatus(result.message);

  if (!result.ok) {
    setFileActivity({ message: result.message, remotePath: file.path });
    appendSessionLog(`Open failed: ${result.message}`);
  }
}

function attachDirectoryDropTarget(button: HTMLButtonElement, remotePath: string): void {
  button.addEventListener("dragover", (event) => {
    if (!hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    button.classList.add("file-drop-target");
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });
  button.addEventListener("dragleave", () => {
    button.classList.remove("file-drop-target");
  });
  button.addEventListener("drop", (event) => {
    button.classList.remove("file-drop-target");
    event.stopPropagation();
    void uploadDroppedItems(event, remotePath);
  });
}

function handleFileTreeDragOver(event: DragEvent): void {
  if (!connected || !hasDroppedFiles(event.dataTransfer)) {
    return;
  }

  event.preventDefault();
  fileTree.classList.add("file-tree-drop-target");
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleFileTreeDragLeave(event: DragEvent): void {
  if (event.relatedTarget instanceof Node && fileTree.contains(event.relatedTarget)) {
    return;
  }

  fileTree.classList.remove("file-tree-drop-target");
}

async function uploadDroppedItems(event: DragEvent, remotePath: string): Promise<void> {
  event.preventDefault();
  fileTree.classList.remove("file-tree-drop-target");

  if (!connected || !event.dataTransfer) {
    return;
  }

  const localPaths = Array.from(event.dataTransfer.files)
    .map((file) => window.tetherTerm.getPathForFile(file))
    .filter(Boolean);

  if (localPaths.length === 0) {
    setFileActivity({ message: "No local files found in the drop." });
    return;
  }

  setFileActivity({ message: `Uploading to ${remotePath}...` });
  const result = await window.tetherTerm.uploadLocalItems(localPaths, remotePath);
  setFileActivity({ message: result.message });
  setTransientStatus(result.message);

  if (result.ok) {
    if (remotePath === currentPath) {
      await refreshFiles(currentPath, { showLoading: false });
    } else if (expandedDirectories.has(remotePath)) {
      await refreshDirectoryChildren(remotePath);
    }
  }

  terminal.focus();
}

function hasDroppedFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
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

function setFileActivity(activity: FileActivity): void {
  latestFileActivity = activity;
  renderFileActivity();

  if (fileActivityTimer) {
    window.clearInterval(fileActivityTimer);
    fileActivityTimer = undefined;
  }

  if (activity.timestamp) {
    fileActivityTimer = window.setInterval(renderFileActivity, 1_000);
  }
}

function clearFileEditStatuses(): void {
  fileEditStatuses.clear();
  renderedFiles = [];
}

function renderFileActivity(): void {
  if (!latestFileActivity) {
    fileStatus.textContent = "No file activity";
    return;
  }

  if (latestFileActivity.timestamp && latestFileActivity.remotePath) {
    const fileName = latestFileActivity.remotePath.split("/").pop() || latestFileActivity.remotePath;
    fileStatus.textContent = `file: ${fileName} changed ${formatRelativeSeconds(latestFileActivity.timestamp)} ago`;
    return;
  }

  fileStatus.textContent = latestFileActivity.message;
}

function formatRelativeSeconds(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));

  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
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

function fileEntryContent(file: RemoteFile): HTMLSpanElement {
  const content = document.createElement("span");
  content.className = "file-entry-content";
  content.append(fileLabel(file.name));

  if (file.name !== "..") {
    const metadata = document.createElement("span");
    metadata.className = "file-metadata";
    const permissions = file.permissions ?? "----------";
    const modified = file.modifiedAt ? formatLocalDateTime(file.modifiedAt) : "Unknown date";
    metadata.textContent = `${permissions}  ${formatBytes(file.size)}  ${modified}`;
    content.append(metadata);
  }

  return content;
}

function fileEditStatusBadge(remotePath: string): HTMLSpanElement {
  const badge = document.createElement("span");
  const status = fileEditStatuses.get(remotePath);

  if (!status) {
    badge.className = "file-edit-status file-edit-status-empty";
    badge.setAttribute("aria-hidden", "true");
    return badge;
  }

  const labels = [status.editing ? "editing" : undefined, status.syncStatus].filter(Boolean);

  if (labels.length === 0) {
    badge.className = "file-edit-status file-edit-status-empty";
    badge.setAttribute("aria-hidden", "true");
    return badge;
  }

  badge.className = `file-edit-status file-edit-status-${status.syncStatus ?? "editing"}`;
  badge.textContent = labels.join(", ");
  badge.title = status.syncedAt
    ? `Last synced: ${new Date(status.syncedAt).toLocaleString()}`
    : status.message ?? labels.join(", ");
  return badge;
}

function updateFileEditStatus(status: FileEditStatus): void {
  const current = fileEditStatuses.get(status.remotePath) ?? { editing: false };

  if (status.status === "editing") {
    current.editing = true;
    current.message = status.message;
  } else if (status.status === "closed") {
    current.editing = false;
    current.message = status.message;
  } else {
    current.syncStatus = status.status;
    current.message = status.message;

    if (status.status === "synced" && status.timestamp) {
      current.syncedAt = status.timestamp;
    }
  }

  if (!current.editing && !current.syncStatus) {
    fileEditStatuses.delete(status.remotePath);
  } else {
    fileEditStatuses.set(status.remotePath, current);
  }
}

function iconFor(file: RemoteFile): string {
  if (file.type === "directory") return expandedDirectories.has(file.path) ? "▾" : "▸";
  if (file.type === "symlink") return "↪";
  return "•";
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unitIndex = 0;

  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }

  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatLocalDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
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
