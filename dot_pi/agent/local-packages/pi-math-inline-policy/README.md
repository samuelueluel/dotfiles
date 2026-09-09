# pi-math inline policy

This Chezmoi-managed helper keeps pi-math display-only:

- Display math still uses pi-math's MathJax terminal images.
- Inline math is left for Pi's native readable terminal renderer.

Apply or reapply it after reinstalling or updating `@monotykamary/pi-math`:

```bash
node /var/home/samuel/.pi/agent/local-packages/pi-math-inline-policy/apply.mjs
```

Then run `/reload` in Pi.

The helper fails closed if the upstream source no longer contains the expected patch point. Inspect the new `markdown-patch.ts` before changing the helper.

The helper itself is stored in Chezmoi at:

```text
/var/home/samuel/dotfiles/dot_pi/agent/local-packages/pi-math-inline-policy/
```
