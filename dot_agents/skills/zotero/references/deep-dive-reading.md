# Deep-Dive Reading & Targeted Sidecar Extraction

**Load this file when** extracting specific empirical content (coefficients, standard errors, table notes, design sections, proofs) without injecting full papers into context, or when deciding whether full reading is necessary.

## Scope & Sidecar Markdown Architecture

MinerU parses PDF documents into structured Markdown sidecars at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`, containing LaTeX equations, HTML tables, and OCR text.

This is an exceptional known-item fallback after collection-scoped semantic retrieval has identified an item key. For ordinary RAG, prefer targeted `zotero_semantic_search` and `zotero_read_pdf_pages`. Use sidecar shell extraction when page extraction is unavailable, a table is malformed/truncated, or a large technical work needs a precise section window.

Targeted shell commands (`grep`, `sed`) directly on a known sidecar can recover exact data without loading an entire paper. Never use shell tools to parse MCP gateway temporary/spill files; rerun the MCP query with a narrower query or smaller limit instead.

## Decision Rules & Extraction Patterns

### 1. Extractive Data (Estimates, Coefficients, Table Notes)
For point estimates, standard errors, and table notes:
```bash
# Locate table numbers or formatted point estimates
grep -nE "Table 5|\(0\.0[0-9]+\)" ~/.config/zotero-mcp/mineru-sidecars/<key>.md

# Search for standard errors with surrounding row context
grep -n -i "standard error" ~/.config/zotero-mcp/mineru-sidecars/<key>.md
```
*Formatting Note:* Tables use HTML (`<tr><td>`). Standard errors appear as `(0.0359)`. Use `-B2 -A6` to view surrounding table rows.

### 2. Methodological Sections (Identification, Robustness, Clustering)
To inspect design credibility or econometric specifications:
```bash
# 1. Locate relevant section lines
grep -n -iE "identification|instrument|placebo|robust|clustered|Note:" ~/.config/zotero-mcp/mineru-sidecars/<key>.md

# 2. Extract specific line window (e.g., lines 120 to 150)
sed -n '120,150p' ~/.config/zotero-mcp/mineru-sidecars/<key>.md
```

### 3. Textbook & Method Extraction (Definitions, Proofs, Formulas)
To extract a theorem or estimator from an already identified large reference work:
```bash
# 1. Find the exact heading in the known item's sidecar
grep -n "EFFICIENT GMM" ~/.config/zotero-mcp/mineru-sidecars/<key>.md

# 2. Read the surrounding window (e.g., line N-5 to N+70)
sed -n '<START_LINE>,<END_LINE>p' ~/.config/zotero-mcp/mineru-sidecars/<key>.md
```
*Rule:* Sidecar search is known-item extraction, not corpus discovery. Use semantic search to identify the item first, then target its section header.

### 4. Comprehensive Reading (Literature Reviews & Synthesis)
When synthesizing full arguments or writing literature reviews:
- Read the entire paper using `zotero_get_item_fulltext` (when Desktop is running) or read the sidecar in structured chunks.
- Do not substitute grep fragments for comprehensive comprehension when evaluating full arguments.

## Scanned PDFs vs. Sidecars

For native text-layer PDFs, prefer `zotero_read_pdf_pages` when exact page context or a numerical/table claim must be verified. Switch to the OCR-processed sidecar when page extraction reports no text layer, is malformed or truncated, or a precise known-item window is substantially cheaper than loading broad text. Use page layout tools only when visual structure itself matters. Always label the route that actually supplied the evidence.

## Batch Extraction Across Papers

Use batch extraction only for already shortlisted items when the same answer-changing table field must be compared; never use it as open-ended corpus discovery:
```bash
for k in KEY1 KEY2; do
  echo "===== $k"
  grep -nE "Table [0-9]|\(0\.[0-9]+\)" ~/.config/zotero-mcp/mineru-sidecars/$k.md | head -30
done
```
