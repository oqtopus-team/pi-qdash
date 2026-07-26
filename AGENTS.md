# pi-qdash

pi extension for querying QDash (https://github.com/oqtopus-team/qdash) via `@oqtopus-team/qdash-client`.

## Layout

- `extensions/qdash.ts`: extension entry point (tools, commands, TUI renderers, shared context)
- `extensions/lib/`: extracted helper modules for figure handling, figure analysis, write gates, and other shared logic
- `skills/qdash/`, `skills/qdash-calibration-agent/`, `skills/qdash-two-qubit-calibration-diagnosis/`: skills bundled with the package
- `docs/`: architecture (`ARCHITECTURE.md`), tool reference (`tools.md`), commands (`commands.md`), development guide (`DEVELOPMENT.md`), contributing guide

## Commands

```bash
npm install     # install dependencies
npm run check   # type check (tsc --noEmit); run before committing
```

To try changes locally: `pi -e .` from the repository root.

## Conventions

- Branch strategy: feature branches off `main`, squash-merged via pull request.
- Never commit or push directly to `main`, even for docs or small fixes. If the current branch is `main`, create/switch to a feature branch before editing, committing, or pushing. Use a PR for all changes.
- PR titles must follow Conventional Commits (`feat: ...`, `fix: ...`); they become the commit message on `main` and the changelog entry.
- New tools must be read-only by default; write operations require the approval-gate pattern used by existing tools (`confirmWrite: true` in non-interactive runs).
- Never print secrets (`api_token`, passwords, Cloudflare Access secrets) in tool output; follow the existing redaction helpers.
- When adding or renaming tools or commands, update `docs/tools.md` / `docs/commands.md`.
- When changing contributor setup, fork workflow, local pi testing, or extension-vs-skill design policy, update `docs/DEVELOPMENT.md` and keep this `AGENTS.md` aligned.
- Keep the extension/tool layer focused on safe QDash access, redaction, rendering, and mechanical read-only data extraction. Put domain-specific calibration interpretation, runbooks, thresholds, and known cases in skills so agent behavior can improve without turning tools into hidden decision engines.
- For agentic diagnostics, prefer small read-only helper tools that expose structured evidence (for example Plotly figure summaries), then reference those tools from skills for workflow-specific reasoning.
- Keep `extensions/qdash.ts` as a thin entry point over time. Move pure helpers and safety infrastructure into `extensions/lib/`; later split domain tool registrations into `extensions/tools/` modules as described in `docs/ARCHITECTURE.md`.

## Releases (tagpr)

Releases are fully automated with tagpr:

- Do NOT bump the version in `package.json` or `package-lock.json`.
- Do NOT edit `CHANGELOG.md`.
- Do NOT create or push `v*` tags.

tagpr maintains a release pull request on pushes to `main`; merging it tags the release and the publish workflow releases to npm. To change the bump size, label the release PR with `tagpr:minor` or `tagpr:major`.
