# Causal Designs and Power Analysis Checklist

**Load this file when** designing or evaluating identification strategies (DiD, event studies, IV, RD, matching) or planning ex-ante sample sizes and minimum detectable effects.

## 1. Difference-in-Differences and Event Studies

Verify these identifying assumptions before interpreting treatment effect coefficients:

1. **Pre-Trend Parallelism:** Test and plot pre-treatment leads. Verify whether pre-trends are economically indistinguishable from zero, rather than relying solely on failing to reject $p > 0.05$.
2. **Treatment Timing Heterogeneity:** When treatment adoption is staggered across units, evaluate sensitivity to two-way fixed effects decomposition issues. Consider modern estimators (`csdid`, `did_multiplegt`, `eventstudyinteract`, `bacondecomp`) when treatment effects vary over time or across cohorts.
3. **Cohort Composition:** Confirm that panel balance does not introduce compositional selection bias across event-time windows.
4. **Anticipation Effects:** Assess whether economic actors altered behavior prior to statutory policy implementation.

## 2. Instrumental Variables and 2SLS

Verify relevance and exclusion restrictions:

1. **First-Stage Strength:** Report effective $F$-statistics (such as Montiel Olea-Pflueger or Kleibergen-Paap $F$). Do not rely on weak instruments or unadjusted rule-of-thumb $F > 10$ with clustered standard errors.
2. **Exclusion Defense:** Explicitly state the channel linking the instrument to the outcome and articulate why direct or unobserved alternative pathways are economically implausible.
3. **LATE vs. ATE Interpretation:** Clearly state the subpopulation of compliers identified by the instrument and evaluate external validity limits.

## 3. Regression Discontinuity Designs (Sharp and Fuzzy)

Verify local continuity and non-manipulation:

1. **Density Continuity:** Run manipulation tests around the threshold (e.g., Cattaneo-Jansson-Ma manipulation test / `rddensity`).
2. **Bandwidth Sensitivity:** Report estimates across multiple bandwidth choices (optimal MSE-minimizing bandwidth, $0.5 \times$ bandwidth, $1.5 \times$ bandwidth) using `rdrobust`.
3. **Polynomial Order:** Prefer local linear regressions with kernel weighting over high-order global polynomials.
4. **Covariate Balance at Cutoff:** Test for discontinuous jumps in predetermined baseline characteristics across the cutoff.

## 4. Matching and Weighting Methods

Verify common support and estimand clarity:

1. **Common Support / Overlap:** Plot propensity score distributions or balance metrics for treated and control units across the distribution.
2. **Covariate Balance:** Report standardized mean differences and variance ratios before and after matching or weighting.
3. **Estimand Definition:** Explicitly define whether the target parameter is the Average Treatment Effect on the Treated (ATT) or Average Treatment Effect (ATE).

## 5. Ex-Ante Power and MDE Planning

Plan statistical precision before running regressions:

1. **Explicit Parameters:** Specify the target estimand, baseline standard deviation $\sigma$, desired statistical power ($1 - \beta$, typically $0.80$), significance level $\alpha$ (typically $0.05$), and intracluster correlation $\rho$ when clustering.
2. **Minimum Detectable Effect (MDE):** Express MDE both in natural measurement units and standardized standard deviations.
3. **Ex-Ante vs. Ex-Post Boundary:** Distinguish planned design calculations from post-hoc justifications. Never compute ex-post power using realized effect estimates to rationalize statistically insignificant findings.
