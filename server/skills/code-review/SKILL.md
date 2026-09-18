---
name: code-review
description: Review code for security, performance, style and test coverage
---

# Code Review Guidelines

When reviewing code, always check for:

1. **Security vulnerabilities** — SQL injection, XSS, hardcoded secrets, unsafe shell usage.
2. **Performance issues** — N+1 queries, unnecessary allocations, blocking I/O on hot paths.
3. **Code style** — consistent formatting, naming conventions, error handling.
4. **Test coverage** — are critical paths tested? Suggest missing cases.

Provide specific file/line references and concrete suggested fixes. Be concise.
