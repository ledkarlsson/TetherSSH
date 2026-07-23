import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnyAuthMethod, AuthenticationType, Client, ClientChannel, ConnectConfig, SFTPWrapper } from "ssh2";
import { ConnectResult, ConnectionConfig, RemoteFile, TerminalSize } from "../shared/ipc";
import { HostKeyVerificationResult } from "./knownHostsStore";

export interface DownloadSummary {
  files: number;
  folders: number;
}

export interface RemoteFileStat {
  size: number;
  modifiedAt?: number;
}

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
  private lastAuthMethod?: AuthenticationType;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly verifyHostKey: (key: Buffer) => Promise<HostKeyVerificationResult>
  ) {
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
        const userFacingError = toUserFacingConnectionError(error, this.config);

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(userFacingError);
        }

        this.log(`Error: ${userFacingError.message}`);
        this.emit("error", userFacingError);
      };

      this.log(`Connecting to ${this.config.username}@${this.config.host}:${this.config.port}...`);

      this.client
        .once("ready", () => {
          this.log(`SSH authenticated with ${authMethodLabel(this.lastAuthMethod)}. Opening terminal shell...`);
          this.openShell((result) => {
            settled = true;
            clearTimeout(timeout);
            this.log("Terminal shell opened.");
            resolve(result);
            this.openSftp();
          }, rejectBeforeShell);
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
              modifiedAt: item.attrs.mtime ? item.attrs.mtime * 1000 : undefined,
              permissions: item.longname.slice(0, 10)
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

  async downloadFile(remotePath: string, localPath: string): Promise<DownloadSummary> {
    const sftp = await this.requireSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return { files: 1, folders: 0 };
  }

  async downloadDirectory(remotePath: string, localPath: string): Promise<DownloadSummary> {
    await fs.promises.mkdir(localPath, { recursive: true });
    const summary: DownloadSummary = { files: 0, folders: 1 };
    const files = await this.readDirectory(remotePath);

    for (const file of files) {
      const childLocalPath = path.join(localPath, file.name);

      if (file.type === "directory") {
        addDownloadSummary(summary, await this.downloadDirectory(file.path, childLocalPath));
      } else if (file.type === "file") {
        addDownloadSummary(summary, await this.downloadFile(file.path, childLocalPath));
      }
    }

    return summary;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.requireSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async uploadLocalItems(localPaths: string[], remoteDirectory: string): Promise<DownloadSummary> {
    const summary: DownloadSummary = { files: 0, folders: 0 };

    for (const localPath of localPaths) {
      const name = path.basename(localPath);
      await this.uploadLocalEntry(localPath, joinRemotePath(remoteDirectory, name), summary);
    }

    return summary;
  }

  async stat(remotePath: string): Promise<RemoteFileStat> {
    const sftp = await this.requireSftp();

    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (error, stats) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          size: stats.size,
          modifiedAt: stats.mtime ? stats.mtime * 1000 : undefined
        });
      });
    });
  }

  private async uploadLocalEntry(
    localPath: string,
    remotePath: string,
    summary: DownloadSummary
  ): Promise<void> {
    const stats = await fs.promises.stat(localPath);

    if (stats.isDirectory()) {
      await this.ensureRemoteDirectory(remotePath);
      summary.folders += 1;
      const entries = await fs.promises.readdir(localPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          continue;
        }

        await this.uploadLocalEntry(
          path.join(localPath, entry.name),
          joinRemotePath(remotePath, entry.name),
          summary
        );
      }

      return;
    }

    if (stats.isFile()) {
      await this.uploadFile(localPath, remotePath);
      summary.files += 1;
    }
  }

  private async ensureRemoteDirectory(remotePath: string): Promise<void> {
    const sftp = await this.requireSftp();

    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (mkdirError) => {
        if (!mkdirError) {
          resolve();
          return;
        }

        sftp.stat(remotePath, (statError, stats) => {
          if (!statError && stats.isDirectory()) {
            resolve();
            return;
          }

          reject(mkdirError);
        });
      });
    });
  }

  private toConnectConfig(): ConnectConfig {
    const authMethods = this.createAuthenticationMethods();
    let authIndex = 0;
    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      readyTimeout: 20_000,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        void this.verifyHostKey(key)
          .then((result) => {
            if (result.status === "trusted") {
              this.log(`Host key verified: ${result.fingerprint}`);
            } else if (result.status === "accepted") {
              this.log(`Host key accepted and saved to known_hosts: ${result.fingerprint}`);
            } else if (result.status === "changed") {
              this.log(`Host key changed and connection blocked: ${result.fingerprint}`);
            } else {
              this.log("Host key was not trusted. Connection cancelled.");
            }

            verify(result.accepted);
          })
          .catch((error) => {
            this.log(`Host key verification failed: ${toErrorMessage(error)}`);
            verify(false);
          });
      },
      authHandler: (authsLeft, _partialSuccess, next) => {
        while (authIndex < authMethods.length) {
          const method = authMethods[authIndex++];

          if (authsLeft && !authsLeft.includes(method.type)) {
            continue;
          }

          this.lastAuthMethod = method.type;
          this.log(`Trying ${authMethodLabel(method.type)} authentication...`);
          next(method);
          return;
        }

        next(false as unknown as AuthenticationType);
      }
    };

    return connectConfig;
  }

  private createAuthenticationMethods(): AnyAuthMethod[] {
    const methods: AnyAuthMethod[] = [];
    const username = this.config.username;
    const mode = this.config.authMethod;
    const passwordEnabled = mode === "auto" || mode === "password";
    const keyEnabled = mode === "auto" || mode === "key";
    const agentEnabled = mode === "auto" || mode === "agent";

    if (passwordEnabled && this.config.password) {
      methods.push({ type: "password", username, password: this.config.password });
    }

    if (keyEnabled) {
      let privateKey: { path: string; content: Buffer } | undefined;

      if (this.config.privateKeyPath) {
        try {
          privateKey = readPrivateKey(this.config.privateKeyPath);
        } catch (error) {
          if (mode === "key") {
            throw error;
          }

          this.log(`${toErrorMessage(error)}. Skipping it in Auto mode.`);
        }
      } else if (mode === "auto") {
        privateKey = readDefaultPrivateKey();
      }

      if (privateKey) {
        this.log(`Private key auth available: ${privateKey.path}`);
        methods.push({
          type: "publickey",
          username,
          key: privateKey.content,
          passphrase: this.config.passphrase || undefined
        });
      } else if (mode === "key") {
        throw new Error("Select a readable SSH private key before connecting.");
      }
    }

    if (agentEnabled) {
      const agent = this.config.agentSocket || defaultAgentSocket();

      if (agent) {
        this.log(`SSH agent auth available: ${agent}`);
        methods.push({ type: "agent", username, agent });
      } else if (mode === "agent") {
        throw new Error("No SSH agent was found. Enter an agent socket or start an SSH agent.");
      }
    }

    if (passwordEnabled && this.config.password) {
      methods.push({
        type: "keyboard-interactive",
        username,
        prompt: (_name, _instructions, _language, prompts, finish) => {
          this.log(`Server requested keyboard-interactive auth (${prompts.length} prompt(s)).`);
          finish(prompts.map(() => this.config.password ?? ""));
        }
      });
    }

    if (methods.length === 0) {
      throw new Error("No usable authentication method is configured.");
    }

    return methods;
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
    this.client.exec(this.createShellWrapperCommand(), { pty: { term: "xterm-256color", cols: 100, rows: 30 } }, (error, stream) => {
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
      resolve({ cwd: this.currentCwd });
    });
  }

  private createShellWrapperCommand(): string {
    const rcFile = [
      "if [ -n \"$TETHERSSH_RC\" ]; then",
      "  rm -f \"$TETHERSSH_RC\"",
      "  unset TETHERSSH_RC",
      "fi",
      "if [ -f \"$HOME/.bashrc\" ]; then",
      "  . \"$HOME/.bashrc\"",
      "fi",
      "__tetherssh_emit_cwd() {",
      "  printf '\\033]7;file://%s%s\\033\\\\' \"$HOSTNAME\" \"$PWD\"",
      "}",
      "if [ -n \"$PROMPT_COMMAND\" ]; then",
      "  PROMPT_COMMAND=\"__tetherssh_emit_cwd; $PROMPT_COMMAND\"",
      "else",
      "  PROMPT_COMMAND=\"__tetherssh_emit_cwd\"",
      "fi",
      "__tetherssh_emit_cwd"
    ].join("\n");
    const encodedRcFile = Buffer.from(rcFile, "utf8").toString("base64");

    return [
      "TETHERSSH_RC=$(mktemp -t tetherssh.XXXXXX)",
      `printf %s ${encodedRcFile} | base64 -d > "$TETHERSSH_RC"`,
      "export TETHERSSH_RC",
      "exec bash --rcfile \"$TETHERSSH_RC\" -i"
    ].join(" && ");
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
    this.currentCwd = cwd;
    this.emit("cwd", cwd);
  }

  private log(message: string): void {
    this.emit("log", message);
  }

  private async requireSftp(): Promise<SFTPWrapper> {
    await this.sftpReady;

    if (!this.sftp) {
      throw new Error(this.sftpUnavailableMessage || "SFTP is not connected.");
    }

    return this.sftp;
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

function toUserFacingConnectionError(error: Error, _config: ConnectionConfig): Error {
  if (/Host denied|verification failed/i.test(error.message)) {
    return new Error("SSH host key verification failed. Check the host fingerprint and known_hosts entry.");
  }

  if (isAuthenticationError(error)) {
    return new Error("Authentication failed. Check username, password, SSH agent, or key.");
  }

  return error;
}

function isAuthenticationError(error: Error): boolean {
  const errorWithLevel = error as Error & { level?: string };

  return (
    errorWithLevel.level === "client-authentication" ||
    error.message === "All configured authentication methods failed"
  );
}

function readDefaultPrivateKey(): { path: string; content: Buffer } | undefined {
  const sshDirectory = path.join(os.homedir(), ".ssh");
  const keyNames = ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"];

  for (const keyName of keyNames) {
    const keyPath = path.join(sshDirectory, keyName);

    try {
      return {
        path: keyPath,
        content: fs.readFileSync(keyPath)
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function readPrivateKey(keyPath: string): { path: string; content: Buffer } {
  try {
    return { path: keyPath, content: fs.readFileSync(keyPath) };
  } catch {
    throw new Error(`Could not read private key: ${keyPath}`);
  }
}

function defaultAgentSocket(): string | undefined {
  return process.env.SSH_AUTH_SOCK || (process.platform === "win32" ? "pageant" : undefined);
}

function authMethodLabel(method: AuthenticationType | undefined): string {
  if (method === "publickey") return "private key";
  if (method === "keyboard-interactive") return "keyboard-interactive";
  return method ?? "SSH";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addDownloadSummary(target: DownloadSummary, addition: DownloadSummary): void {
  target.files += addition.files;
  target.folders += addition.folders;
}
