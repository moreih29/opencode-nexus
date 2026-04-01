# Release Checklist

Use this checklist before publishing a new `opencode-nexus` version.

## Preflight

- Confirm plugin entry is `src/index.ts` with default export only.
- Confirm `package.json` points `main`/`exports` to `dist/index.js`.
- Confirm `bun.lock` is up to date.

## Validation

- Run `bun run check`.
- Run `bun run test:e2e`.
- Run `bun run build`.
- Verify phase guard e2e passes (`e2e phase guard passed`).
- Verify system injection e2e passes (`e2e system transform passed`).
- Verify team/stop guardrails e2e pass.

## Packaging

- Ensure publishable files are limited to runtime outputs (`dist/`).
- Verify `README.md` and `opencode.example.json` reflect current behavior.
- Verify `docs/operations.md` reflects current guardrails and tags.

## Post-release

- Tag release in git.
- Publish package.
- Smoke-test installation in a clean OpenCode project using:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus"]
}
```

## Mandatory Gates

- No failing e2e scenario in guardrails, phase transitions, or system injection.
- Task pipeline must block edit tools without active tasks.
- Run phase transitions must reject invalid jumps.
