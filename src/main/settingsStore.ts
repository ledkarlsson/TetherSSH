import { app, safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConnectionProfile, GlobalConnectionSettings, ProfileSecrets } from "../shared/ipc";

interface LegacyConnectionProfile {
  host?: string;
  port?: number;
  username?: string;
}

interface EncryptedProfileSecrets {
  password?: string;
  passphrase?: string;
}

interface SettingsFile {
  connectionProfile?: LegacyConnectionProfile;
  profiles?: ConnectionProfile[];
  profileSecrets?: Record<string, EncryptedProfileSecrets>;
  connectionSettings?: GlobalConnectionSettings;
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export async function listConnectionProfiles(): Promise<ConnectionProfile[]> {
  const settings = await readSettings();
  const profiles = normalizeProfiles(settings);
  return profiles.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastUsedAt - a.lastUsedAt);
}

export async function saveConnectionProfile(
  profile: ConnectionProfile,
  secrets: ProfileSecrets
): Promise<ConnectionProfile> {
  const settings = await readSettings();
  const normalized = normalizeProfile(profile);
  const existingProfiles = normalizeProfiles(settings);
  const replacedProfileIds = existingProfiles
    .filter((candidate) => candidate.id === normalized.id || sameProfileIdentity(candidate, normalized))
    .map((candidate) => candidate.id);
  const profiles = existingProfiles.filter((candidate) => {
    if (candidate.id === normalized.id) {
      return false;
    }

    return !sameProfileIdentity(candidate, normalized);
  });
  profiles.push(normalized);
  settings.profiles = profiles;
  delete settings.connectionProfile;
  settings.profileSecrets ??= {};

  for (const replacedProfileId of replacedProfileIds) {
    if (replacedProfileId !== normalized.id) {
      delete settings.profileSecrets[replacedProfileId];
    }
  }

  const encryptedSecrets: EncryptedProfileSecrets = {};

  if (normalized.rememberPassword && secrets.password) {
    encryptedSecrets.password = encryptSecret(secrets.password);
  }

  if (normalized.rememberPassphrase && secrets.passphrase) {
    encryptedSecrets.passphrase = encryptSecret(secrets.passphrase);
  }

  if (Object.keys(encryptedSecrets).length > 0) {
    settings.profileSecrets[normalized.id] = encryptedSecrets;
  } else {
    delete settings.profileSecrets[normalized.id];
  }

  await writeSettings(settings);
  return normalized;
}

export async function deleteConnectionProfile(profileId: string): Promise<void> {
  const settings = await readSettings();
  settings.profiles = normalizeProfiles(settings).filter((profile) => profile.id !== profileId);

  if (settings.profileSecrets) {
    delete settings.profileSecrets[profileId];
  }

  await writeSettings(settings);
}

export async function loadProfileSecrets(profileId: string): Promise<ProfileSecrets> {
  const settings = await readSettings();
  const encrypted = settings.profileSecrets?.[profileId];

  if (!encrypted) {
    return {};
  }

  return {
    password: decryptSecret(encrypted.password),
    passphrase: decryptSecret(encrypted.passphrase)
  };
}

export async function loadGlobalConnectionSettings(): Promise<GlobalConnectionSettings> {
  const settings = await readSettings();
  const stored = settings.connectionSettings
    ?? (() => {
      const legacyProfile = settings.profiles?.find((profile) => profile.privateKeyDirectory || profile.agentSocket);
      return {
        privateKeyDirectory: legacyProfile?.privateKeyDirectory,
        agentSocket: legacyProfile?.agentSocket
      };
    })();
  const normalized = normalizeGlobalConnectionSettings(stored);

  if (normalized.privateKeyDirectory && !(await directoryExists(normalized.privateKeyDirectory))) {
    normalized.privateKeyDirectory = path.join(app.getPath("home"), ".ssh");
    settings.connectionSettings = normalized;
    await writeSettings(settings);
  }

  return normalized;
}

export async function saveGlobalConnectionSettings(
  connectionSettings: GlobalConnectionSettings
): Promise<GlobalConnectionSettings> {
  const settings = await readSettings();
  const normalized = normalizeGlobalConnectionSettings(connectionSettings);
  settings.connectionSettings = normalized;
  await writeSettings(settings);
  return normalized;
}

async function readSettings(): Promise<SettingsFile> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8")) as SettingsFile;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeSettings(settings: SettingsFile): Promise<void> {
  const target = settingsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function normalizeProfiles(settings: SettingsFile): ConnectionProfile[] {
  const profiles = (settings.profiles ?? []).map(normalizeProfile);
  const legacy = settings.connectionProfile;

  if (profiles.length > 0 || !legacy?.host || !legacy.username) {
    return profiles;
  }

  const host = legacy.host;
  const username = legacy.username;
  return [normalizeProfile({
    id: randomUUID(),
    name: `${username}@${host}`,
    host,
    port: legacy.port ?? 22,
    username,
    authMethod: "auto",
    favorite: false,
    rememberPassword: false,
    rememberPassphrase: false,
    lastUsedAt: Date.now()
  })];
}

function normalizeProfile(profile: ConnectionProfile): ConnectionProfile {
  const host = profile.host.trim();
  const username = profile.username.trim();

  return {
    id: profile.id || randomUUID(),
    name: profile.name.trim() || `${username}@${host}`,
    host,
    port: Number.isFinite(profile.port) && profile.port > 0 ? profile.port : 22,
    username,
    authMethod: profile.authMethod ?? "auto",
    favorite: Boolean(profile.favorite),
    rememberPassword: Boolean(profile.rememberPassword),
    rememberPassphrase: Boolean(profile.rememberPassphrase),
    lastUsedAt: Number.isFinite(profile.lastUsedAt) ? profile.lastUsedAt : Date.now()
  };
}

function normalizeGlobalConnectionSettings(settings: GlobalConnectionSettings): GlobalConnectionSettings {
  return {
    privateKeyDirectory: settings.privateKeyDirectory?.trim() || undefined,
    agentSocket: settings.agentSocket?.trim() || undefined
  };
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function sameProfileIdentity(a: ConnectionProfile, b: ConnectionProfile): boolean {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) === 0 &&
    a.username === b.username &&
    a.host.localeCompare(b.host, undefined, { sensitivity: "base" }) === 0 &&
    a.port === b.port
  );
}

function encryptSecret(value: string): string {
  if (!secureStorageAvailable()) {
    throw new Error("Secure credential storage is unavailable on this system.");
  }

  return safeStorage.encryptString(value).toString("base64");
}

function decryptSecret(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!secureStorageAvailable()) {
    throw new Error("Secure credential storage is unavailable on this system.");
  }

  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    return false;
  }

  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
