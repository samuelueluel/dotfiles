---
name: stata-research
description: Guides applied econometric workflows in Stata across data audit, causal design, regression tables, publication QA, replication, and referee responses. Use when auditing datasets, planning identification strategies, building paper tables, evaluating robustness, or answering referee critiques in Stata.
---

# Stata Research Workflow

## Request-Routing Playbook

```text
REQUEST
├─ Data QA / Codebook / Merge Check ──→ AUDIT: inspect_data, duplicates report, assert
├─ Identification / Power / MDE ──────→ CAUSAL DESIGN: DiD/IV/RD checks, ex-ante power
├─ Regression Table / Formatting ─────→ TABLES: stata_get_results, verify N across cols
├─ Publication QA / Figure Check ─────→ REVIEW: check_table_ready.py, graph_qa_checklist.py
├─ Spec Sensitivity / Robustness ─────→ REPLICATION: compare_specs.py, summarize_log.py
└─ Referee / Coauthor Follow-up ──────→ REFEREE RESPONSE: focused reruns, bounded audit trail
```

## Non-Negotiable Rules

1. **Never Report Silent Sample Size Attrition:** Regression tables and comparative specifications must report observation counts ($N$) for every column and explicitly explain any sample drops between specifications.
2. **Verify Unique Keys with Code, Not Assumptions:** Always run `duplicates report <keys>` or `isid <keys>` and check `_merge` with explicit assertion logic. Never perform many-to-many (`m:m`) merges in Stata.
3. **No Sprawling Exploratory Reruns on Critiques:** When responding to referee or coauthor critiques, define a finite list of targeted reruns beforehand. Never launch uncoordinated exploratory loops that drift from the core critique.
4. **No Ex-Post Power Rationalization:** Distinguish formal ex-ante power and minimum detectable effect (MDE) calculations from post-hoc justifications for insignificant point estimates.
5. **Preserve Context Containment:** Use compact inspection tools (`stata_inspect_data`, `stata_get_results`) or bounded log tailing (`stata_read_log`) rather than dumping full SMCL terminal outputs into transcript context.

## Workflows & Invariants

### 1. Data Audit & Lineage

1. **Inspect Structure:** Check observation counts, variable counts, storage types, and missingness using `stata_inspect_data(action="describe")` and `stata_inspect_data(action="summary")`.
2. **Check Candidate Keys:** Confirm that unique panel or cross-sectional identifiers uniquely index rows with `duplicates report <id_vars>`.
3. **Validate Merges:** Verify match rates immediately after merging. For intended complete matches, enforce `assert _merge == 3`. When unmerged rows are expected, document why master-only (`_merge == 1`) or using-only (`_merge == 2`) rows exist before filtering.
4. **Scan Sentinels:** Look for implicit negative missing codes (such as `-99`, `999`) in survey data with `count if missing(var)` and `tab var, missing`.

### 2. Causal Design & Power Planning

1. **Difference-in-Differences:** Test and visually plot pre-treatment leads. In staggered rollout settings, assess whether heterogeneous treatment timing warrants robust estimators (`csdid`, `eventstudyinteract`, `did_multiplegt`).
2. **Instrumental Variables:** Check first-stage relevance using effective $F$-statistics (Montiel Olea-Pflueger or Kleibergen-Paap). State the economic exclusion argument and define whether the parameter represents LATE or ATE.
3. **Regression Discontinuity:** Verify local continuity with density tests (`rddensity`), test sensitivity across bandwidths using `rdrobust`, and verify predetermined covariate balance at the threshold.
4. **Ex-Ante Power:** Define target estimand, baseline standard deviation $\sigma$, desired power ($0.80$), $\alpha$ ($0.05$), and cluster correlation $\rho$. Report MDE in both natural units and standard deviations.

### 3. Table Construction & Formatting

1. **Extract Stored Results:** Pull authoritative estimation scalars and matrices (`e(b)`, `e(V)`, `e(N)`) directly via `stata_get_results` rather than parsing terminal text.
2. **Standardize Labels and Notes:** Use publication-ready variable labels with units of measurement. Note standard error clustering and model fixed effects in table footers.
3. **Verify Column Comparability:** Ensure sample size $N$ is consistent across columns unless subsample definitions are explicitly labeled.
4. **Validate Schema:** Confirm table exports include required structural elements with:
   ```bash
   python3 scripts/check_table_ready.py <table.json>
   ```

### 4. Publication Review & Figure QA

1. **Table Presentation:** Verify uniform rounding precision (coefficients to 3 decimal places, test statistics to 2), legible column headers, and explicit fixed effects indicators.
2. **Figure Presentation:** Ensure plots include substantive titles, units on both axes, explicit sample definitions in notes, and clear monochrome printing contrast.
3. **Generate Graph QA Pass:** Scaffold figure inspection using:
   ```bash
   python3 scripts/graph_qa_checklist.py --graph-name "<Name>" --notes "<Notes>"
   ```

### 5. Replication & Specification Sensitivity

1. **Establish Baseline:** Run the master do-file entrypoint cleanly. Save baseline model outputs (`baseline.json`) via `stata_get_results`.
2. **Compare Specifications:** Execute the alternative specification, save `variant.json`, and compute coefficient deltas deterministically:
   ```bash
   python3 scripts/compare_specs.py baseline.json variant.json
   ```
3. **Verify Execution Logs:** Scan execution logs for syntax errors, dropped variables, or execution anomalies with:
   ```bash
   python3 scripts/summarize_log.py /path/to/stata.log
   ```
4. **Assess Equivalence:** Report whether the result replicates exactly, matches with minor numerical drift, or fails qualitatively.

### 6. Referee Responses & Bounded Robustness

1. **Isolate the Critique:** Restate the referee's critique precisely before executing code.
2. **Execute Targeted Checks:** Run only the pre-specified robustness variants (e.g., alternative clustering, additional control set, alternate sample cutoff).
3. **Report Parameter Movement:** State baseline vs. variant point estimates, standard errors, and sample sizes side by side.
4. **Preserve Audit Trail:** Retain the do-file, log, and result tables in a dedicated response folder.

## Progressive Disclosure & Reference Routing

- When auditing dataset lineage, verifying merge integrity, or scanning sentinel codes, load [data audit checklist](references/data-audit.md).
- When evaluating DiD pre-trends, IV diagnostics, RD bandwidths, or calculating MDE, load [causal designs reference](references/causal-designs.md).
- When preparing journal table layouts, checking column comparability, or auditing figures, load [publication QA checklist](references/publication-qa.md).
- When answering referee critique points, comparing specification diffs, or scanning logs, load [referee and replication reference](references/referee-response.md).
