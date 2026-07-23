import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  timestamp: string;
  level: DiagnosticLevel;
  event: string;
  details?: Record<string, boolean | number | string>;
}

const maximumLogBytes = 1_000_000;
const sensitiveKeyPattern = /password|passphrase|secret|token|credential|terminal|content|host|username|path|socket|key|error|message/i;

export async function logDiagnostic(
  level: DiagnosticLevel,
  event: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const entry: DiagnosticEntry = {
      timestamp: new Date().toISOString(),
      level,
      event: normalizeEventName(event),
      details: sanitizeDetails(details)
    };
    const target = diagnosticLogPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await rotateLogIfNeeded(target);
    await fs.appendFile(target, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("Could not write diagnostic log:", error);
  }
}

export async function readDiagnosticEntries(): Promise<DiagnosticEntry[]> {
  try {
    const text = await fs.readFile(diagnosticLogPath(), "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-1_000)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DiagnosticEntry];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function diagnosticLogPath(): string {
  return path.join(app.getPath("userData"), "logs", "diagnostics.jsonl");
}

async function rotateLogIfNeeded(target: string): Promise<void> {
  try {
    const stats = await fs.stat(target);

    if (stats.size >= maximumLogBytes) {
      await fs.rm(`${target}.previous`, { force: true });
      await fs.rename(target, `${target}.previous`);
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function sanitizeDetails(details: Record<string, unknown> | undefined): Record<string, boolean | number | string> | undefined {
  if (!details) {
    return undefined;
  }

  const sanitized: Record<string, boolean | number | string> = {};

  for (const [key, value] of Object.entries(details)) {
    if (sensitiveKeyPattern.test(key) || value === undefined || value === null) {
      continue;
    }

    if (typeof value === "boolean" || typeof value === "number") {
      sanitized[key] = value;
    } else if (typeof value === "string") {
      sanitized[key] = sanitizeText(value);
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeText(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[local-path]")
    .replace(/\/(?:home|Users|tmp|var)\/[^\s"'<>]+/g, "[path]")
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, "[identity]")
    .slice(0, 500);
}

function normalizeEventName(event: string): string {
  return event.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
