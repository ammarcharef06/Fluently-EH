# Fluently Desktop — Windows

This directory contains the first Tauri 2 desktop shell. It loads the existing learner UI from `apps/web`; it does not fork or duplicate the React application.

## Development

From the repository root, after installing the pinned workspace dependencies:

```powershell
npm install --global @tauri-apps/cli@2.12.4
pnpm --filter @fluently/web dev
```

In a second terminal:

```powershell
cd apps/desktop/src-tauri
tauri dev
```

## Windows QA build and install smoke test

On the pinned Windows CI runner, the workflow builds the NSIS setup executable and the application executable:

```powershell
cd apps/desktop/src-tauri
tauri build
```

The NSIS bundle is explicitly configured for `currentUser` installation. CI silently installs it beneath the runner user's `%LOCALAPPDATA%`, launches the installed executable, and requires a live main window titled with `Fluently`. The smoke script records the installer and executable SHA-256 values, size, install path, process ID, and observed window title.

The QA installer and executable are unsigned internal artifacts. They are not stable releases, are not Authenticode-signed, and must not be distributed to learners. The automated smoke test is limited to the hosted Windows runner; it does not establish compatibility across end-user Windows configurations.

## Explicit limitations of this stage

- No native SQLite adapter is connected. `packages/storage-native` remains incomplete.
- No embedded curriculum package is included or verified.
- The NSIS installer is used for internal QA only; no stable distribution, update mechanism, Authenticode signing, or SmartScreen trust claim is provided.
- The install/launch smoke probe does not verify embedded curriculum, checksum/tamper rejection, native SQLite, offline lesson execution, or update behavior.
- No privileged commands, filesystem access, shell access, or broad Tauri permissions are enabled.
