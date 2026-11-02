# @fluently/curriculum-engine

Pure TypeScript curriculum graph and lesson-availability rules.

## Responsibilities

- Validate lesson records against `@fluently/content-schema`.
- Validate lesson identity and prerequisite references.
- Reject duplicate, missing, self-referential, cyclic, or unpublished prerequisite dependencies.
- Expose an immutable curriculum index.
- Determine whether a published lesson is available from a set of prerequisite IDs already satisfied by the caller.

## Boundaries

- This package has no React, browser storage, network, API, database, or platform dependency.
- It does not calculate mastery, assess learners, assign CEFR levels, or infer stage thresholds.
- The caller supplies prerequisite IDs already satisfied by lesson completion or separately approved diagnostic evidence.
- Draft, in-review, approved, and retired lessons are never returned as learner-available lessons.
- This package does not publish content. Human approval and release authorization remain separate gates.
