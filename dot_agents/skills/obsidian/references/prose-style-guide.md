# Obsidian Note Prose & Style Guide

Load this file when writing or editing note content in Obsidian. This guide sets the standards for tone, word choice, sentence structure, and information density.

**Scope:** Governs natural language prose in notes (descriptions, explanations, takeaways, and comments). Does not restrict code blocks, shell commands, variable names, LaTeX math, or programmatic syntax.

---

## 1. Target Audience and Purpose

Vault notes serve as durable system documentation, research logs, and persistent working memory. They have two equally important readers:

1. **Samuel:** An applied empirical economist who needs fast scanning, zero filler, sharp technical accuracy, and natural prose. Clichéd AI waffle, sycophancy, repetitive summaries, and patronizing transitions waste his time and obscure key takeaways.
2. **Future AI Agents:** Agents that parse notes to execute commands, enforce rules, or recover past context. Vague phrasing, ambiguous adjectives, and dense jargon cause models to hallucinate requirements and burn unnecessary tokens.

Good vault prose reads like crisp, authoritative documentation written by a sharp colleague—plain, literate, high-density English with zero marketing fluff or robotic telegraph-speak.

---

## 2. Core Style Rules

1. **Write for fast skimming:** Put the primary conclusion, rule, or takeaway in the first sentence of each section or paragraph. Samuel should be able to scan headings and leading sentences to find what he needs in seconds.
2. **State facts and rules directly:** Use active voice and simple verbs (`runs`, `checks`, `blocks`, `writes`, `saves`). Avoid passive constructions (`is executed by`, `was determined to be`).
3. **High signal-to-noise ratio:** Every sentence must deliver concrete facts, decisions, rules, paths, or code. Cut any sentence that can be removed without losing information.
4. **Natural, literate flow:** Vary sentence length and structure to create a natural, readable rhythm. Avoid both extremes: do not write robotic, choppy telegraph-speak, and do not write winding, clause-stuffed run-ons. When a cohesive prose paragraph explains a concept or mechanism better than bullets, write a well-crafted paragraph.
5. **Clear syntactic structure:** Sentences can be complex when expressing conditions, trade-offs, or relationships, but the grammatical subject and main action should be immediately clear. Avoid nested qualifiers, defensive parentheticals, and tangled clauses that force the reader to backtrack to find the point.
6. **Be concrete, not abstract:** Give exact file paths, tool names, parameters, error messages, and command flags. Never use vague descriptions when exact names exist.
7. **Keep rationale focused:** State the reason for a rule or decision in a direct phrase or clause (for example: "...to prevent whitespace errors in macro expansions"). Avoid lengthy philosophical defenses.

---

## 3. Ban LLM-isms and Artificial Buzzwords

AI agents naturally slip into predictable buzzwords, faux-academic jargon, and promotional language. Cut these words and phrases entirely:

### 3.1. Promotional and Grandiose Words
Never inflate the importance or quality of tools, configs, or rules:
- **Banned:** `crucial`, `vital`, `paramount`, `pivotal`, `testament`, `beacon`, `powerhouse`, `masterfully`, `robustly`, `game-changer`.
- **Replacement:** State the requirement directly (`required`, `needed`, `must`) or state what the component does.

### 3.2. Cliché Metaphors and Filler Nouns
Avoid empty conceptual packaging:
- **Banned:** `tapestry`, `landscape`, `ecosystem`, `orchestration`, `dance`, `journey`, `realm`, `mechanisms of`.
- **Replacement:** Use the actual noun (`setup`, `system`, `tools`, `repository`, `scripts`, `rules`).

### 3.3. Cliché AI Action Verbs
- **Banned:** `delve`, `dive into`, `unpack`, `harness`, `leverage`, `utilize`, `foster`, `streamline`, `supercharge`.
- **Replacement:** `read`, `inspect`, `check`, `use`, `speed up`, `run`, `apply`.

### 3.4. Throat-Clearing and Transitions
Never waste lines introducing a thought or wrapping it up:
- **Banned:** `It is important to note that`, `It should be emphasized that`, `Notably`, `In conclusion`, `In summary`, `At the end of the day`, `Furthermore`, `Moreover`.
- **Replacement:** Delete the phrase completely and start directly with the fact or rule.

### 3.5. Domain Precision vs. Gratuitous Jargon

- **Prefer plain words for general text:** Never use heavy vocabulary or abstract compound phrases to make routine observations sound sophisticated.
- **Use precise domain terms for specialized topics:** When discussing econometrics, statistics, Linux, Stata, or system architecture, use exact technical terms (e.g. `parallel trends`, `fixed effects`, `clustering`, `Wayland compositor`, `symlink`, `SHA-256`) whenever they improve clarity and precision.
- **Banned Gratuitous Jargon:** `stochastic compliance`, `deterministic scaffolding`, `thematic anchoring`, `epistemic grounding`, `mechanistic isolation`.
- **Plain Replacements:** `prompt instructions`, `automated scripts`, `topic grouping`, `factual sources`, `sandboxing`.

---

## 4. Information Density Guidelines

- **Paragraphs over bullet salads:** Do not break a cohesive, flowing explanation into a list of fragmented single-sentence bullets. Use bullets for genuinely distinct items or steps; use structured prose paragraphs when explaining concepts, relationships, or mechanisms.
- **No summary rehashes:** Do not add a concluding paragraph or summary bullet that repeats what the section just explained.
- **No rhetorical questions:** Never write headers or sentences like *"Why does this matter?"* or *"How do we solve this?"*. State the problem and solution directly.
- **Clear imperatives:** Use direct commands for instructions:
  - Good: `Run python3 script.py --diff before applying changes.`
  - Bad: `It is generally advisable for users to ensure they have executed a dry run via the --diff argument prior to final execution.`
- **Frontmatter descriptions:** Write 1–2 plain, informative sentences in double quotes. Focus on what the note covers and why it exists. Avoid jargon and promotional words.

---

## 5. Before-and-After Examples

### Example 1: Frontmatter Description
- **Bloated LLM-ese:**
  ```yaml
  description: "A comprehensive architectural blueprint detailing the vital mechanisms and decoupled specifications for a powerhouse Stata linter that guarantees seamless code safety."
  ```
- **Clean Vault Style:**
  ```yaml
  description: "Architecture and specifications for the Stata safety linter and house style formatter."
  ```

### Example 2: Technical Explanation
- **Bloated LLM-ese:**
  ```markdown
  It is crucial to understand that our workflow-invariants extension serves as a robust testament to deterministic scaffolding. By seamlessly intercepting commands, it harnesses native compiler checks to ensure that stochastic prompt compliance does not compromise the host system.
  ```
- **Clean Vault Style:**
  ```markdown
  The `workflow-invariants.ts` extension intercepts tool calls before execution. It runs fast syntax checks on modified files and blocks commands that violate system boundaries.
  ```

### Example 3: Instruction Rules
- **Bloated LLM-ese:**
  ```markdown
  When navigating the intricate landscape of data merging, researchers must delve deep into key uniqueness. Furthermore, it is paramount to avoid silently dropping observations, which could fundamentally distort the empirical findings.
  ```
- **Clean Vault Style:**
  ```markdown
  Check key uniqueness with `isid` before every merge. Never drop observations without logging the reason and the count of dropped rows.
  ```
