# Publication QA and Table Standards

**Load this file when** preparing regression tables, summary balance tables, or empirical figures for paper drafts, seminar slides, appendixes, or journal submissions.

## 1. Regression and Summary Table Standards

Every table submitted for paper drafting or coauthor review must meet these presentation standards:

1. **Self-Contained Column Headers:** Columns must clearly label the dependent variable, model specification, or subsample.
2. **Clear Variable Labels:** Never display raw variable names (such as `l_inc_adj_00`) in table rows. Use clear, formatted labels with units of measurement (e.g., `Log Household Income (2020 USD)`).
3. **Consistent Observation Counts:** Sample size $N$ must remain stable across specifications unless sample restrictions are explicitly flagged in column titles or notes.
4. **Standard Error Notation:** Always specify standard error construction in the table footer: standard errors in parentheses, whether clustered, and the exact clustering dimension (e.g., *“Robust standard errors clustered at the county level in parentheses”*).
5. **Fixed Effects and Controls Indicators:** Use clean checkmarks or Yes/No indicators for fixed effects, time controls, and demographic covariates rather than omitting specification rows.
6. **Consistent Rounding:** Maintain uniform decimal precision across coefficients and standard errors (typically 3 decimal places) and test statistics (typically 2 decimal places).
7. **Table Schema Check:** Run `python3 scripts/check_table_ready.py <table.json>` on exported JSON table structures to confirm that `title`, `columns`, and `notes` exist.

## 2. Empirical Figure and Graph Standards

Review every exported figure against these visual guidelines:

1. **Title, Subtitle, and Notes:** Every figure must include a substantive title, concise axis labels with explicit units, and complete notes defining the analysis sample and data sources.
2. **Scale Selection:** Axes must not truncate or magnify ranges in ways that visually distort effect magnitudes or obscure economically meaningful variation.
3. **Monochrome and Printing Legibility:** Curves, scatter points, and bar shadings must remain distinguishable when printed in grayscale or viewed on black-and-white printouts. Use distinct dash patterns (`solid`, `dash`, `shortdash`) alongside color.
4. **Confidence Bands:** Shaded confidence regions or whisker bars must state their nominal coverage level ($90\%$, $95\%$) in figure notes.
5. **Deterministic Graph Review:** Run `python3 scripts/graph_qa_checklist.py --graph-name "<Name>" --notes "<Notes>"` to scaffold graph reviews.
