# Jules Palette: Rover Dumper

## Architecture: Zero-Server Client-Side Exports
- **Pattern**: Using browser sessions to authorize API calls for bulk data export.
- **Workflow**: Identify -> Paginate -> Fetch (Sequential) -> Zip (JSZip) -> Blob Download.
- **Why**: Maximizes privacy and minimizes infrastructure costs/security risks.

## UX & Content Strategy
- **Audience Split**:
    - **Landing Page (index.html)**: Non-technical "Quick Start", feature highlights, and clear visual installation aids (steps, browser-specific notes).
    - **Developer Docs (README.md)**: Technical workflow, architecture, and build instructions.
- **SEO/AEO**: Invisible metadata (Open Graph, Meta Description, Twitter Cards) used to improve discoverability without cluttering the UI.

## Build Orchestration
- **Automation**: Build script (`build.sh`) handles bundling, minification, and direct injection of the bookmarklet payload into the landing page HTML.
