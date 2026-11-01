# Android application shell

This package is the Capacitor wrapper for the learner web app.

- Capacitor is pinned to 8.6.0.
- Android learner data must be stored in app-private SQLite and curriculum assets in the native app-private directory.
- A reviewed curriculum package must be embedded in the APK at release time. Draft content under packages/curriculum/src/drafts is never embedded as published content.
- The existing H2a experiment on phase-1/initial-feasibility is partial because GitHub-hosted runners lacked /dev/kvm. This shell does not change that result.
- H4 is not implemented or proven by this shell.
- H2b/Windows remains deferred by decision.
