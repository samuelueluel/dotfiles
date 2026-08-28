# Deep-Dive Reading & Targeted Sidecar Extraction

**Load this file when** extracting specific empirical content (coefficients, standard errors, table notes, design sections, proofs) without injecting full papers into context, or when deciding whether full reading is necessary.

## Scope & Sidecar Markdown Architecture

MinerU parses PDF documents into structured Markdown sidecars at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`, containing LaTeX equations, HTML tables, and OCR text.

This is an exceptional known-item fallback after collection-scoped semantic retrieval has identified an item key. For ordinary RAG, prefer targeted `semantic_search` and `read_pdf_pages`. Use sidecar shell extraction when page extraction is unavailable, a table is malformed/truncated, or a large technical work needs a precise section window.

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
To extract theorems or estimators from large reference works:
```bash
# 1. Locate matching heading across sidecars
grep -l "EFFICIENT GMM" ~/.config/zotero-mcp/mineru-sidecars/*.md

# 2. Find exact line number in target sidecar
grep -n "EFFICIENT GMM" ~/.config/zotero-mcp/mineru-sidecars/<key>.md

# 3. Read surrounding window (e.g., line N-5 to N+70)
sed -n '<START_LINE>,<END_LINE>p' ~/.config/zotero-mcp/mineru-sidecars/<key>.md
```
*Rule:* Target specific section headers rather than broad concepts across large books.

### 4. Comprehensive Reading (Literature Reviews & Synthesis)
When synthesizing full arguments or writing literature reviews:
- Read the entire paper using `zotero_zotero_get_item_fulltext` (when Desktop is running) or read the sidecar in structured chunks.
- Do not substitute grep fragments for comprehensive comprehension when evaluating full arguments.

## Scanned PDFs vs. Sidecars

`zotero_zotero_read_pdf_pages` extracts text-layer data only and returns `*[No text layer on this page — it is a scanned image]*` on scanned PDFs. Always prefer the OCR-processed sidecar Markdown. Use `read_pdf_pages` only to verify physical page layouts on native text-layer PDFs.

## Batch Extraction Across Papers

Extract table lines across multiple items:
```bash
for k in KEY1 KEY2; do
  echo "===== $k"
  grep -nE "Table [0-9]|\(0\.[0-9]+\)" ~/.config/zotero-mcp/mineru-sidecars/$k.md | head -30
done
```
