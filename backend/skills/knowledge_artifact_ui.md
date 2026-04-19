---
name: artifact_ui
description: UI/UX and animation best practices for generating polished, performant artifact projects
type: knowledge
enabled: true
---

## Artifact UI/UX Guidelines

When generating or editing artifacts (React, vanilla, or full-stack projects), follow these rules to produce polished, production-quality output.

### Images & External Resources
- NEVER use external image URLs — they break in sandboxed previews and go stale.
- For logos and icons, use inline SVGs with real vector paths, not `<text>` elements pretending to be logos.
- For placeholder images, use CSS gradients, emoji, or simple SVG shapes.
- For icons, prefer a single lightweight icon set imported via npm (e.g. `lucide-react`) or inline SVGs.

### Animation & Motion
- Use CSS `@keyframes` and `transition` — avoid heavy JS animation libraries (framer-motion, GSAP) in artifacts.
- Prefer GPU-accelerated properties: `transform` (translate, scale, rotate) and `opacity`. Avoid animating `top`, `left`, `width`, `height`, `margin`, or `padding`.
- Scroll-triggered reveals: use `IntersectionObserver` with a simple `fade-in` CSS class. Pattern:
  ```
  .fade-in { opacity: 0; transform: translateY(20px); transition: opacity 0.6s, transform 0.6s; }
  .fade-in--visible { opacity: 1; transform: none; }
  ```
- Timing: 150–300ms for UI feedback (buttons, hovers), 400–800ms for decorative entrance animations.
- Use `transition-delay` for staggered grid reveals instead of JS timers.
- Add `prefers-reduced-motion: reduce` media query to disable decorative motion for accessibility.
- Hover/focus states: subtle scale (1.02–1.05) or shadow lift, not jarring jumps.

### Layout & Responsiveness
- Use CSS Grid for 2D layouts, Flexbox for 1D alignment.
- Design mobile-first: base styles for small screens, `@media (min-width: ...)` for larger.
- Use `clamp()` for fluid typography: e.g. `font-size: clamp(1rem, 2.5vw, 1.5rem)`.
- Avoid fixed pixel widths on containers; use `max-width` + `margin: 0 auto`.

### Color & Typography
- Maintain WCAG AA contrast (4.5:1 for body text, 3:1 for large text/UI).
- Limit to 2 font weights max. Use system font stack unless a specific font is requested.
- Use CSS custom properties for colors so themes are easy to adjust.
- For dark backgrounds, soften pure white text to `rgba(255,255,255,0.9)`.

### Code Quality
- Keep artifacts concise: prefer a single CSS file over scattered inline styles.
- Extract repeated values (colors, spacing) into CSS custom properties.
- Use semantic HTML: `<nav>`, `<main>`, `<section>`, `<footer>` — not `<div>` for everything.
- Ensure interactive elements have visible focus styles for keyboard accessibility.
