# pi-qdash

pi extension for querying QDash (https://github.com/oqtopus-team/qdash) via `@oqtopus-team/qdash-client`.

## Layout

- `extensions/qdash.ts`: the entire extension (tools, commands, TUI renderers)
- `skills/qdash/`, `skills/qdash-calibration-agent/`, `skills/qdash-two-qubit-calibration-diagnosis/`: skills bundled with the package
- `docs/`: tool reference (`tools.md`), commands (`commands.md`), contributing guide

## Commands

```bash
npm install     # install dependencies
npm run check   # type check (tsc --noEmit); run before committing
```

To try changes locally: `pi -e .` from the repository root.

## Conventions

- Branch strategy: feature branches off `main`, squash-merged via pull request.
- PR titles must follow Conventional Commits (`feat: ...`, `fix: ...`); they become the commit message on `main` and the changelog entry.
- New tools must be read-only by default; write operations require the approval-gate pattern used by existing tools (`confirmWrite: true` in non-interactive runs).
- Never print secrets (`api_token`, passwords, Cloudflare Access secrets) in tool output; follow the existing redaction helpers.
- When adding or renaming tools or commands, update `docs/tools.md` / `docs/commands.md`.
- Keep the extension/tool layer focused on safe QDash access, redaction, rendering, and mechanical read-only data extraction. Put domain-specific calibration interpretation, runbooks, thresholds, and known cases in skills so agent behavior can improve without turning tools into hidden decision engines.
- For agentic diagnostics, prefer small read-only helper tools that expose structured evidence (for example Plotly figure summaries), then reference those tools from skills for workflow-specific reasoning.

## Releases (tagpr)

Releases are fully automated with tagpr:

- Do NOT bump the version in `package.json` or `package-lock.json`.
- Do NOT edit `CHANGELOG.md`.
- Do NOT create or push `v*` tags.

tagpr maintains a release pull request on pushes to `main`; merging it tags the release and the publish workflow releases to npm. To change the bump size, label the release PR with `tagpr:minor` or `tagpr:major`.
