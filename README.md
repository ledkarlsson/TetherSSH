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

## MVP Milestones

1. Create the desktop app shell.
2. Connect xterm.js to an SSH PTY.
3. Open an SFTP channel on the same SSH connection.
4. Render a remote directory tree.
5. Track remote `cwd` changes from terminal output.
6. Keep the tree focused on the active terminal path.
