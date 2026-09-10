<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Configurable gameplay values

Any tunable gameplay value must be represented by a seeded/configured Convex
balance entry or domain record, read by server-side gameplay logic, and exposed
through the existing admin editor. Do not add new balance constants only in
client code or a mutation; hardcoded values are allowed only as validated
fallback defaults for missing or malformed configuration.
