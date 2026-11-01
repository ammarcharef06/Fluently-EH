# Fluently API

Hono API for Workers. Account/session routes intentionally return 503 until a trusted identity and email provider is manually approved. No guessed provider, secret or paid plan is configured.

The API validates JWT issuer, audience, algorithm and expiry, derives user identity and roles from a signed server token, and scopes sync writes to that identity. Client-supplied role headers are never trusted.

Database: PostgreSQL through a Hyperdrive binding. Curriculum storage uses an optional bucket binding that remains unconfigured until its billing conditions are verified. Missing bindings fail closed.
