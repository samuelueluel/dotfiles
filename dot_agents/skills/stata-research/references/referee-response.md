# Referee Response and Replication Workflow

**Load this file when** responding to referee reports, handling coauthor robustness requests, or reproducing specification sensitivity matrices across pipeline runs.

## 1. Referee Response Protocol

Address peer-review critiques with bounded, audit-ready empirical workflows:

1. **Restate the Exact Critique:** Isolate the referee's substantive concern (e.g., omitted variable bias, cluster level mismatch, alternate bandwidth, attrition). Do not broaden the critique into a speculative overhaul.
2. **Define Bounded Empirical Checks:** Plan a finite set of targeted reruns (e.g., 2 alternative clustering schemes, 1 alternate control set, 1 placebo cutoff). Resist sprawling exploratory loops.
3. **Isolate Parameter Movement:** Clearly report:
   - Baseline point estimate and standard error.
   - New point estimate and standard error under the requested variant.
   - Numeric delta and whether the economic interpretation changes.
4. **Distinguish Stable from Sensitive Findings:** Explicitly state which primary conclusions remain robust and which results depend on particular modeling choices.
5. **Preserve the Audit Trail:** Save the do-file, log output, and comparison matrices in a dedicated response subfolder (e.g., `analysis/referee_round1/`).

## 2. Replication and Specification Sensitivity

Follow a disciplined sequence for replication and robustness runs:

1. **Authoritative Pipeline Entrypoint:** Verify master do-file entrypoints (`00_master.do` or `01_clean.do` $\to$ `02_estimate.do`) before executing ad-hoc subcomponents.
2. **Baseline State Verification:** Execute the baseline script cleanly and save the baseline results payload (`baseline.json`) from `stata_get_results`.
3. **Structured Specification Diffs:** Execute the variant model, save `variant.json`, and run:
   ```bash
   python3 scripts/compare_specs.py baseline.json variant.json
   ```
   Inspect coefficient deltas, changes in standard errors, and sample count shifts.
4. **Log Analysis:** Scan execution logs for unhandled errors, assertion failures, or dropped variables with:
   ```bash
   python3 scripts/summarize_log.py /path/to/stata.log
   ```
5. **Material Equivalence Standard:** Do not declare a result replicated unless point estimates, standard errors, and observation counts match to the expected tolerance. Distinguish software/environment discrepancies from substantive model breakdown.
