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

## Windows QA build

The CI workflow builds the Windows executable without creating an installer:

```powershell
cd apps/desktop/src-tauri
tauri build --no-bundle
```

The output is an unsigned internal QA executable. It is not a stable release, is not Authenticode-signed, and must not be distributed to learners. Record and publish its SHA-256 only with the exact artifact that was tested.

## Explicit limitations of this stage

- No native SQLite adapter is connected. `packages/storage-native` remains incomplete.
- No embedded curriculum package is included or verified.
- No installer, update mechanism, Authenticode signing, or SmartScreen trust claim is provided.
- No runtime/tamper acceptance is claimed.
- No privileged commands, filesystem access, shell access, or broad Tauri permissions are enabled.
