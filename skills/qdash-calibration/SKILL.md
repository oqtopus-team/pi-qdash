---
name: qdash-calibration
description: Guide conservative autonomous QDash calibration workflows from pi. Use when the user asks to calibrate, tune, recover failed calibration tasks, run agent calibration sessions, or decide the next calibration action for qubits/couplings.
license: Apache-2.0
compatibility: pi-coding-agent >=0.74, pi-qdash extension, QDash agent-session APIs
metadata:
  domain: quantum-calibration
  owner: pi-qdash
  maturity: experimental
  safety_level: operational-write-gated
  default_mode: one-target-one-action
  source_of_truth: pi-qdash skill until QDash task-knowledge operation is finalized
  preferred_qubit_recovery_recipe: CheckRabi -> CheckChevron -> Configure -> CheckRabi
  requires_confirmation_for:
    - agent session creation
    - task execution
    - parameter commit
    - backend apply
  related_qdash_tasks:
    - CheckRabi
    - CheckChevron
    - Configure
    - CheckReadoutFrequency
    - ReadoutClassification
---

# QDash Calibration Agent

This skill defines how pi should behave as a conservative calibration agent. It is operational guidance for the agent; long-lived physics/task knowledge may later move to QDash task-knowledge, but until that process is settled, keep practical calibration recipes here.

## Core principles

- Work one target at a time: one qubit or one coupling per action/session when possible.
- Diagnose before changing parameters.
- Prefer read-only inspection first: dashboard, failed task results, history, figures, forum posts, and task knowledge when available.
- Use narrow agent session policies with the smallest allowed task/action/parameter scope.
- Do not commit or apply parameter candidates until a validation task succeeds and the user explicitly confirms.
- Avoid blind parameter sweeps. If two conservative probes fail, step back to a diagnostic task.
- Record useful lessons as task-knowledge cases or as updates to this skill.

## Standard workflow

1. Establish context:
   - profile and chip
   - failed task(s)
   - qid/coupling_id
   - recent executions and open forum/issue context
2. Read evidence:
   - `qdash_list_task_results`
   - `qdash_get_task_result`
   - `qdash_get_task_figures` when figures exist
   - forum posts for the target when relevant
3. Make a one-step plan.
4. Ask for confirmation before write/operational actions.
5. Create a scoped agent session.
6. Run one action.
7. Inspect the result.
8. Continue only if the next step is clearly supported.

## Qubit recovery rules

### CheckRabi returns non-finite frequency, NaN, or low R²

Do not repeatedly perturb `control_amplitude`, `readout_amplitude`, or `shots` without diagnosis.

Canonical recovery sequence:

```text
CheckRabi -> CheckChevron -> Configure -> CheckRabi
```

Recommended sequence:

1. Inspect the failed `CheckRabi` result, recent history, and figures.
2. Run `CheckChevron` on the same qid.
3. If `CheckChevron` completes and gives plausible `qubit_frequency` and `control_amplitude`, run `Configure` to refresh backend/box configuration with the current calibration context.
4. Retry `CheckRabi` with the `CheckChevron` estimates as non-committing overrides.
5. If successful, inspect candidates and only then consider committing/applying parameters with explicit user confirmation.
6. If still failing after `Configure`, request human review and inspect raw/figure data.

Known successful pattern:

- Q33 on mackerel / `144Qv1`, 2026-07-14:
  - repeated `CheckRabi` failures with `non-finite frequency: nan`
  - `CheckChevron` succeeded and estimated:
    - `qubit_frequency = 4.186021437949582 GHz`
    - `control_amplitude = 0.196626929963469 a.u.`
  - `Configure` completed
  - `CheckRabi` then completed with the CheckChevron estimates:
    - `rabi_frequency = 12.664970037417886 MHz`
    - `control_amplitude = 0.19406572753680693 a.u.`

### CheckChevron interpretation and suggestions

If `CheckChevron` completes:

