# Contributing

Bug reports are most useful when they include the original provider events, normalized deltas, expected call boundaries, and the provider/SDK version. Remove secrets before attaching fixtures.

Every identity, parsing, or provider regression must include a minimal replay fixture or test. Changes that make correlation more permissive must prove they cannot merge distinct parallel calls.

Run the complete gate before opening a pull request:

```bash
npm run verify
```

Keep runtime dependencies at zero. Provider integrations belong in structural adapters and must not import provider SDKs.
