# Fluently Desktop — Windows

This directory contains the Tauri 2 desktop shell. It loads the shared learner UI from `apps/web`; it does not fork or duplicate the React application.

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

## Windows local identity and progress storage

- The Rust/Tauri runtime owns one anonymous local learner identity per Windows application data database. On first database open, it creates a cryptographically random UUID v4 and stores it in SQLite table `local_identity`.
- Tauri progress commands derive the learner ID inside Rust. The WebView does not send a learner ID to save, read, or list progress. The save input rejects unknown fields, including a supplied `learnerId`.
- The WebView progress API in `packages/storage-web` calls the narrow Tauri commands when the native bridge is present. On first native use, prior IndexedDB lesson progress is imported once into SQLite in a single transaction and associated with the Rust-owned local identity; failed imports remain retryable. Ordinary web/PWA sessions continue to use IndexedDB.
- SQLite schema v1 is migrated to v2. Existing v1 progress rows are retained; they are not automatically reassigned to the new local identity. Any future account-linking flow must define an explicit, reviewed reconciliation policy.
- Rust tests cover UUID v4 generation and stability, migration preservation, identity-input rejection, learner isolation, upsert behavior, and progress restoration after closing and reopening the file-backed SQLite database.

## Explicit limitations of this stage

- The Windows native progress bridge and local identity do not by themselves provide an anonymous lesson catalog. Production UI access still requires an authenticated session or a valid locally activated curriculum package. The repository currently embeds only a non-published H2b-4 integrity fixture, not the approved learner curriculum; do not treat it as a lesson.
- CI's Windows install/runtime smoke verifies the installer, startup, and embedded-fixture integrity. The Rust file-backed SQLite test proves database persistence across connection close/reopen, but it is not yet an installed-app UI test that completes a lesson, closes the application, restarts it offline, and reads the progress through the UI.
- `packages/storage-native` remains a separate incomplete Capacitor/Android adapter; Windows native SQLite is implemented in `apps/desktop/src-tauri`.
- A small, explicitly non-published H2b-4 fixture is bundled as a Windows resource. Startup verifies the manifest against a SHA-256 digest compiled into the executable, then verifies the fixture size, SHA-256, and draft metadata during startup; the application exits if verification fails.
- The manifest digest is an integrity pin inside the executable, not a digital signature or protection against a replaced/patched executable. Authenticode remains a separate distribution gate.
- The NSIS installer is used for internal QA only; no stable distribution, update mechanism, Authenticode signing, or SmartScreen trust claim is provided.
- No privileged commands, arbitrary filesystem access from the frontend, shell access, or broad Tauri permissions are enabled. The Rust startup verifier reads only the two bundled curriculum fixture resources.
