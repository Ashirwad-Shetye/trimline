# Contributing to Trimline

Thanks for helping make busy websites easier to read. Trimline is a Chrome/Chromium Manifest V3 extension that trims distracting page sections while keeping the original page intact.

## Setup

```bash
npm install
npm run icons
npm run build
```

Load the built extension from `dist/`:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `dist` folder.

## Development workflow

- Keep changes small and focused.
- Prefer existing patterns in `src/popup`, `src/content`, `src/background`, and `src/shared`.
- Run `npm run build` before opening a PR.
- Run `npm run icons` only when changing `assets/brand/trimline-logo.svg`.
- Do not add broad host permissions.
- Keep saved rules local-only unless a future issue explicitly changes that direction.

## Good contributions

- Site compatibility fixes with reproducible URLs.
- Conservative rule matching improvements.
- UI polish that keeps controls readable in light and dark modes.
- Accessibility improvements.
- Documentation updates.
- Small refactors that reduce complexity without changing behavior.

## Site compatibility reports

Please include:

- URL.
- Browser and OS.
- What you tried.
- Expected result.
- Actual result.
- Screenshot or screen recording if possible.
- Exported rules JSON if the issue involves saved rules.

## Pull request checklist

- The change is scoped to one issue or behavior.
- `npm run build` passes.
- User privacy is not weakened.
- Existing exports/imports remain backward-compatible unless the PR clearly documents a migration.
- UI changes are checked in light and dark mode.

## Labels maintainers can use

- `good first issue`
- `site compatibility`
- `ui polish`
- `rule matching`
- `documentation`
- `accessibility`
- `privacy`
- `bug`

## Code of conduct

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
