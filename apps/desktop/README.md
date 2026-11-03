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
- A small, explicitly non-published H2b-4 fixture is bundled as a Windows resource. Startup verifies the manifest against a SHA-256 digest compiled into the executable, then verifies the fixture size, SHA-256, and draft metadata before the window is created. This fixture is not the published curriculum.
- The NSIS installer is used for internal QA only; no stable distribution, update mechanism, Authenticode signing, or SmartScreen trust claim is provided.
- The Windows install smoke probe verifies the clean embedded fixture starts, changes one installed lesson byte and requires startup to fail, restores the original bytes, and requires startup to succeed again. This is a fixture-level integrity test, not proof of a complete learner lesson flow.
- The manifest digest is an integrity pin inside the executable, not a digital signature or protection against a replaced/patched executable. Authenticode remains a separate distribution gate.
- Native SQLite, learner progress persistence, full offline lesson execution, and update behavior remain unimplemented.
- No privileged commands, arbitrary filesystem access from the frontend, shell access, or broad Tauri permissions are enabled. The Rust startup verifier reads only the two bundled curriculum fixture resources.
