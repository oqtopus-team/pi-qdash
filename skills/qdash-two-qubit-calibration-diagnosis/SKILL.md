---
name: qdash-two-qubit-calibration-diagnosis
description: Diagnose QDash two-qubit calibration quality from CR, ZX90, Bell-state, tomography, coherence-limit, and IRB task results. Use when a coupling calibration completes but gate fidelity, Bell fidelity, or validation quality may be poor.
license: Apache-2.0
compatibility: pi-coding-agent >=0.74, pi-qdash extension
metadata:
  domain: quantum-calibration
  safety_level: read-only-first-write-gated
  preferred_validation_chain: CheckCrossResonance -> CreateZX90 -> CheckZX90 -> CheckBellState -> CheckBellStateTomography -> ZX90InterleavedRandomizedBenchmarking
---

# QDash Two-Qubit Calibration Diagnosis

Use this skill when investigating coupling-level calibration quality, especially when tasks are `completed` but quality may be poor.

## Principles

- Treat `completed` as execution status, not proof of calibration quality.
- Diagnose from evidence before suggesting operational actions.
- Prefer read-only tools first: `qdash_target_report`, `qdash_list_task_results`, `qdash_get_task_result`, `qdash_analyze_figure_json`, and `qdash_get_task_figures`.
- Do not rerun RB first when validation quality is suspicious. Walk back through prerequisites.
- Do not commit or apply candidates without explicit user confirmation, and only after downstream validation.

## Standard read-only investigation

For a coupling `cA-B`:

1. Build context with `qdash_target_report` and recent task results for the coupling.
2. Inspect the latest tasks in this chain:
   - `CheckCrossResonance`
   - `CreateZX90`
   - `CheckZX90`
   - `CheckBellState`
   - `CheckBellStateTomography`
   - `Check2QGateCoherenceLimit`
   - `ZX90InterleavedRandomizedBenchmarking`
3. Fetch task details and record:
   - CR: `cr_amplitude`, `cr_phase`, `cancel_amplitude`, `cancel_phase`, `rotary_amplitude`, `zx_rotation_rate`
   - ZX90: `zx90_gate_time`
   - Bell tomography: `bell_state_fidelity`
   - Coherence limit: `two_qubit_gate_coherence_limit`
   - IRB: `zx90_gate_fidelity`, its error, `zx90_depolarizing_rate`, `n_trials`
4. For JSON figures, use `qdash_analyze_figure_json` before manually reading raw Plotly JSON.
5. Summarize symptoms, likely failure mode, and the next *read-only or confirmation-gated* step.

## Interpretation rules

### Completed but low quality

Flag as suspicious when any of these hold:

- Bell-state tomography fidelity is below ~0.8.
- IRB fidelity has a large uncertainty/error bar, or `n_trials` is small.
- Coherence-limit fidelity is high but Bell/IRB fidelity is much lower.
- `CheckZX90` repeated-pulse traces do not show a stable/consistent response.
- CR parameter generation succeeds but `cr_amplitude` is near saturation or `zx_rotation_rate` is very small.

### Coherence limit gap

If `two_qubit_gate_coherence_limit` is high but measured Bell/IRB fidelity is low, do not attribute the issue primarily to T1/T2. Suspect control/calibration issues such as:

- ZX90 angle error
- CR phase error
- cancel-pulse amplitude/phase mismatch
- rotary compensation mismatch
- readout/classification contribution to validation figures

### Bell tomography signals

For a Bell target resembling `( |00> + |11> ) / sqrt(2)`:

- Large `|10>` or `|01>` population suggests population/conditional-rotation error, not just dephasing.
- Weak `|00><11|` coherence suggests phase, dephasing, or preparation error.
- Large imaginary coherence can indicate phase-compensation error.

Use the heatmap summaries from `qdash_analyze_figure_json` as numeric evidence. Do not overfit a single plot; correlate with `CheckZX90` and IRB.

### CheckZX90 repeated-pulse signals

Look for stable repeated-pulse behavior. Warnings include:

- Large scatter or non-decaying erratic points after the first few repetitions.
- Large first-step contrast followed by a non-zero offset.
- Different qualitative behavior between control and target qubit plots.

These symptoms point toward angle/phase/cancel/rotary issues and should be investigated before trusting IRB.

### IRB caveats

- A `completed` IRB with large error bar is weak evidence.
- Small `n_trials` should be reported explicitly.
- If Bell tomography is poor, do not use IRB alone as a pass signal.

## Recommended action sequence

When validation quality is poor:

```text
Inspect figures/results
-> CheckCrossResonance
-> CreateZX90
-> CheckZX90
-> CheckBellState
-> CheckBellStateTomography
-> ZX90InterleavedRandomizedBenchmarking
```

Each operational step requires explicit confirmation. Validate Bell/tomography before using IRB as the final quality signal.

## Known case: mackerel 144Qv1 c48-50, 20260725-003

Symptoms observed:

- `CheckCrossResonance` completed with `zx_rotation_rate ~ 1.69e-3`.
- `Check2QGateCoherenceLimit` reported ~0.978.
- `CheckBellStateTomography` reported `bell_state_fidelity ~ 0.60`.
- Bell tomography had high `|10>` component/population (~0.29) and non-ideal coherence.
- `ZX90InterleavedRandomizedBenchmarking` completed with `zx90_gate_fidelity ~0.94` but large error (~0.087) and `n_trials=10`.
- `CheckZX90` repeated-pulse traces were not clean/stable.

Interpretation:

- This is not primarily coherence-limited.
- Suspect ZX90 angle/phase/cancel/rotary calibration quality.
- Prefer walking back through `CheckCrossResonance -> CreateZX90 -> CheckZX90`, then validate with Bell tomography before trusting IRB.
