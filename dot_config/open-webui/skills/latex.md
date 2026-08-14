---
name: latex
description: Rules for writing math as delimited LaTeX so it renders as web KaTeX equations in Open WebUI. Use when equations, formulas, or statistical/econometric notation appear in conversation.
---

# LaTeX Math Rendering (Open WebUI / KaTeX)

Open WebUI renders delimited LaTeX into mathematical typography using **KaTeX**. Math written as plain text or missing proper delimiters stays raw and looks unformatted. Follow these rules for all mathematical and econometric notation.

## Core Rules

1. **Always Delimit:** Wrap every piece of math inside `$...$` (inline) or `$$...$$` / `\[...\]` (display block on its own line). A single symbol counts: write `$\beta_1$`, never `beta_1` or β₁.
2. **Display Blocks:** Short inline expressions stay inline; multi-term or key structural equations get `$$...$$` on their own line.
3. **Code Fences Keep Math Raw:** Code blocks (```markdown) suppress KaTeX rendering by design. Use a code fence **only** when the LaTeX source itself is the deliverable (e.g. a `.tex` document snippet, `esttab` Stata table code). Real mathematical equations must stay outside code fences.
4. **Supported Constructs:** Stick to standard KaTeX constructs.

## Supported Constructs & Examples

- **Inline math:** `$y = a + bx$`
- **Display equation:** 
  $$y_{it} = \alpha_i + \gamma_t + \delta D_{it} + \varepsilon_{it}$$
- **Fractions:** `$\frac{1}{N}\sum_{i=1}^{N} x_i$`
- **Sub / Superscripts:** `$x_{it}$`, `$X'$`, `$e^{x}$`, `$T_i$`
- **Greek Letters:** `$\alpha, \beta, \gamma, \delta, \varepsilon, \mu, \sigma^2, \lambda$`
- **Sums & Integrals:** `$\sum_{t=1}^{T}$`, `$\int_0^1 f(x)\,dx$`
- **Roots:** `$\sqrt{n}(\hat{\theta} - \theta_0)$`
- **Estimators / Matrices:** `$\hat{y}$`, `$\bar{x}$`, `$\mathbf{X}$`, `$(X'X)^{-1}$`
- **Cases:**
  $$
  D_{it} = \begin{cases} 1 & \text{if } t \geq T_i \\ 0 & \text{otherwise} \end{cases}
  $$
- **Aligned Systems:**
  $$
  \begin{aligned}
  y_{it} &= \beta_0 + \beta_1 x_{it} + u_{it} \\
         &= \alpha_i + \delta D_{it} + \varepsilon_{it}
  \end{aligned}
  $$

## Pre-send Checklist

- [ ] Every `$` has a matching closing `$`.
- [ ] No mathematical equations trapped inside code fences.
- [ ] Delimiters hug the math: `$\beta$`, not `$ \beta $`.
- [ ] Lone symbols wrapped: `$p < 0.01$`, `$\hat{\beta}$`.
