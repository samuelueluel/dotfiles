# Deep-Dive Reading (sidecar grep)

**Load this file when** the agent needs specific content from papers — coefficients, standard errors, table notes, design/method sections — or when deciding whether to read a paper in full during literature work (e.g., "qualify these results", "what did Table 5 show?", "did they cluster SEs?", "how credible is the identification?").

## Why grep instead of full text

Every MinerU-parsed item gets a sidecar at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md` (LaTeX equations, HTML tables, OCR text). Check one exists with `ls ~/.config/zotero-mcp/mineru-sidecars/<key>.md`.

`zotero_zotero_get_item_fulltext` reads the SAME sidecar, but:

- injects the whole paper into context (~12–24K tokens), and
- requires Zotero desktop/API up — its metadata fetch errors out with desktop closed (`Connection refused`, before any content is reached).

`grep`/`sed` on the sidecar reads the same content with neither cost: no desktop dependency, only matching lines enter context.

## Decision rule: extract vs. understand

- **Extractive** ("coefficient", "standard error", "what did Table 5 show?"): grep for the pattern.

  ```bash
  grep -nE "Table 5|\(0\.0[0-9]+\)" ~/.config/zotero-mcp/mineru-sidecars/<key>.md
  grep -n -i "standard error" ~/.config/zotero-mcp/mineru-sidecars/<key>.md
  ```

  Tables are HTML (`<tr><td>`); SEs look like `(0.0359)` inside cells. Add `-B2 -A6` for surrounding context.

- **Assessable / semantic** ("how credible is the identification?", "is the result robust?"): grep to LOCATE the design sections, then read only those regions.

  ```bash
  grep -n -iE "identification|instrument|placebo|robust|clustered|Note:" ~/.config/zotero-mcp/mineru-sidecars/<key>.md
  sed -n '120,150p' ~/.config/zotero-mcp/mineru-sidecars/<key>.md
  ```

  Reading becomes surgical instead of whole-paper.

- **Textbook / method extraction** (equations, theorems, definitions in big books): locate by **section heading**, then read the range around the hit — never chase a vague concept phrase. `grep -i "asymptotic variance"` on Hayashi hits ch. 7 OLS noise when the answer sits under "13.8 EFFICIENT GMM".

  ```bash
  # 1. pick the best source across ALL sidecars in one pass
  grep -l "EFFICIENT GMM" ~/.config/zotero-mcp/mineru-sidecars/*.md
  # 2. locate the heading
  grep -n "EFFICIENT GMM" ~/.config/zotero-mcp/mineru-sidecars/<key>.md
  # 3. read the range around the hit immediately — stop grepping
  sed -n '16055,16130p' ~/.config/zotero-mcp/mineru-sidecars/<key>.md
  ```

  Heading hit at line N → read roughly `N-5` to `N+70`. A broad grep after a heading hit wastes turns; the content is ~50 lines below the heading you already found.

- **Holistic** ("write a literature-review paragraph on this paper", "synthesize across these papers", big-picture understanding): a full read is the RIGHT choice — `zotero_zotero_get_item_fulltext` (desktop must be up) or read the sidecar in chunks. Never substitute grep for a read when the question is what the paper says overall — grep is a cost-aware default for targeted extraction, not a gate on full reading.

## Do not use read_pdf_pages as a middle path

`zotero_zotero_read_pdf_pages(item_key, start_page, end_page)` looks like an attractive page-scoped compromise. It is **text-layer only, with no OCR**, so on this scan-heavy corpus it commonly returns:

```
*[No text layer on this page — it is a scanned image]*
```

— for pages MinerU parsed perfectly well. That is the dangerous failure class: the call succeeds, returns clean-looking output, and the content is simply absent. **Prefer the sidecar.** Reach for `read_pdf_pages` only to confirm pagination or to read a page you already know carries a text layer, and never conclude a paper lacks content because this tool came back empty.

The `[pdf]` extra is installed, so `get_pdf_outline` (bookmark TOC for long PDFs) and `get_page_layout` (figure/table coordinates) are live — see `library-ops.md` for details. Content still comes from the sidecar; `get_page_layout` adds the geometry, it doesn't replace the sidecar.

## Practical notes

- Item keys come from semantic-search results (or `zotero_zotero_get_item_children`).
- Sidecar grep works with Zotero desktop closed; fulltext via MCP does not. Desktop-down metadata lookup: `service-ops.md`.
- A missing sidecar means the item was never MinerU-parsed (or the parse failed). Re-running `zotero_zotero_update_search_database` retries formerly-failed items; see `index-maintenance.md`.
- For a holistic read of an item whose highlights matter, check `zotero_zotero_synthesize_annotations` — but note it returns nothing until there are Zotero-DB annotations (file-embedded highlights from external readers are read-only; see `library-ops.md`).
- For several papers, loop over keys:

  ```bash
  for k in KEY1 KEY2; do echo "===== $k"; grep -nE "Table [0-9]|\(0\.[0-9]+\)" ~/.config/zotero-mcp/mineru-sidecars/$k.md | head -30; done
  ```
