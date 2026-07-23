import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { PrivateKeyCandidate, PrivateKeyListResult } from "../shared/ipc";

const privateKeyHeaders = [
  { prefix: "-----BEGIN OPENSSH PRIVATE KEY-----", format: "OpenSSH" },
  { prefix: "-----BEGIN RSA PRIVATE KEY-----", format: "RSA PEM" },
  { prefix: "-----BEGIN EC PRIVATE KEY-----", format: "EC PEM" },
  { prefix: "-----BEGIN DSA PRIVATE KEY-----", format: "DSA PEM" },
  { prefix: "-----BEGIN PRIVATE KEY-----", format: "PKCS#8" },
  { prefix: "-----BEGIN ENCRYPTED PRIVATE KEY-----", format: "Encrypted PKCS#8" },
  { prefix: "PuTTY-User-Key-File-", format: "PuTTY" }
] as const;

export async function listPrivateKeys(directory?: string): Promise<PrivateKeyListResult> {
  const selectedDirectory = directory?.trim() || path.join(app.getPath("home"), ".ssh");

  try {
    const entries = await fs.readdir(selectedDirectory, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && !entry.name.toLowerCase().endsWith(".pub"))
      .map((entry) => inspectPrivateKey(selectedDirectory, entry.name)));

    return {
      directory: selectedDirectory,
      keys: candidates
        .filter((candidate): candidate is PrivateKeyCandidate => Boolean(candidate))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { directory: selectedDirectory, keys: [] };
    }

    throw error;
  }
}

async function inspectPrivateKey(directory: string, name: string): Promise<PrivateKeyCandidate | undefined> {
  const keyPath = path.join(directory, name);

  try {
    const handle = await fs.open(keyPath, "r");

    try {
      const buffer = Buffer.alloc(256);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const firstBytes = buffer.subarray(0, bytesRead).toString("utf8").trimStart();
      const detected = privateKeyHeaders.find((header) => firstBytes.startsWith(header.prefix));
      return detected ? { name, path: keyPath, format: detected.format } : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
