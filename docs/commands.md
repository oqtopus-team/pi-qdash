# Commands

pi-qdash provides the following slash commands in interactive pi:

```text
/qdash-setup [profile] [chip_id]
/qdash-use-profile <profile>
/qdash-use-chip [chip_id]
/qdash-use-agent-session <session_id>
/qdash-context
/qdash-dashboard [limit]
/qdash-target-report qid <qid> | coupling <coupling_id>
/qdash-plan-calibration
/qdash-degradation-report
/qdash-wiring-insights
/qdash-refresh [limit]
/qdash-clear-context
/qdash-config [profile]
```

For the common path, run `/qdash-setup <profile> <chip_id>` first. The setup
command stores the session-local profile/chip context, refreshes the footer
status line, and opens the dashboard widget.

These commands manage session-local QDash context, update the pi
status/widget, show or refresh a themed compact QDash dashboard, and show
non-secret QDash configuration details. Tools use the current profile/chip
context when their parameters are omitted. In interactive mode, the
highlighted footer status line shows the active QDash profile, chip, and agent
session.

## Skills

The package also provides two skills:

- `/skill:qdash`: guides pi to choose the right QDash tools, avoid exposing secrets, and prefer read-only operations
- `/skill:qdash-calibration`: guides pi through the agent calibration workflow
