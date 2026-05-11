# Press Theme Glasswing

Glasswing is an official Press theme for homepage-style editorial sites.

The index view treats the first page as a publication front page: one hero story, three secondary stories, then compact rows. Later pages and search results use a dense list.

## Repository Layout

- `theme-repo.json` - release metadata for this theme repository.
- `theme/theme.json` - Press runtime manifest for the theme.
- `theme/theme.css` - theme stylesheet.
- `theme/modules/glasswing.js` - Glasswing layout and view renderers.
- `theme-release.json` - latest release manifest consumed by Press Theme Manager.
- `.github/workflows/theme-release.yml` - package, verify, publish, and manifest workflow.

## Release Flow

Pushes to `main` that change `theme/**` or `theme-repo.json` automatically publish a patch release. Use **Actions > Theme Release > Run workflow** when you need to publish a specific tag such as `v0.2.0`.

Each release publishes:

- `press-theme-<slug>-vX.Y.Z.zip` on the GitHub Release.
- A browser-fetchable ZIP copy on the `release-artifacts` branch.
- A root `theme-release.json` manifest with the ZIP URL, size, SHA-256 digest, and file inventory.

Press only consumes the released ZIP and installs it into a site under `assets/themes/glasswing/`.

## Contract Checks

The release workflow checks out `EkilyHQ/Press`, copies this repository's `theme/` folder into the Press theme directory, and runs the Press theme contract tests. Keep `theme/theme.json` aligned with the current Press theme contract.
