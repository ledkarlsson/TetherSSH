import { app, BrowserWindow, dialog } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface HostKeyVerificationResult {
  accepted: boolean;
  fingerprint: string;
  status: "trusted" | "accepted" | "rejected" | "changed";
}

interface KnownHostEntry {
  hosts: string[];
  algorithm: string;
  key: string;
}

export async function verifyHostKey(
  parent: BrowserWindow | undefined,
  host: string,
  port: number,
  key: Buffer
): Promise<HostKeyVerificationResult> {
  const token = hostToken(host, port);
  const fingerprint = fingerprintFor(key);
  const entries = await readKnownHosts();
  const existing = entries.find((entry) => entry.hosts.includes(token));
  const encodedKey = key.toString("base64");

  if (existing?.key === encodedKey) {
    return { accepted: true, fingerprint, status: "trusted" };
  }

  if (process.env.TETHERSSH_TEST_TRUST_HOST_KEYS === "1") {
    await replaceKnownHost(entries, token, key);
    return { accepted: true, fingerprint, status: "accepted" };
  }

  if (existing) {
    await showMessage(parent, {
      type: "error",
      title: "SSH host key changed",
      message: `The host key for ${token} has changed.`,
      detail: `Expected ${fingerprintFor(Buffer.from(existing.key, "base64"))}\nReceived ${fingerprint}\n\nThe connection was blocked. Verify the server before removing its entry from known_hosts.`,
      buttons: ["Close"]
    });
    return { accepted: false, fingerprint, status: "changed" };
  }

  const response = await showMessage(parent, {
    type: "question",
    title: "Trust SSH host?",
    message: `First connection to ${token}`,
    detail: `Host key fingerprint:\n${fingerprint}\n\nOnly continue if this fingerprint matches the server.`,
    buttons: ["Trust and connect", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });

  if (response.response !== 0) {
    return { accepted: false, fingerprint, status: "rejected" };
  }

  await replaceKnownHost(entries, token, key);
  return { accepted: true, fingerprint, status: "accepted" };
}

async function readKnownHosts(): Promise<KnownHostEntry[]> {
  try {
    const contents = await fs.readFile(knownHostsPath(), "utf8");
    return contents.split(/\r?\n/).flatMap(parseKnownHostLine);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function replaceKnownHost(entries: KnownHostEntry[], token: string, key: Buffer): Promise<void> {
  const retained = entries.filter((entry) => !entry.hosts.includes(token));
  retained.push({ hosts: [token], algorithm: keyAlgorithm(key), key: key.toString("base64") });
  const target = knownHostsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    `${retained.map((entry) => `${entry.hosts.join(",")} ${entry.algorithm} ${entry.key}`).join("\n")}\n`,
    "utf8"
  );
}

function parseKnownHostLine(line: string): KnownHostEntry[] {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("|")) {
    return [];
  }

  const [hosts, algorithm, key] = trimmed.split(/\s+/, 3);
  return hosts && algorithm && key ? [{ hosts: hosts.split(","), algorithm, key }] : [];
}

function hostToken(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function keyAlgorithm(key: Buffer): string {
  if (key.length < 4) {
    return "unknown";
  }

  const length = key.readUInt32BE(0);
  return key.subarray(4, 4 + length).toString("utf8") || "unknown";
}

function fingerprintFor(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function knownHostsPath(): string {
  return path.join(app.getPath("userData"), "known_hosts");
}

function showMessage(parent: BrowserWindow | undefined, options: Electron.MessageBoxOptions) {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
