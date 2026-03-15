## 2026-03-15 - [Improving Bookmarklet Accessibility]
**Learning:** Even simple bookmarklet overlays should follow dialog accessibility standards, including ARIA roles, modal attributes, and proper label associations. Keyboard accessibility (like Escape to close) is often overlooked in bookmarklets but provides a significant UX improvement for power users.
**Action:** Always include `role="dialog"`, `aria-modal="true"`, and `Escape` key handling when creating custom modal overlays in bookmarklets or browser-injected scripts.
