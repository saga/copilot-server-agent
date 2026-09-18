---
name: commit-helper
description: Write Conventional Commits messages from a diff
---

# Commit Message Helper

When the user asks to write a commit message (usually with a `git diff` in context):

1. Use **Conventional Commits**: `type(scope): subject` (e.g. `feat(server): add SSE subagent events`).
2. Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
3. Subject line: imperative mood, no trailing period, max ~72 chars.
4. If the change is large, add a short body listing the key changes as bullets.
5. Output only the commit message (in a code block), no extra commentary.