- Clear vertex/fringes: use estimated `qubit_frequency` and `control_amplitude`, then run `Configure -> CheckRabi` for validation.
- Faint fringes: suspect insufficient drive, readout fidelity, or initialization/readout contrast; suggest readout diagnostics before parameter commits.
- No visible chevron: inspect readout path first (`CheckReadoutFrequency`, `ReadoutClassification`) or request human review.
- Asymmetric/double chevron: suspect TLS, higher-level transitions, AC Stark shift, or frequency collision; avoid committing simple Rabi outputs without review.

If `CheckChevron` fails:

1. Stop the autonomous recovery path. Do not continue to `Configure -> CheckRabi` automatically.
2. Inspect and show the figures with `qdash_get_task_figures`.
3. Classify the failure message and input/output parameters.
4. Suggest the next diagnostic, but require user confirmation before another operational action.

Common failed-Chevron suggestions:

- `Qubit frequency too low/high`, boundary hit, or fitted frequency outside normal operating range:
  - Treat the Chevron estimate as unsafe.
  - Do not commit/apply candidates.
  - Do not run `Configure -> CheckRabi` from this estimate.
  - Suggest `CheckQubitSpectroscopy`, coarse frequency search review, or human figure review.
- Abnormally large `coarse_control_amplitude`:
  - Suspect the coarse search latched onto a wrong transition, poor readout contrast, or an invalid operating point.
  - Suggest spectroscopy/readout diagnostics rather than stronger drive.
- Failed fit but visually plausible chevron:
  - Ask the user to inspect figures.
  - Consider adjusted scan bounds only with explicit user guidance.
- Faint/washed-out chevron:
  - Suggest `ReadoutClassification`, `CheckReadoutFrequency`, and initialization/readout checks.

Known failed pattern:

- Q35 on mackerel / `144Qv1`, 2026-07-14:
  - repeated `CheckRabi` failures with `non-finite frequency: nan`
  - `CheckChevron` failed with `Qubit frequency too low for qid=35: 2.759894 GHz < 3.0 GHz`
  - input `coarse_qubit_frequency = 2.894185298591617 GHz`
  - input `coarse_control_amplitude = 0.5623413251903492 a.u.`
  - Suggested action: stop, inspect figures, and investigate spectroscopy/coarse frequency/readout state before any Configure/Rabi retry.

### CheckT2Echo failures

- Compare with recent `CheckT1` and `CheckRamsey`.
- If `T2_echo` is much shorter than `2*T1`, suspect noise/refocusing issues.
- Verify π/π/2 pulses before treating echo as a pure coherence problem.

## Coupling / two-qubit recovery rules

For `ZX90InterleavedRandomizedBenchmarking` or two-qubit validation failures, do not rerun RB first. Walk back through prerequisites:

1. `CheckCrossResonance`
2. `CreateZX90`
3. `CheckZX90`
4. `CheckBellState`
5. `CheckBellStateTomography`
6. then RB validation

If CR rotation is weak, inspect qubit detuning/frequency collisions and coupling history before increasing CR amplitude.

## Session policy guidelines

For diagnostic-only actions:

- `allowed_actions`: `run_task`, `request_human`, `complete_session`
- `allow_reconfigure`: `false`, except sessions explicitly intended to run `Configure`
- `max_actions`: small, typically 3–6

For `CheckRabi` after `CheckChevron`, allow only the specific qid and bounded overrides:

- `qubit_frequency`: narrow GHz range around the Chevron estimate
- `control_amplitude`: conservative range around the Chevron estimate

Do not include broad parameter ranges unless the user explicitly requests exploratory calibration.

## Commit/apply rules

- Listing candidates is read-only and encouraged after a successful task.
- Commit/apply requires explicit user confirmation.
- Prefer validating with the downstream check task before committing.
- Never apply candidates from a failed authoritative task.

## When to stop

Stop and request human review when:

- two diagnostic tasks disagree strongly
- the same target fails after `CheckChevron` and `Configure`
- figures suggest TLS, frequency collision, leakage, or multi-level behavior
- the next action would require broad parameter sweeps or hardware-risky changes
