import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Client, ClientChannel, ConnectConfig, SFTPWrapper } from "ssh2";
import { ConnectResult, ConnectionConfig, RemoteFile, TerminalSize } from "../shared/ipc";

type SessionEvents = {
  data: [string];
  cwd: [string];
  log: [string];
  sftpStatus: [{ available: boolean; message?: string }];
  error: [Error];
  close: [];
};

export declare interface SshSession {
  on<EventName extends keyof SessionEvents>(
    event: EventName,
    listener: (...args: SessionEvents[EventName]) => void
  ): this;

  emit<EventName extends keyof SessionEvents>(
    event: EventName,
    ...args: SessionEvents[EventName]
  ): boolean;
}

export class SshSession extends EventEmitter {
  private readonly client = new Client();
  private shell?: ClientChannel;
  private sftp?: SFTPWrapper;
  private sftpReady?: Promise<void>;
  private sftpUnavailableMessage?: string;
  private currentCwd = ".";
  private oscBuffer = "";

  constructor(private readonly config: ConnectionConfig) {
    super();
  }

  connect(): Promise<ConnectResult> {
    return new Promise((resolve, reject) => {
      const connectConfig = this.toConnectConfig();
      let settled = false;
      const timeout = setTimeout(() => {
        rejectBeforeShell(new Error("SSH connection timed out before opening a shell."));
        this.disconnect();
      }, 30_000);

      const rejectBeforeShell = (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }

        this.log(`Error: ${error.message}`);
        this.emit("error", error);
      };

      this.log(`Connecting to ${this.config.username}@${this.config.host}:${this.config.port}...`);

      this.client
        .once("ready", () => {
          this.log("SSH authenticated. Opening terminal shell...");
          this.openShell((result) => {
            settled = true;
            clearTimeout(timeout);
            this.log("Terminal shell opened.");
            resolve(result);
            this.openSftp();
          }, rejectBeforeShell);
        })
        .on("keyboard-interactive", (_name, _instructions, _language, prompts, finish) => {
          this.log(`Server requested keyboard-interactive auth (${prompts.length} prompt(s)).`);
          if (this.config.authMode === "password" && this.config.password) {
            finish(prompts.map(() => this.config.password ?? ""));
          } else {
            finish([]);
          }
        })
        .on("error", (error) => {
          rejectBeforeShell(error);
        })
        .on("close", () => this.emit("close"))
        .connect(connectConfig);
    });
  }

  write(data: string): void {
    this.shell?.write(data);
  }

  resize(size: TerminalSize): void {
    this.shell?.setWindow(size.rows, size.cols, 0, 0);
  }

  disconnect(): void {
    this.log("Disconnecting.");
    this.shell?.end();
    this.client.end();
  }

  async readDirectory(remotePath: string): Promise<RemoteFile[]> {
    await this.sftpReady;

    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        resolve([]);
        return;
      }

      this.sftp.readdir(remotePath, (error, items) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(
          items
            .filter((item) => item.filename !== "." && item.filename !== "..")
            .map((item) => ({
              name: item.filename,
              path: joinRemotePath(remotePath, item.filename),
              type: toRemoteFileType(item.longname),
              size: item.attrs.size,
              modifiedAt: item.attrs.mtime ? item.attrs.mtime * 1000 : undefined
            }))
            .sort((a, b) => {
              if (a.type === "directory" && b.type !== "directory") return -1;
              if (a.type !== "directory" && b.type === "directory") return 1;
              return a.name.localeCompare(b.name);
            })
        );
      });
    });
  }

  private toConnectConfig(): ConnectConfig {
    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      readyTimeout: 20_000,
      tryKeyboard: this.config.authMode === "password"
    };

    if (this.config.authMode === "privateKey") {
      if (!this.config.privateKeyPath) {
        throw new Error("Private key path is required.");
      }

      this.log(`Using private key: ${this.config.privateKeyPath}`);
      connectConfig.privateKey = fs.readFileSync(this.config.privateKeyPath);
    } else {
      this.log("Using password auth.");
      connectConfig.password = this.config.password;
    }

    return connectConfig;
  }

  private openSftp(): void {
    this.log("Opening SFTP channel...");
    this.sftpReady = new Promise((resolve) => {
      this.client.sftp((sftpError, sftp) => {
        if (sftpError) {
          this.sftpUnavailableMessage = sftpError.message;
          this.log(`SFTP unavailable: ${sftpError.message}`);
          this.emit("sftpStatus", { available: false, message: sftpError.message });
          this.emit("data", `\r\n[TetherSSH] SFTP unavailable: ${sftpError.message}\r\n`);
          resolve();
          return;
        }

        this.sftp = sftp;
        this.sftpUnavailableMessage = undefined;
        this.log("SFTP channel opened.");
        this.emit("sftpStatus", { available: true });
        resolve();
      });
    });
  }

  private openShell(resolve: (result: ConnectResult) => void, reject: (error: Error) => void): void {
    this.client.shell({ term: "xterm-256color", cols: 100, rows: 30 }, (error, stream) => {
      if (error) {
        this.log(`Could not open terminal shell: ${error.message}`);
        reject(error);
        return;
      }

      this.shell = stream;

      stream.on("data", (chunk: Buffer) => {
        const data = chunk.toString("utf8");
        this.captureOsc7(data);
        this.emit("data", data);
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        this.emit("data", chunk.toString("utf8"));
      });

      stream.on("close", () => this.emit("close"));
      this.installShellIntegration();
      resolve({ cwd: this.currentCwd });
    });
  }

  private installShellIntegration(): void {
    const marker = "printf '\\033]7;file://%s%s\\033\\\\' \"$HOSTNAME\" \"$PWD\"";
    const script = [
      "",
      "if [ -n \"$BASH_VERSION\" ]; then",
      `  export PROMPT_COMMAND='${marker}; '\${PROMPT_COMMAND:-}`,
      "elif [ -n \"$ZSH_VERSION\" ]; then",
      `  precmd() { ${marker}; }`,
      "fi",
      marker,
      ""
    ].join("\n");

    this.shell?.write(script);
  }

  private captureOsc7(data: string): void {
    this.oscBuffer += data;

    const osc7Pattern = /\u001b]7;file:\/\/(?:[^/\u001b]+)?([^\u001b]+)\u001b\\/g;
    let match: RegExpExecArray | null;
    let consumedUntil = 0;

    while ((match = osc7Pattern.exec(this.oscBuffer)) !== null) {
      consumedUntil = osc7Pattern.lastIndex;
      try {
        const cwd = decodeURIComponent(match[1]);
        this.emitCwd(cwd);
      } catch {
        this.emitCwd(match[1]);
      }
    }

    if (consumedUntil > 0) {
      this.oscBuffer = this.oscBuffer.slice(consumedUntil);
      return;
    }

    this.oscBuffer = keepPotentialOscPrefix(this.oscBuffer);
  }

  private emitCwd(cwd: string): void {
    if (cwd === this.currentCwd) {
      return;
    }

    this.currentCwd = cwd;
    this.emit("cwd", cwd);
  }

  private log(message: string): void {
    this.emit("log", message);
  }
}

function joinRemotePath(parent: string, child: string): string {
  if (parent === "/") {
    return `/${child}`;
  }

  return path.posix.join(parent, child);
}

function toRemoteFileType(longname: string): RemoteFile["type"] {
  const marker = longname[0];

  if (marker === "d") return "directory";
  if (marker === "-") return "file";
  if (marker === "l") return "symlink";
  return "other";
}

function keepPotentialOscPrefix(buffer: string): string {
  const oscStart = buffer.lastIndexOf("\u001b]7;");

  if (oscStart >= 0) {
    return buffer.slice(oscStart);
  }

  const escapeStart = buffer.lastIndexOf("\u001b");

  if (escapeStart >= 0) {
    return buffer.slice(escapeStart);
  }

  return "";
}
