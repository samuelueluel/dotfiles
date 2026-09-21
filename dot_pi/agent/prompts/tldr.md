---
description: Rewrite my last answer in fewer words without losing any of it
argument-hint: "[target, defaults to your last answer]"
---

Compress this: ${ARGUMENTS:-your most recent answer in this session}

**Rule: lossy for prose, lossless for information.** Same facts, fewer words. Every distinct piece of information in the original must survive — each finding, number, path, line reference, command, step, caveat, and qualifier. What you delete is the writing around the information, never the information.

**Cut:** restatements of my question, "let me take a look", recaps of what you just did, transitions, closers, hedging stacks, a point made twice, an example illustrating something already said, any sentence whose removal loses nothing I could check.

**Keep verbatim:** code, commands, flags, file paths, line numbers, error text, quoted language, numbers with their units, and qualifiers that carry meaning (`~10 min`, `untested`, `in this repo only`, `correlation, not causation`). Never turn a hedge into a claim.

**Structure:** bullets when the content genuinely is a list — options, steps, findings, comparisons. If one sentence lists three or more parallel items (costs, assumptions, caveats, failure modes), break it into bullets rather than leaving it as running prose. Prose when the content is one chain of reasoning; do not break an argument into bullets. If a bullet runs past two sentences, separate the point from its support: the point as the bullet, the specifics nested under it. A table when comparing three or more things on two or more attributes. Keep the original order for steps and dependency chains; otherwise lead with the thing I act on.

**Length:** about half the original once it is over ~200 words. If you cannot get there without dropping information, get as close as the content allows — the ratio is secondary to completeness. If there is nothing left to cut, say so in one line rather than padding.

**Output:** the compressed text only. No header, no divider, no "here is the shorter version", no offer to expand.

Before you write it, list the information units in the original to yourself — findings, numbers, caveats, actions, warnings — and make sure each one appears in your version. Then check the other direction: nothing in your version that was not in the original. No new claims, no fabricated tool calls or files, no dropped scope statements ("based only on the two files you showed"), no confidence the original did not have.

If the target is not something you already said — a file, a stack trace, "the last 20 commits", "this PR" — go read it first, name the scope you actually read, then compress it.

This is read-only: do not edit files or run mutating commands to compress something. If the target is genuinely ambiguous, ask one line instead of guessing.
