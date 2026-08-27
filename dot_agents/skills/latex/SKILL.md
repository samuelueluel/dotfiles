---
name: latex
description: Rules for writing math as delimited LaTeX so it renders as terminal Unicode in Pi chat. Use when math, equations, formulas, or statistical/econometric notation appears in conversation, and when deciding whether math should be inline, in a display block, or inside a code fence.
---

# LaTeX Math Rendering

Pi renders delimited LaTeX into terminal Unicode in interactive chat. Math written as plain text, Unicode glyphs, or unsupported LaTeX will fail conversion and render as raw text.

## Core Rules

1. **Always Delimit:** Wrap all mathematical notation, variables, and symbols in `$...$` (inline) or `$$...$$` / `\[...\]` (display blocks). Never write bare text like `beta_1` or Unicode `β₁`.
2. **Whole-Block Fallback:** If a single unsupported construct occurs in a block, the **entire block** fails back to raw LaTeX source. Keep math strictly within the supported set.
3. **No Math in Code Fences:** Code fences keep text raw by design. Only place LaTeX inside code fences if presenting raw `.tex` source code or `esttab` code.
4. **Delimiters Hug Content:** Write `$\beta_1$`, not `$ \beta_1 $`. Ensure all opening `$` delimiters have matching closings.
5. **Re-Typeset OCR / Sidecar Formulas:** MinerU sidecars and web text mix raw LaTeX and Unicode OCR artifacts. Always normalize and re-typeset formulas into supported delimited LaTeX.

## Supported LaTeX Constructs

- **Delimiters:** Inline `$...$`, display `$$...$$` or `\[...\]`.
- **Fractions:** `\frac{1}{N}`, `\tfrac{1}{2}`, `\dfrac{a}{b}`, `\frac{\partial y}{\partial x}`.
- **Sub / Superscripts:** `x_{it+1}`, `e^{-\lambda t}`, `\hat{\beta}_{gmm}`, `(X'X)^{-1}`, `x'`.
- **Greek & Operators:** `\alpha \beta \gamma \delta \varepsilon \mu \sigma \lambda \theta \phi \omega \partial`, `\sum_{i=1}^N`, `\int_0^1`, `\prod`, `\lim`, `\log`, `\ln`, `\exp`, `\max`, `\min`, `\operatorname{plim}`.
- **Relations & Arrows:** `\leq \geq \neq \approx \sim \equiv \propto \perp \mid \in \subset \subseteq`, `\to \rightarrow \Rightarrow \mapsto \longrightarrow \leftrightarrow \Longleftrightarrow`.
- **Over / Under Modifiers:** `\overset{d}{\to}` (renders $\to^d$), `\stackrel{p}{=}` (renders $=^p$), `\underset{i}{\max}`.
- **Accents & Styles:** `\hat{\beta} \widehat{y} \bar{x} \overline{X} \tilde{\varepsilon} \vec{v} \dot{x} \ddot{x}`, `\mathbf{X} \mathbb{R} \mathcal{F} \boldsymbol{\beta} \pmb{X} \mathrm{gmm} \text{if }`.
- **Sizing & Delimiters:** `\left( \right)`, `\left[ \right]`, `\left\{ \right\}`, `\left| \right|`, `\left. \right|_{x=0}`, `\big( \Big[`.
- **Matrices & Environments:** `matrix`, `pmatrix`, `bmatrix`, `cases`, `aligned`, `gathered`.
- **Roots, Spacing & Dots:** `\sqrt{n}`, `\sqrt[3]{x}`, `\qquad \quad \, \; \!`, `\ldots \cdots \vdots \ddots`.

## Known Traps & Safe Replacements

| Unsupported / Broken Trap | Safe Replacement | Notes |
|---|---|---|
| `\xrightarrow{d}`, `\xleftarrow`, any `\x...arrow` | `\overset{d}{\to}` or `\overset{p}{\to}` | `\x...arrow` breaks the entire block; `\overset` renders cleanly. |
| `\triangleq`, `\approxeq` | `\stackrel{def}{=}` or prose ("is defined as") | Obscure relation symbols revert block to raw LaTeX. |

## Broken vs. Fixed Examples

| Broken (Raw or Plain Text) | Fixed (Clean Terminal Unicode) |
|---|---|
| `beta_1 = 0.5` | `$\beta_1 = 0.5$` |
| `y_it = a_i + g_t + d*D_it` | `$y_{it} = \alpha_i + \gamma_t + \delta D_{it}$` |
| `\frac{1}{N} sum x_i` (no delimiters) | `$\frac{1}{N}\sum_{i=1}^{N} x_i$` |
| `$$\hat{\beta} = (X'X)^{-1}X'y$$` inside code fence | `$$\hat{\beta} = (X'X)^{-1}X'y$$` outside fence |
| `V = (G'WG)⁻¹ G'WΩ WG (G'WG)⁻¹` (bare Unicode) | `$V = (G'WG)^{-1}G'W\Omega WG(G'WG)^{-1}$` |
| `ûᵢ = yᵢ - Xᵢβ̂` (combining Unicode marks) | `$\hat{u}_i = y_i - X_i\hat{\beta}$` |
| `$$\sqrt{n}(\hat{\beta}-\beta) \xrightarrow{d} N(0,V)$$` | `$\sqrt{n}(\hat{\beta}-\beta) \overset{d}{\to} N(0, V)$` |
