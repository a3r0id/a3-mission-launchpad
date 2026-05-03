# Renderer styling

**New UI** should be **Tailwind** utilities plus **design tokens** from `src/globals.css`. Those tokens are wired into Tailwind in `src/index.css` inside `@theme { ... }`.

- Prefer semantic classes: `bg-surface`, `text-heading`, `text-muted`, `border-border`, `bg-danger-soft`, `text-accent`, etc.
- Avoid raw hex in `className` (`text-[#…]`) unless there is truly no token.

**Legacy shared chrome** lives in **`src/styles/`**:

- **`legacy-chrome.css`** imports the split files in cascade order—do not reorder without checking overrides.
- Slices mirror old `app.less` areas: splash/spinner, shell layout, cards/status, buttons/forms, modals, mission edit modal, GitHub panel, mission resource + file tree, PBO extras, Testing page, proc monitor.

Extend these **only when** the same class names span many screens. Otherwise migrate toward Tailwind in the `.tsx` file.

When you add a **new CSS variable** in `globals.css`, add the matching **`--color-*` (or radius, etc.)** entry in `@theme` so Tailwind sees it.

**API helpers**: add modules under `src/utils/` and export through `src/utils/index.ts`. Do not introduce a second “god” helper object.
