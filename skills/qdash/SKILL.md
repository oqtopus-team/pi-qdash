---
name: qdash
description: Query a running QDash instance from pi via the pi-qdash extension and @oqtopus-team/qdash-client. Use when inspecting chips, metrics, task results, tasks, projects, files, flows, executions, forum posts, provenance, or QDash profile/configuration.
---

# QDash

Use the pi-qdash tools instead of scraping the UI or hand-writing auth headers.

## Preferred tools

1. `qdash_config_info` — check profile names and non-secret connection settings.
2. Prefer dedicated read-only tools when they match the task:
   - `qdash_list_chips`, `qdash_get_default_chip`
   - `qdash_get_chip_metrics`, `qdash_list_chip_qubits`, `qdash_list_chip_couplings`
   - `qdash_list_cryostats`, `qdash_list_cooldowns`
   - `qdash_get_cooldown_wiring`, `qdash_wiring_insights`, `qdash_list_cooldown_wiring_events`
   - `qdash_get_timeseries`, `qdash_plot_timeseries`
   - `qdash_list_task_results`, `qdash_get_task_result`
   - `qdash_list_issues`
   - `qdash_list_flows`, `qdash_get_flow`
   - `qdash_list_executions`, `qdash_get_execution`
   - `qdash_list_ai_reviews`, `qdash_get_provenance_stats`
   - `qdash_list_forum_posts`, `qdash_get_forum_post`, `qdash_list_forum_replies`
   - `qdash_get_figure`, `qdash_get_task_figures`, `qdash_recent_calibration_figure`
   - `qdash_create_forum_evidence_reply` for confirmed evidence curation replies with visible task figures
3. Use harness overview tools for status and triage:
   - `qdash_investigate` for natural-language requests to investigate or compare recent calibration, target history, figures, failures, issues, and Forum context
   - `qdash_compare_calibration` for read-only before/after comparison of repeated target calibration results
   - `qdash_dashboard`
   - `qdash_dashboard_insights`
   - `qdash_recent_calibration_summary`
   - `qdash_recommend_next_action`
   - `qdash_triage_overview`
4. Use agent calibration workflow tools when the user explicitly wants an agent workflow:
   - `qdash_create_agent_session`
   - `qdash_get_agent_session`
   - `qdash_submit_agent_action`
   - `qdash_get_agent_action`, `qdash_list_agent_actions`, `qdash_wait_agent_action`
   - `qdash_list_agent_action_candidates`
   - `qdash_execute_agent_action`
   - `qdash_commit_agent_candidate`, `qdash_commit_agent_campaign_candidates`
   - `qdash_get_agent_candidate_commit`, `qdash_apply_agent_candidate_commit`, `qdash_wait_agent_candidate_apply`
5. Use `qdash_query` for common read-only QDash operations not covered by a dedicated tool:
   - `chips`, `default_chip`, `metrics_config`, `chip_metrics`
   - `chip_qubits`, `chip_qubit`, `chip_couplings`, `chip_coupling`
   - `cryostats`, `cryostat`, `cooldowns`, `cooldown`, `cooldown_wiring_events`
   - `timeseries`, `task_results`, `task_result`, `task_note`, `task_result_issues`
   - `qubit_latest`, `qubit_history`, `coupling_latest`, `coupling_history`
   - `tasks`, `task_knowledge`, `task_knowledge_markdown`
   - `projects`, `project`, `files_tree`, `file_content`, `git_status`
   - `issues`, `issue_knowledge`
   - `flows`, `flow`, `flow_templates`, `flow_template`, `flow_helper_files`, `flow_helper_file`
   - `executions`, `execution`, `ai_reviews`, `ai_review_runs`, `ai_review_run`
   - `forum_posts`, `provenance_stats`, `provenance_history`, `provenance_changes`, `provenance_lineage`, `provenance_impact`
6. `qdash_raw_get` — read-only GET endpoints not covered by `qdash_query`.

## Session context

Use these commands to make pi behave like a QDash-specific harness with persistent session-local context:

```text
/qdash-use-profile <profile>
/qdash-use-chip [chip_id]
/qdash-use-target qid <qid> | coupling <coupling_id>
/qdash-use-agent-session <session_id>
/qdash-context
/qdash-dashboard [limit]
/qdash-wiring-insights
/qdash-refresh [limit]
/qdash-clear-context
```

Prefer the current context when the user has already selected a profile/chip/session. Tools use that context when parameters are omitted.

For cryostat wiring requests, start with `qdash_get_cooldown_wiring`. Pass `cooldownId` when the user names one; otherwise pass `cryoId`, or omit both to resolve the active/newest cooldown from the current/default chip. Prefer the compact `wiring.markdown`; request raw blocks only when structural or embedded BlockNote data is necessary, and request history when investigating wiring changes. Set `includeInsights` or call `qdash_wiring_insights` when the user asks what is characteristic, unusual, or worth checking in attenuation; summarize control/readout totals and affected qubits/MUXes instead of dumping the raw table.

## Configuration

The extension uses `@oqtopus-team/qdash-client` and supports:

- `QDASH_*` environment variables (`QDASH_BASE_URL`, `QDASH_API_TOKEN`, `QDASH_PROJECT_ID`, etc.)
- `$XDG_CONFIG_HOME/qdash/config.ini`
- `~/.config/qdash/config.ini`
- explicit `profile` / `configPath` parameters

If `QDASH_BASE_URL` is set and no profile is specified, the tools default to environment variables. Otherwise they use profile `default`.

## Evidence curation workflow

When the user wants to preserve an investigated observation in QDash forum/notes:

1. Inspect the task result, task figure, timeseries/history, and related forum context first.
2. Summarize the observation as evidence, not as an automatic calibration decision.
3. Prefer replying to an existing target/coupling forum thread when one exists.
4. Use `qdash_create_forum_evidence_reply` for task-result evidence so figures are embedded as QDash UI image blocks (`/api/executions/figure?path=...`) and visible in the forum.
5. Include task and execution QDash Web URLs in the reply.
6. When mentioning history or trends, include links to representative historical task results.
7. Mark agent-authored evidence with a footer such as `— 🤖 by pi-qdash`.
8. Ask for confirmation before creating/updating the forum post.

## Safety

- Never print tokens, passwords, Cloudflare Access secrets, or full profile contents.
- Treat write/operational endpoints (agent session/action creation, candidate commits, forum create/update, flow execute, git push/pull, re-execute, admin/auth APIs) as sensitive and ask the user before any write workflow.
- Write-oriented QDash tools are approval-gated. In interactive pi, let the extension prompt for confirmation. In non-interactive runs, set `confirmWrite: true` only after explicit user confirmation.
- Use `qdash_investigate` for natural-language requests to investigate, compare, or understand a target or recent calibration; it is read-only and combines recent results with target, Forum, issue, and recommendation context.
- Use `qdash_compare_calibration` when the user asks what changed between recent calibration experiments; treat differences as evidence, not automatic approval to commit/apply parameters.
- Use `qdash_recent_calibration_figure` when the user asks to see recent experiment images without a task ID.
- Prefer summarizing large responses with counts, IDs, time ranges, and notable values.
