## 2024-05-24 - Bookmarklet Modal Accessibility & Keyboard Support
**Learning:** Browser bookmarklets often lack standard UX affordances like keyboard 'Escape' support and ARIA roles because they are usually minimal scripts. Adding these makes them feel like native browser features.
**Action:** Always include a global 'Escape' listener (with proper cleanup) and semantic ARIA attributes (`role="dialog"`, `aria-modal`) for bookmarklet-generated overlays.
