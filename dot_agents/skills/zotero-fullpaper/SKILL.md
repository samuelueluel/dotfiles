---
name: zotero-fullpaper
description: Reads one exact Zotero paper, or an explicitly requested pair, sequentially into live conversation context for source-locked discussion and close analysis without RAG. Use when Samuel asks to "read this paper in full," "absorb this paper," "read it and let's discuss," requests excluded sections or every figure visually checked, or invokes /skill:zotero-fullpaper.
---

# Zotero Full-Paper Reading

## Request-Routing Playbook

```text
REQUEST
├─ Read one paper in full ──────────→ FULL READ: resolve → scope → fit check → sequential source read
├─ Read two papers in full ─────────→ PAIRED READ: resolve both → combined fit check → read each separately
├─ Inspect every figure visually ───→ VISUAL AUDIT: full read + render every in-scope figure
├─ Follow-up on the loaded paper ──→ DISCUSS: answer from live source context; verify exact details at source
├─ Ask only a bounded question ────→ FOCUSED: use zotero-source-reading instead
└─ Audit all papers in a set ──────→ EXHAUSTIVE: use zotero-extract when explicitly requested
```

## Non-Negotiable Rules

- The purpose is to put the agreed source material in the **main session's live context**, not to retrieve relevant chunks or replace the document with a synopsis. Do not delegate the reading to a subagent and return its summary as a "full read."
- Never use semantic search, embeddings, indexed passages, retrieval scores, web search, or another paper to ingest the source or answer source-only questions. Direct, sequential PDF-page extraction and direct sequential reading of an existing MinerU sidecar are allowed; neither is RAG. Literal navigation or a direct reread of a known page for exactness is allowed.
- Use the exact Zotero parent item and the intended PDF/version. Do not substitute a related title, another edition, or a paper cited by the source.
- Read every part of the agreed text scope in order through one continuous route. Do not read both the entire sidecar and the entire PDF text layer. Never call a read complete on the strength of a search hit, a title/abstract, sampled pages, a generated figure description, or a discussion map.
- Do not silently shorten, summarize, or compact the source to make it fit. If the material cannot remain in live context, say so and negotiate a narrower or staged read. A saved dossier is not the whole paper in context.
- Source-only is the default for discussion and analysis. Do not bring in factual claims from model memory, the web, or other papers. Label your own deductions as deductions from the paper; use outside sources only if Samuel explicitly requests them, and keep their evidence separate.
- Do not create sidecars, run OCR/parsing jobs, start models, update indexes, download PDFs, or alter Zotero records as part of a reading request. If text is unavailable, explain the gap and ask before any separate processing workflow.

## 1. Fix Identity and Reading Scope

1. Resolve the named paper using `zotero_resolve_exact_source` and bind subsequent reads to its parent key. Check the linked attachment and version; if multiple PDFs disagree or identity is ambiguous, ask which one to use.
2. By default read the main PDF's abstract, prose, footnotes, tables and notes, equations, figure captions and surrounding discussion, and appendices. Skip bibliography entries unless requested; continue to any appendix after them. Visually inspect primary result figures and any figure whose axes, shape, map, or series carry a claim not clear from the text. Other figures may be caption/prose-only; never call them visually checked. If Samuel asks to inspect every figure, use the visual-audit route. Treat a separately attached supplement as a separate document: include it only when requested and it fits. Follow explicit exclusions.
3. Normally read one paper. If Samuel requests two, keep identity, source locations, and each paper's claims separate; plan for **both** to fit before loading either. For larger sets use a different workflow, not an invisible series of compressed "full reads."
4. Record a minimal coverage checklist internally (sections/pages, tables/equations, figures visually checked versus caption/prose-only, exclusions, unreadable parts). This tracks what was actually seen; it is not a required summary or discussion map. If the sidecar carries `[Table status: ...]` lines or `zotero_find_in_item` returns `problem_tables`, add every flagged table's PDF page to the render list; name any you do not inspect as unchecked in the status report.

## 2. Check Fit Before Loading

- Inspect the source's length and available live context capacity, including earlier conversation and room for follow-up discussion. Use one cheap text-length estimate or a conservative sample; do not scan or render every page just to estimate fit. A page count alone does not establish token size. Keep retrieval responses small enough that the tool does not truncate them.
- If no reliable context-capacity estimate is available, proceed conservatively and do not promise that the whole source will stay live. If the agreed scope cannot fit, ask whether to exclude sections or use a **clearly labeled staged reading**. In staged mode, do not call earlier stages fully live once their text has been compacted away.
- Context is not durable memory. If compaction, truncation, or a new session removes source text, disclose the lost coverage. Reopen the exact original source as needed; never answer as though the entire paper is still live. Do not initiate compaction to conceal an over-budget read.

## 3. Read the Document Sequentially

