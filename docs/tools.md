# Tool Reference

pi-qdash registers the following tools with pi. All tools reuse the current
session profile/chip context when their parameters are omitted.

## Configuration

- `qdash_config_info`: inspect profiles and non-secret connection settings

## Read-only query tools

- `qdash_list_chips`, `qdash_get_default_chip`
- `qdash_get_chip_metrics`, `qdash_list_chip_qubits`, `qdash_list_chip_couplings`
- `qdash_list_cryostats`, `qdash_list_cooldowns`
- `qdash_get_cooldown_wiring`, `qdash_wiring_insights`, `qdash_list_cooldown_wiring_events`
- `qdash_get_timeseries`, `qdash_plot_timeseries`
- `qdash_list_task_results`, `qdash_get_task_result`
- `qdash_list_issues`
- `qdash_list_flows`, `qdash_get_flow`
- `qdash_list_executions`, `qdash_get_execution`, `qdash_wait_execution`, `qdash_compare_executions`
- `qdash_list_ai_reviews`, `qdash_get_provenance_stats`
- `qdash_list_forum_posts`, `qdash_get_forum_post`, `qdash_list_forum_replies`
- `qdash_get_figure`, `qdash_get_task_figures`, `qdash_recent_calibration_figure`

`qdash_get_cooldown_wiring` resolves the active/newest cooldown automatically
from a cryostat or the current/default chip, and returns compact human-readable
wiring markdown with opt-in attenuation insights. `qdash_wiring_insights`
focuses on those insights: it parses the wiring table, totals control/readout
attenuation, highlights unusual totals, and maps control-port anomalies to
qubits using the MUX×4 convention. Raw BlockNote blocks and wiring checkpoint
history are opt-in to keep the normal response focused.

## Overview and insight tools

- `qdash_investigate`: natural-language-friendly read-only correlation of recent calibration, target history, failures, issues, and Forum context
- `qdash_compare_calibration`: compare repeated calibration output parameters
- `qdash_dashboard`, `qdash_dashboard_insights`
- `qdash_recent_calibration_summary`
- `qdash_recommend_next_action`
- `qdash_triage_overview`
- `qdash_target_report`: target-level read-only incident/operations report
- `qdash_plan_calibration`: safe dry-run calibration plan; never executes
- `qdash_validate_calibration`: post-task validation gates; read-only
- `qdash_degradation_report`: provenance drift, changes, lock, and downstream recommendations

`qdash_dashboard` and `qdash_triage_overview` provide boxed compact text output
for non-interactive runs and custom TUI renderers for nicer interactive tool
results. `qdash_target_report` correlates one qubit/coupling's recent task
results, failures, open issues, forum posts, and a conservative next-action
recommendation; it is read-only and never executes calibration.
`qdash_plan_calibration` turns that evidence into a confirmation-gated dry-run
runbook with explicit safety gates. Pass `color: true` to emit ANSI-colored
text output in terminal-oriented non-interactive usage.

## Agent calibration workflow tools

- `qdash_create_agent_session`, `qdash_get_agent_session`
- `qdash_submit_agent_action`
- `qdash_get_agent_action`, `qdash_list_agent_actions`, `qdash_wait_agent_action`
- `qdash_list_agent_action_candidates`
- `qdash_execute_agent_action`
- `qdash_commit_agent_candidate`, `qdash_commit_agent_campaign_candidates`
- `qdash_get_agent_candidate_commit`, `qdash_apply_agent_candidate_commit`, `qdash_wait_agent_candidate_apply`

## Forum and figure tools

Forum read tools render compact boxed summaries for list/detail/reply views.
Figure tools fetch calibration PNG/JSON figures by path or task result through
qdash-client helpers, and render images in interactive TUI.

Forum evidence can be previewed read-only with
`qdash_preview_forum_evidence_reply`, then published through
confirmation-gated `qdash_create_forum_evidence_reply`; other forum writes
include `qdash_create_forum_post` and `qdash_update_forum_post`. The
evidence-reply helper builds a markdown reply from a task result, embeds
figures so they are visible in the forum, links recent same-task history, and
marks the reply with `— 🤖 by pi-qdash`.

## Fallback tools

- `qdash_query`: fallback for read-only queries that do not yet have a dedicated tool
- `qdash_raw_get`: call read-only GET endpoints not covered by `qdash_query` through the qdash-client transport

## Safety

Secrets such as `api_token`, passwords, and Cloudflare Access secrets are
redacted from tool output. Write-oriented agent/forum workflow tools are
approval-gated: interactive pi shows a confirmation prompt, and
non-interactive runs require `confirmWrite: true`.
