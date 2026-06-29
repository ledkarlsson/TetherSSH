import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { ConnectionProfile } from "../shared/ipc";

interface SettingsFile {
  connectionProfile?: ConnectionProfile;
}

const settingsPath = path.join(app.getPath("userData"), "settings.json");

export async function loadConnectionProfile(): Promise<ConnectionProfile | undefined> {
  try {
    const contents = await fs.readFile(settingsPath, "utf8");
    const settings = JSON.parse(contents) as SettingsFile;
    return normalizeConnectionProfile(settings.connectionProfile);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function saveConnectionProfile(profile: ConnectionProfile): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const settings: SettingsFile = {
    connectionProfile: normalizeConnectionProfile(profile)
  };

  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function normalizeConnectionProfile(profile: ConnectionProfile | undefined): ConnectionProfile | undefined {
  if (!profile || !profile.host || !profile.username) {
    return undefined;
  }

  return {
    host: profile.host.trim(),
    port: Number.isFinite(profile.port) && profile.port > 0 ? profile.port : 22,
    username: profile.username.trim()
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
