# Security policy

Report vulnerabilities privately through GitHub's security advisory flow for `Atomics-hub/tool-call-stream`.

Tool arguments are untrusted input. This package reconstructs and parses JSON but never executes a tool, resolves a URL, reads a file, or evaluates code. Consumers must authorize tool names and validate arguments before execution. Configure resource limits appropriate for untrusted streams.
