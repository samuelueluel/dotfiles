---
name: latex
description: Rules for writing math as delimited LaTeX in Pi chat. pi-math renders supported formulas as terminal images in compatible Pi TUI terminals and preserves source when rendering is unavailable. Use when math, equations, formulas, or statistical/econometric notation appears in conversation, and when deciding whether math should be inline, in a display block, or inside a code fence.
---

# LaTeX Math Rendering in Pi

pi-math renders complete, supported LaTeX spans with MathJax and terminal images. Ghostty and Kitty can show inline formulas as real terminal cells and display formulas as centered image blocks. If image rendering is unavailable, disabled, or the formula fails MathJax or a safety limit, Pi leaves the original LaTeX visible. Stored messages and model context retain the original source.

## Core Rules

1. **Always Use Delimiters:** Wrap all math variables, numbers, and symbols in `$...$` or `\(...\)` (inline), or `$$...$$` / `\[...\]` (display blocks). Never write bare text like `beta_1` or bare symbols like `β₁`.
2. **Use MathJax-Compatible LaTeX:** The renderer supports much more than a short command allowlist, but not every package or macro. If a formula is unsupported, pi-math preserves the original delimited source; it does not approximate the formula with Unicode.
3. **No Math Inside Code Fences:** Code blocks (```) keep text raw on purpose. Never put math inside code fences unless you are explicitly showing raw `.tex` source code or Stata `esttab` output.
4. **Keep Inline Delimiters Tight:** Write `$\beta_1$`, not `$ \beta_1 $`. Do not put whitespace immediately inside `$...$`, and always make sure opening and closing delimiters are paired.
5. **Clean Up Extracted Formulas:** Text from web pages or MinerU sidecars often mixes messy OCR symbols with raw LaTeX. Always re-type formulas using clean LaTeX commands.

## Renderer Behavior and Common Constructs

- **Delimiters:** Inline `$...$` or `\(...\)`, display `$$...$$` or `\[...\]`.
- **Display environments:** Common environments such as `equation`, `align`, `aligned`, `gather`, matrices, `cases`, and `CD` are supported.
- **Source preservation:** Rendering is display-only. Do not rewrite a user's stored LaTeX merely to make the terminal image render.
- **Terminal fallback:** If formulas appear as raw LaTeX, check `/math-render status`; `/math-render on|off|clear` controls the renderer. Unsupported terminals, tmux, and screen intentionally use the source fallback.

MathJax handles the layout, so use standard LaTeX rather than hand-built Unicode geometry:

- **Fractions:** `\frac{1}{N}`, `\tfrac{1}{2}`, `\dfrac{a}{b}`, `\frac{\partial y}{\partial x}`.
- **Sub / Superscripts:** `x_{it+1}`, `e^{-\lambda t}`, `\hat{\beta}_{gmm}`, `(X'X)^{-1}`, `x'`.
- **Greek & Operators:** `\alpha \beta \gamma \delta \varepsilon \mu \sigma \lambda \theta \phi \omega \partial`, `\sum_{i=1}^N`, `\int_0^1`, `\prod`, `\lim`, `\log`, `\ln`, `\exp`, `\max`, `\min`, `\operatorname{plim}`.
- **Relations & Arrows:** `\leq \geq \neq \approx \sim \equiv \propto \perp \mid \in \subset \subseteq`, `\to \rightarrow \Rightarrow \mapsto \longrightarrow \leftrightarrow \Longleftrightarrow`.
- **Over / Under Modifiers:** `\overset{d}{\to}` (renders $\to^d$), `\stackrel{p}{=}` (renders $=^p$), `\underset{i}{\max}`.
- **Accents & Styles:** `\hat{\beta} \widehat{y} \bar{x} \overline{X} \tilde{\varepsilon} \vec{v} \dot{x} \ddot{x}`, `\mathbf{X} \mathbb{R} \mathcal{F} \boldsymbol{\beta} \pmb{X} \mathrm{gmm} \text{if }`.
- **Sizing & Delimiters:** `\left( \right)`, `\left[ \right]`, `\left\{ \right\}`, `\left| \right|`, `\left. \right|_{x=0}`, `\big( \Big[`.
- **Matrices & Environments:** `matrix`, `pmatrix`, `bmatrix`, `cases`, `aligned`, `gathered`.
- **Roots, Spacing & Dots:** `\sqrt{n}`, `\sqrt[3]{x}`, `\qquad \quad \, \; \!`, `\ldots \cdots \vdots \ddots`.

## Portability Fallbacks

pi-math accepts many standard MathJax constructs, but these replacements are useful when the same formula must also work in a narrower renderer:

| Potential portability trap | Safe replacement | Notes |
|---|---|---|
| `\xrightarrow{d}`, `\xleftarrow`, or another `\x...arrow` | `\overset{d}{\to}` or `\overset{p}{\to}` | `\overset` is the safer cross-renderer form. |
| `\triangleq`, `\approxeq` | `\stackrel{def}{=}` or prose ("is defined as") | Use a common relation when portability matters. |

## Broken vs. Fixed Examples

| Broken (Raw or Plain Text) | Fixed (renders as a terminal image in compatible Pi TUI terminals) |
|---|---|
| `beta_1 = 0.5` | `$\beta_1 = 0.5$` |
| `y_it = a_i + g_t + d*D_it` | `$y_{it} = \alpha_i + \gamma_t + \delta D_{it}$` |
| `\frac{1}{N} sum x_i` (no delimiters) | `$\frac{1}{N}\sum_{i=1}^{N} x_i$` |
| `$$\hat{\beta} = (X'X)^{-1}X'y$$` inside code fence | `$$\hat{\beta} = (X'X)^{-1}X'y$$` outside fence |
| `V = (G'WG)⁻¹ G'WΩ WG (G'WG)⁻¹` (bare Unicode) | `$V = (G'WG)^{-1}G'W\Omega WG(G'WG)^{-1}$` |
| `ûᵢ = yᵢ - Xᵢβ̂` (combining Unicode marks) | `$\hat{u}_i = y_i - X_i\hat{\beta}$` |
| `$$\sqrt{n}(\hat{\beta}-\beta) \xrightarrow{d} N(0,V)$$` | `$\sqrt{n}(\hat{\beta}-\beta) \overset{d}{\to} N(0, V)$` |
