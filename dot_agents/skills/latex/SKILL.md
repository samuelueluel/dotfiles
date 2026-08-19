---
name: latex
description: Rules for writing math as delimited LaTeX so it renders as terminal Unicode in Pi chat. Use when math, equations, formulas, or statistical/econometric notation appears in conversation, and when deciding whether math should be inline, in a display block, or inside a code fence.
---

# LaTeX Math Rendering

Pi's interactive TUI renders delimited LaTeX to terminal Unicode. The capability set below is **verified against the installed renderer** (pi 0.84.1 / pi-tui 0.84.1 `latex.js`) — use it confidently. Math written as plain text, Unicode glyphs, or LaTeX the renderer can't convert stays raw and looks broken.

## The rules

1. **Always delimit.** Every piece of math goes inside `$...$` (inline) or `$$...$$` / `\[...\]` (own line). A single symbol counts: write `$\beta_1$`, never `beta_1` or β₁.
2. **Display blocks for anything that deserves its own line.** Short expressions stay inline; multi-term equations get `$$...$$`.
3. **Code fences keep math raw — by design.** Use a fence only when the LaTeX source itself is the deliverable (a `.tex` snippet, `esttab`/`estout` table code). Real math never goes in a fence.
4. **Fallback is whole-block.** The renderer converts a `$...$` / `$$...$$` block as a unit: ONE unsupported construct anywhere inside reverts the ENTIRE block to raw LaTeX source (no partial math). Keep display blocks to the supported set.
5. **Clients differ.** The interactive TUI renders math; non-interactive surfaces (remote session, session exports, logs, plain-text clients) show raw source. If the user wants guaranteed typeset output, offer `/preview` (PNG image in terminal/browser) or use `preview_export` (HTML/PDF/PNG artifacts) — the preview pipeline renders full LaTeX via Pandoc/MathJax.

## Supported constructs — verified, use freely

- **Delimiters:** inline `$...$`; display `$$...$$` / `\[...\]`
- **Fractions:** `\frac{1}{N}`, `\tfrac{1}{2}`, `\dfrac{a}{b}`, `\frac{\partial y}{\partial x}`
- **Sub/superscripts** (multi-char, nested): `x_{it+1}`, `e^{-\lambda t}`, `\hat{\beta}_{gmm}`, `(X'X)^{-1}`, `x'`
- **Greek:** `\alpha \beta \gamma \delta \varepsilon \mu \sigma \lambda \theta \phi \omega` + variants (`\varepsilon, \varphi, \vartheta, \varsigma`), `\partial`
- **Relations:** `\leq \geq \neq \approx \sim \equiv \propto \perp \parallel \mid \in \subset \subseteq \preceq \succeq`
- **Arrows:** `\to \rightarrow \Rightarrow \mapsto \longrightarrow \leftrightarrow \hookrightarrow \Longleftrightarrow \Leftarrow`
- **Over/under anything:** `\overset{d}{\to}` → "→ᵈ", `\stackrel{p}{=}` → "=ᵖ", `\underset{i}{\max}` → "maxᵢ"
- **Operators:** `\sum_{i=1}^{N}`, `\int_0^1`, `\prod`, `\lim`, `\log \ln \exp \max \min`, `\operatorname{plim}`
- **Roots:** `\sqrt{n}`, `\sqrt[3]{x}`
- **Hats/bars/tildes/vectors/dots:** `\hat \widehat \bar \overline \tilde \vec \dot \ddot`
- **Bold/blackboard/script:** `\mathbf{X} \mathbb{R} \mathcal{F} \boldsymbol{\beta} \pmb{X}`
- **Text:** `\mathrm{gmm}`, `\text{if }`
- **Delimiters:** plain `( ) [ ] \{ \} |`; auto-sizing `\left( \right)`, `\left[ \right]`, `\left\{ \right\}`, `\left| \right|`, `\left. \right|_{x=0}`; manual `\big( \Big[`
- **Matrices:** `matrix`, `pmatrix`, `bmatrix` (break rows with `\\`, columns with `&`)
- **Multi-line:** `cases`, `aligned`, `align`, `gathered`
- **Spacing:** `\qquad \quad \, \; \!`
- **Dots:** `\ldots \cdots \vdots \ddots`

## Known traps — one of these reverts the whole block to raw source

| Trap | Safe form |
|---|---|
| `\xrightarrow{d}`, `\xrightarrow[under]{over}`, `\xleftarrow`, `\xleftrightarrow` — the whole `\x...arrow` family | `\overset{d}{\to}` (renders "→ᵈ") / `\overset{p}{\to}` ("→ᵖ"), or prose: "converges in distribution to" |
| Obscure relation symbols: `\triangleq`, `\approxeq` (and any symbol not obviously in the tables above) | `\stackrel{def}{=}` ("=ᵈᵉᶠ"), or prose: "is defined as" / "approximately" |

Anything in the supported list is safe. When unsure whether a construct renders, test it alone in a one-line `$...$` before building a display block around it.

## Do / Don't

- **DO** wrap every symbol in delimiters, even lone ones (`$p < 0.01$`, `$\hat{\beta}$`).
- **DO** break long equations with `aligned` instead of one giant line.
- **DON'T** write math as plain text or Unicode — `beta_1`, `β̂`, `y_it`, `Ω`, `⁻¹`, `ûᵢ`. Unicode glyphs are literal text, not rendered math, and combining marks (`û`, `β̂`) misalign in terminals. Every formula, however short, goes in `$...$`.
- **DON'T** copy equations verbatim from a source (paper, MinerU sidecar, web page) — sources mix raw LaTeX and OCR Unicode. Re-typeset every quoted equation in supported delimited LaTeX.
- **DON'T** use the `\x...arrow` family or `\triangleq`-style obscurities — they null the whole block.
- **DON'T** fence math — a fence makes it raw by design.

## Pre-send check (2 seconds)

1. Every `$` has a closing mate — delimiters are balanced.
2. No math trapped inside a code fence (unless the source is the deliverable).
3. No `\x...arrow` or unknown-symbol constructs inside `$...$` — if unsure, test the construct alone first.
4. Delimiters hug the math: `$\beta$`, not `$ \beta $`.
5. Scan for stray math outside `$...$`: bare Greek letters (`Ω`, `Σ`, `β`), Unicode superscripts (`⁻¹`), combining marks (`û`, `β̂`), un-delimited `\command` fragments.

## Broken → fixed

| Broken (raw spew or plain text) | Fixed (renders) |
|---|---|
| `beta_1 = 0.5` | `$\beta_1 = 0.5$` |
| `y_it = a_i + g_t + d*D_it` | `$y_{it} = \alpha_i + \gamma_t + \delta D_{it}$` |
| `\frac{1}{N} sum x_i` (no delimiters) | `$\frac{1}{N}\sum_{i=1}^{N} x_i$` |
| `$$\hat{\beta} = (X'X)^{-1}X'y$$` inside a code fence | `$$\hat{\beta} = (X'X)^{-1}X'y$$` outside the fence |
| `V = (G'WG)⁻¹ G'WΩ WG (G'WG)⁻¹` (bare Unicode) | `$V = (G'WG)^{-1}G'W\Omega WG(G'WG)^{-1}$` |
| `ûᵢ = yᵢ - Xᵢβ̂` (combining marks) | `$\hat{u}_i = y_i - X_i\hat{\beta}$` |
| `$$\sqrt{n}(\hat{\beta}-\beta) \xrightarrow{d} N(0,V)$$` | `$\sqrt{n}(\hat{\beta}-\beta) \overset{d}{\to} N(0, V)$` |
