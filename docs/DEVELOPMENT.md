# Development Guide

This guide is for researchers and contributors who want to fork `pi-qdash`, develop locally, and test changes with pi.

## Prerequisites

- Node.js and npm
- GitHub account with a fork of this repository
- pi coding agent installed and authenticated
- Access to a QDash instance through either:
  - `QDASH_*` environment variables, or
  - `~/.config/qdash/config.ini` / `$XDG_CONFIG_HOME/qdash/config.ini`

Install or update pi:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi update
```

Install the published extension for normal use:

```bash
pi install npm:@oqtopus-team/pi-qdash
```

Update installed extensions:

```bash
pi update --extensions
```

## Fork-based development flow

1. Fork the repository on GitHub.
2. Clone your fork and add upstream:

```bash
git clone https://github.com/<your-user>/pi-qdash.git
cd pi-qdash
git remote add upstream https://github.com/oqtopus-team/pi-qdash.git
```

3. Create a feature branch from the latest `main`:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch -c feat/<short-description>
```

4. Install dependencies and type-check:

```bash
npm install
npm run check
```

5. Test your local checkout with pi:

```bash
pi -e .
```

This loads the extension and bundled skills directly from the current directory. In interactive pi, verify QDash connectivity:

```text
/qdash-config <profile>
/qdash-setup <profile> <chip_id>
/qdash-dashboard
```

6. Commit and push:

```bash
git add -A
git commit -m "feat: describe your change"
git push -u origin feat/<short-description>
```

7. Open a pull request to `oqtopus-team/pi-qdash:main`.

## PR expectations

- PR titles must follow Conventional Commits, e.g. `feat: add qdash target report` or `docs: add development guide`.
- Run `npm run check` before opening a PR.
- Do not bump `package.json` / `package-lock.json` versions.
- Do not edit `CHANGELOG.md`.
- Do not create release tags. Releases are handled by tagpr.

## What to change where

Use this split when designing features:

### Extension/tool layer

Use `extensions/qdash.ts` for safe, mechanical capabilities:

- QDash API access through `@oqtopus-team/qdash-client`
- redaction and safety gates
- TUI rendering
- read-only data extraction helpers
- confirmation-gated write operations

New tools should be read-only by default. Write/operational tools must follow the existing approval-gate pattern (`confirmWrite: true` for non-interactive runs).

### Skills layer

Use `skills/` for domain reasoning and workflows:

- calibration diagnosis recipes
- runbooks and decision policies
- thresholds and failure-mode taxonomy
- known calibration cases
- guidance for how agents should combine tool outputs

For example, `qdash_analyze_figure_json` belongs in the extension because it mechanically summarizes Plotly JSON; interpreting a bad Bell tomography result belongs in `skills/qdash-two-qubit-calibration-diagnosis/`.

### Docs

Update docs with feature changes:

- Tools: `docs/tools.md`
- Commands and bundled skills: `docs/commands.md`
- Contributor/development process: `docs/DEVELOPMENT.md` and `docs/CONTRIBUTING.md`
- Agent-facing project policy: `AGENTS.md`

## Using pi to develop this repository

This repository includes `AGENTS.md`, which pi reads as project-specific guidance. It describes layout, commands, safety policies, and the extension-vs-skill split. When using pi for development, start it from the repository root:

```bash
pi
```

Useful prompts:

```text
Read AGENTS.md and propose where this feature should live: extension or skill.
Add a read-only QDash helper tool and update docs/tools.md.
Add a calibration diagnosis case to the appropriate skill and run npm run check.
```

When testing local extension behavior inside pi, use:

```bash
pi -e .
```

If pi is already running after edits to skills/extensions, use:

```text
/reload
```

## QDash credentials and safety

Never commit QDash tokens, Cloudflare Access secrets, passwords, or local config files. The extension redacts secrets in tool output, but contributors should still avoid placing secrets in test fixtures, docs examples, issue comments, or PR descriptions.

For write or operational behavior, prefer dry-run/read-only plans first and require explicit human confirmation before task execution, candidate commit, or backend apply.
