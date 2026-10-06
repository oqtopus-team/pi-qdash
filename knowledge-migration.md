# Task knowledge migration

Content below was removed from pi-qdash procedural skills. It should be reviewed and merged into the corresponding `qdash-task-knowledge` task `index.md`; it is evidence/domain knowledge, not runtime procedure.

## CheckRabi

### Failure and recovery context

A non-finite frequency, NaN, or low R² should not trigger repeated blind perturbations of `control_amplitude`, `readout_amplitude`, or `shots`. A successful diagnostic pattern is to inspect CheckChevron, use plausible frequency/amplitude estimates, refresh configuration, and validate with CheckRabi.

### Postmortem case: Q33, mackerel / 144Qv1, 2026-07-14

- Repeated CheckRabi failures reported `non-finite frequency: nan`.
- CheckChevron estimated `qubit_frequency = 4.186021437949582 GHz` and `control_amplitude = 0.196626929963469 a.u.`.
- After Configure, CheckRabi completed with `rabi_frequency = 12.664970037417886 MHz` and `control_amplitude = 0.19406572753680693 a.u.`.

## CheckChevron

### Expected visual patterns and failure modes

- Clear vertex/fringes support using the estimated `qubit_frequency` and `control_amplitude` for downstream validation.
- Faint fringes can indicate insufficient drive, poor readout fidelity, or weak initialization/readout contrast.
- No visible chevron warrants inspection of the readout path.
- Asymmetric or double chevrons can indicate TLS, higher-level transitions, AC Stark shift, or frequency collision; simple Rabi outputs should not be committed without review.
- A fitted frequency outside the operating range or a boundary hit makes the estimate unsafe.
- Abnormally large `coarse_control_amplitude` can indicate a wrong transition, poor readout contrast, or invalid operating point.
- A failed fit with a visually plausible chevron may justify human review of scan bounds.

### Postmortem case: Q35, mackerel / 144Qv1, 2026-07-14

- Repeated CheckRabi failures reported `non-finite frequency: nan`.
- CheckChevron failed with `Qubit frequency too low for qid=35: 2.759894 GHz < 3.0 GHz`.
- Inputs were `coarse_qubit_frequency = 2.894185298591617 GHz` and `coarse_control_amplitude = 0.5623413251903492 a.u.`.
- The safe conclusion was to inspect spectroscopy, coarse-frequency, and readout state before Configure or another Rabi attempt.

## CheckT2Echo

- Compare with recent CheckT1 and CheckRamsey.
- If `T2_echo` is much shorter than `2*T1`, investigate noise or refocusing issues.
- Verify π and π/2 pulses before treating the result as a pure coherence problem.

## CheckCrossResonance

- Near-saturated `cr_amplitude` or a very small `zx_rotation_rate` is suspicious even when parameter generation completes.
- Weak CR rotation should prompt inspection of qubit detuning, frequency collisions, and coupling history before increasing CR amplitude.

## CheckZX90

### Expected visual pattern and failure modes

Repeated-pulse traces should be stable and consistent. Warning signs include large scatter or erratic points after early repetitions, large first-step contrast followed by a non-zero offset, and qualitatively different control/target behavior. These can indicate angle, phase, cancel-pulse, or rotary-compensation problems.

## CheckBellStateTomography

### Interpretation

For a Bell target resembling `( |00> + |11> ) / sqrt(2)`:

- Large `|10>` or `|01>` population suggests population or conditional-rotation error rather than dephasing alone.
- Weak `|00><11|` coherence suggests phase, dephasing, or preparation error.
- Large imaginary coherence can indicate phase-compensation error.
- A fidelity below approximately 0.8 is suspicious, but interpretation should correlate tomography with CheckZX90 and IRB rather than overfit one plot.

## Check2QGateCoherenceLimit

When `two_qubit_gate_coherence_limit` is high but Bell/IRB fidelity is much lower, the discrepancy is more consistent with control/calibration limitations than T1/T2 alone. Candidate mechanisms include ZX90 angle error, CR phase error, cancel-pulse amplitude/phase mismatch, rotary-compensation mismatch, and readout/classification contribution.

## ZX90InterleavedRandomizedBenchmarking

- Completion alone is not proof of quality.
- Large uncertainty or error bars make the result weak evidence.
- Small `n_trials` must be reported explicitly.
- Poor Bell tomography should prevent IRB alone from being used as a pass signal.

## Two-qubit postmortem: mackerel 144Qv1 c48-50, 20260725-003

This case spans CheckCrossResonance, CheckZX90, CheckBellStateTomography, Check2QGateCoherenceLimit, and ZX90InterleavedRandomizedBenchmarking and should be linked from each relevant task entry.

- CheckCrossResonance completed with `zx_rotation_rate ~ 1.69e-3`.
- Check2QGateCoherenceLimit reported approximately `0.978`.
- CheckBellStateTomography reported `bell_state_fidelity ~ 0.60`, high `|10>` population (approximately `0.29`), and non-ideal coherence.
- ZX90InterleavedRandomizedBenchmarking completed with `zx90_gate_fidelity ~ 0.94`, error approximately `0.087`, and `n_trials=10`.
- CheckZX90 repeated-pulse traces were not clean or stable.
- Interpretation: the result was not primarily coherence-limited; ZX90 angle/phase/cancel/rotary calibration quality was the stronger hypothesis.

## Timeseries diagnosis

No task-specific physics or task-result expectations were found in `qdash-timeseries-diagnosis`. Its correlation, periodicity, resampling, and causality guidance remains procedural methodology in pi-qdash.