1. Choose **one continuous text route** for the exact attachment. Check a short prose sample and, when present, a table or equation page before deciding:
   - For usable native PDF text, prefer the pinned local path from `zotero_get_attachment_paths` when accessible. Read consecutive bounded ranges with `pdftotext -f START -l END -layout "$pdf" -`; quote the path, use the form-feed page breaks and requested one-based range to track coverage, and keep each output below the shell tool's truncation limit. Do not write a persistent text copy. Otherwise use `zotero_read_pdf_pages` in consecutive multi-page ranges, passing `attachment_key` when needed. A whole-PDF call is fine only if its complete output fits the tool and live context.
   - If native text loses substantial content but an existing MinerU sidecar preserves it better, read that sidecar in source order with `zotero_find_in_item(query=null)`. Carry its `source_hash` into `expected_hash` on continuations. A sidecar is not proof that signs, table cells, or equations are correct.
   - If neither text route covers the agreed scope adequately, say what cannot be read; verify only the needed pages visually or negotiate a narrower scope. Do not silently combine incomplete routes and call the result a full read.
2. Inspect each returned window and its boundaries before advancing. Continue from returned offsets or pages; avoid overlapping reads and gaps. Skip bibliography entries when reached, but continue to any later appendix. Keep sidecar lines/offsets distinct from one-based PDF pages. If the file changes mid-read, stop and re-establish coverage.
3. Check section and appendix order, and the presence of in-scope tables, equations, and figure captions against the PDF outline or pages. Do this while reading, not with a second full-document pass or a preliminary scan of every caption. A sidecar may omit material; a PDF text layer may lose reading order. Disclose coverage that cannot be established.
4. For the normal read, render primary result figures and other figures whose visual content is needed to understand or check a claim. Do not render every ancillary map or repetitive plot by default. For a requested visual audit, render every in-scope figure. Captions and generated `[Figure Schema]` blocks are not visual inspection. Render a table or equation page when signs, stars, labels, alignment, or symbols are unclear, and verify decisive numbers from the PDF when discussing them. For a sidecar read, locate a figure or table's actual PDF page before rendering; never treat a sidecar line as a page number. Do not render prose-only pages with complete text.
5. For a scan with no usable text, try only a verified existing OCR sidecar. If that is missing or unusable, stop and offer a **separate, locally authorized** OCR/sidecar step through `zotero-pipeline`. Never pretend that partial OCR covers the paper.

Read [direct source-reading syntax](../../references/zotero/deep-dive-reading.md) if continuations, page locators, or table rendering need tool-specific parameters; inspect the deployed schema before unfamiliar calls. Do not use semantic search or `zotero_collect_result_evidence` for this workflow.

## 4. Discuss and Verify from the Loaded Source

- After reading, give a short status: paper/version, complete text scope, primary figures visually inspected, any caption/prose-only figures, exclusions, and material text/visual gaps. Invite discussion. Do **not** produce a discussion map, summary, or external literature review unless asked.
- Ground each statement about what the paper says in text or an image actually read within the agreed scope. Distinguish the authors' results and interpretations from your own critique or calculations. A source's description of cited research is not independent evidence for that cited work.
- Use `citation-integrity` for claim-level source locations and statistical fidelity. Cite actual sections, tables, equations, or verified PDF pages. A sidecar line or inferred printed page is not a verified PDF page. Say "not in the read scope," "unreadable," or "not retrieved" rather than asserting the full paper omits a fact when coverage is incomplete.
- For an exact estimate, check outcome, sign, scale, units, dose, denominator, population, specification, horizon, and uncertainty against the result and its notes. Verify the relevant PDF page when available, particularly for table values. Preserve the paper's notation; never invent a p-value from stars, fix a table by intuition, or silently convert scales. Label any calculation from source numbers and show its inputs and method.
- For a requested table transcription or new table, use the source's row and column labels, units, notes, and uncertainty notation; inspect the rendered page if text layout is ambiguous. Mark unclear cells rather than guessing. Show a Markdown/LaTeX table in chat, or create a file only when requested. For mathematical expressions, check ambiguous symbols against the rendered equation.
- A direct revisit to a specific PDF page or sidecar window to verify an exact quotation, number, or equation is allowed; do not switch to RAG to answer follow-ups. For audit-ready direct quotes or quantitative claims, follow `citation-integrity`'s single mechanical audit cycle using direct PDF-page or sidecar evidence only. The audit is a check, not a source or a substitute for reading.
- If Samuel explicitly requests outside facts or comparisons, clearly separate **paper-based** claims from external evidence. Load the corresponding web/source skill for that separate portion. Do not blend outside claims into what the paper purportedly states.

## Stop Condition

Call it a completed full-paper read only if the entire agreed text scope was read in order, all figures needed for its main claims were visually checked, and the source remains in live context. State which other figures were caption/prose-only; never claim that every figure was visually inspected without checking each one. If an essential visual or text portion remains unread, call it a partial or staged read and name the gap. Stop without a preemptive synopsis unless Samuel requests one.
