---
name: obsidian-evidence-integrity
description: Grounds answers using Samuel's Obsidian vault in identified notes and supporting sections, with clickable note-level links where the read_note URI is available. Use whenever reporting facts, plans, instructions, dates, numbers, or comparisons drawn from TurboVault or vault notes.
---

# Obsidian Evidence Integrity

This contract governs **answers**, not note formatting. Follow the Obsidian skill for vault access and retrieval. Vault notes are Samuel's working records, not independent authority for external rules, prices, deadlines, or current policy.

## Evidence eligibility

- Search hits, titles, frontmatter descriptions, backlinks, rank and similarity scores are **discovery**, not proof of a substantive claim. A returned chunk can guide a bounded `read_passage` call if it supplies `path`, `chunk_id`, and `chunk_hash`; sparse-only hits may have no anchor.
- `read_passage` reopens an exact indexed anchor and optional same-section neighbors. Each returned chunk retains its own ID and heading. Expansion adds no ranking score and does not make a neighboring chunk independently relevant. Respect `truncated` and any stale-index warning; do not infer absent text from clipped windows.
- Before making consequential claims, read the resolved Markdown note with `turbovault_read_note` (whole note or relevant named section); check context, exceptions, whether it is a proposal or a completed change, and whether a later note supersedes it. For exact known paths, read directly. A PDF/DOCX search chunk is extracted text, not a visually verified page; do not assert layout-sensitive values or quote omitted pages.
- Distinguish what the **note says** from what is verified now. For prices, hours, eligibility, software state, legal rules, or dated appointments, qualify as "my note lists ..." and check an authoritative current source when the user needs current certainty. A vault note does not verify a live external fact.
- Do not infer that no note exists from a failed or degraded search. Relay TurboVault's `warnings` verbatim when a retrieval channel, rerank, or refresh failed. A stale index can show older text; use `read_note` for current Markdown content.
- Never attach a note's link to a claim found only in another note. If sources disagree, identify which says what instead of silently reconciling them. Mark unsupported assertions `UNVERIFIED`, qualify, or omit them.

## User-facing attribution

- For a substantive vault-grounded answer, attach a compact `[^oN]` marker immediately after each material claim or tightly related group of claims. One marker can support several adjacent facts from the same bounded section; change marker when the note or supporting section changes. Explain **which note contains which information**, especially when synthesizing or contrasting notes.
- Finish with a single `### Evidence` block defining only cited markers. Each definition includes the note name, the exact vault-relative path or heading/section actually read, and—if `read_note` returned a `uri`—a Markdown link to that note. Example:

  ```markdown
  The example note says to calibrate the blue widget before testing.[^o1]

  ### Evidence
  [^o1]: [Example-Note](obsidian://open?vault=personal&file=20_Library%2FExample-Note), § Widget setup; `20_Library/Example-Note.md`.
  ```

- `obsidian://open` links are **note-level only**. Copy the `uri` returned by `read_note`; do not promise heading navigation, fabricate a `#heading` URI or PDF/DOCX link, or imply all chat clients support the custom protocol. Always retain a readable note title/path and supporting heading as fallback. The citation is about provenance, not a guarantee the link opens in this client.
- For short inventories, a compact table with a "Source note / section" column (linked when available) can replace footnotes per row. Metadata-only path listings need no footnote if their scope is clear.
- If Zotero or web evidence is also used, retain each route's distinct source standards and combine all definitions into **one** final Evidence block (`[^oN]`, `[^cN]`, `[^wN]`). Never use Zotero's audit tools to certify vault claims.
- A source locator asserts where a statement came from, not that it is true or current. Do not present index hashes, RRF scores, or successful retrieval as independent corroboration.
