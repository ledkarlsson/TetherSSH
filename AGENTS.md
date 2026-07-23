# Repository Instructions

## Verification

After changing application code, run:

```powershell
npm run test:e2e
```

This project uses Playwright to start the Electron app and verify the basic SSH client flow. If the test cannot be run, explain why and include the exact command that should be run manually.

`npm run test:e2e` starts an Electron GUI process and must be run outside the sandbox with escalated permissions. Running it inside the sandbox can cause `electron.exe` breakpoint crashes and Playwright timeouts.

For documentation-only changes, running the e2e test is optional unless the change affects documented commands, setup, or behavior.
