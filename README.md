# TetherSSH

TetherSSH is a cross-platform SSH client concept with a terminal and a synchronized remote file tree.

The first goal is a small desktop MVP:

- Connect to a remote host over SSH.
- Show an interactive terminal.
- Show a side-by-side SFTP file tree.
- Keep the file tree in sync with the terminal's current remote directory.

## Early Architecture

- Electron + TypeScript for the desktop shell.
- xterm.js for the terminal UI.
- ssh2 for SSH and SFTP sessions.
- A shell integration marker, such as OSC 7, to detect the remote working directory.

## Development

Install dependencies:

```powershell
npm install
```

Run the app:

```powershell
npm run dev
```

## Automatic updates

The installed Windows version checks the latest GitHub Release shortly after
startup. It downloads a newer NSIS installer in the background and asks before
restarting to install it. Choosing **Later** installs the downloaded update when
the app is next closed.

Each push to `main` or `master` creates a release versioned as
`0.1.<GitHub run number>` together with the update metadata. The portable
executable does not support automatic updates; use the setup executable for an
updatable installation.

## SSH Test Container

Start a local SSH/SFTP test server:

```powershell
docker compose -f docker-compose.ssh-test.yml up --build
```

Connect from TetherSSH with:

- Host: `127.0.0.1`
- Port: `2222`
- User: `test`
- Password: `testpass`

Stop it with:

```powershell
docker compose -f docker-compose.ssh-test.yml down
```

## Completed TODO

- [x] Keep terminal focus when interacting with remote files.
- [x] Expand and collapse directories without entering them.
- [x] Show `ls -lh`-style metadata and sort by name, size, or date.
- [x] Show total file size and file/folder counts for the current directory.
- [x] Format sync timestamps using the computer's locale.
- [x] Remove the stale editing activity message after closing a file.
- [x] Upload files and folders with drag and drop.
- [x] List all detected private SSH keys in a selected folder.

## Connection Security

- Server keys are verified before authentication. First connections show an SHA-256 fingerprint, accepted keys are stored in TetherSSH's `known_hosts` file, and changed keys are blocked.
- Connection profiles support favorites and recent-use ordering. Passwords and key passphrases are optional and are never stored as plain text.
- Remembered secrets use Electron `safeStorage`: Windows DPAPI on Windows and Secret Service/KWallet on Linux. Linux's insecure `basic_text` fallback is rejected.
- Authentication can use automatic discovery, password/keyboard-interactive, an explicitly selected private key with passphrase, or a selected SSH agent socket/Pageant.

## Prioritized Roadmap

The next milestone is to make TetherSSH safe and dependable enough for daily use. Features are listed in recommended implementation order.

1. [x] **SSH host-key verification and `known_hosts` support**
   Show the server fingerprint on first connection, remember accepted keys, and block changed host keys with a clear warning. This closes the most important security gap before connection profiles make frequent reconnects easier.

2. [x] **Connection profiles with secure credential storage**
   Support named profiles, favorites, recent connections, and profile editing. Encrypt passwords and key passphrases with the operating system's credential protection rather than storing them directly in the settings file.

3. [x] **Complete SSH key authentication**
   Add explicit private-key selection, passphrase prompts, agent selection, and clear reporting of which authentication method succeeded. Keep password, agent, and default-key auto-detection as convenient defaults.

4. [ ] **Interactive edit-conflict resolution and atomic saves**
   When a remote file changes during local editing, offer `Reload remote`, `Upload anyway`, and `Save local copy`. Upload through a temporary remote file followed by rename so an interrupted save cannot leave a partially written file.

5. [ ] **Transfer center**
   Show queued, active, completed, and failed uploads/downloads with byte progress, speed, cancel, retry, and overwrite decisions. Keep transfers running independently of file-tree navigation.

6. [ ] **Complete remote file operations**
   Add create file/folder, rename, duplicate, delete with confirmation, move, copy path, and permission editing. Refresh only the affected tree branch after each operation.

7. [ ] **Multiple sessions and terminal tabs**
   Allow several SSH connections at once, each with its own terminal, file tree, working directory, transfers, and edit watchers. Make session switching keyboard-friendly.

8. [ ] **Linux packages and cross-platform release CI**
   Build AppImage and Debian packages alongside the Windows installer and portable executable. Run the Electron e2e suite on both Windows and Linux in GitHub Actions.

9. [ ] **Connection resilience**
   Add configurable keepalive, reconnect with backoff, a visible reconnect state, and restoration of the last remote directory and expanded tree after reconnecting.

10. [ ] **Terminal productivity tools**
    Add terminal search, clickable links, proper fit/resize support through the xterm fit addon, configurable font size, scrollback settings, and common keyboard shortcuts.

11. [ ] **SSH tunnels and port forwarding**
    Support local, remote, and dynamic SOCKS forwarding with saved tunnel definitions per connection profile and visible active/inactive state.

12. [ ] **Release hardening**
    Add application icons, code signing, structured diagnostic logs, and an opt-in way to export a support bundle without credentials or terminal contents. Automatic updates and release notes are now included in the Windows release workflow.
