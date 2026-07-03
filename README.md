<p align="center">
  <img src="assets/brand/trimline-wordmark.svg" alt="Trimline - Clean the page. Keep the thread." width="520">
</p>

# Trimline

**Clean the page. Keep the thread.**

Trimline is an open-source Chrome/Chromium extension that trims distracting website sections while keeping the original page intact.

It is built for readers and researchers who want cleaner articles, docs, blogs, search pages, and research-heavy layouts without switching into a full reader mode.

## Features

- Highlight likely removable sections before hiding anything.
- Remove sidebars, comments, sticky bars, related sections, and recommendations.
- Pick missed elements manually.
- Undo the latest removal or restore a specific hidden section.
- Preview the cleaned page before saving.
- Save rules for one page or a whole website.
- Auto-apply saved rules with per-site permission.
- Apply reversible reader-width adjustments.
- Export and import local rules as JSON.
- Store rules and settings locally in `chrome.storage.local`.

## Latest builds

Trimline is not on the Chrome Web Store yet. Until then, download the latest ZIP build from GitHub Releases:

[Download the latest Trimline build](https://github.com/Ashirwad-Shetye/trimline/releases/latest)

To install a ZIP build:

1. Download `trimline-vX.Y.Z.zip` from the latest release.
2. Unzip it.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped Trimline folder.

Web Store installation is planned for a future release.

## Install from source

```bash
npm install
npm run icons
npm run build
```

Then load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist` folder.

## Quick start

1. Open a normal web page.
2. Open Trimline from the browser toolbar.
3. Choose preset filters such as **Sidebars**, **Comments**, and **Sticky bars**.
4. Click **Start Focus Mode**.
5. Remove highlighted sections or use **Pick Element**.
6. Click **Done** and save rules for **This Page** or **Whole Website**.

Read the full guide in [docs/USAGE.md](docs/USAGE.md).

## Privacy

Trimline is local-first:

- No account.
- No cloud sync.
- No analytics.
- No broad host permissions by default.
- Rules and settings stay in `chrome.storage.local`.
- Per-site host permission is requested only when you enable auto-apply for that site.

## Development

```bash
npm install
npm run icons
npm run build
```

Useful scripts:

- `npm run icons`: generate Chrome PNG icons from `assets/brand/trimline-logo.svg`.
- `npm run build`: verify package/manifest versions, type-check, and build the extension.
- `npm run package`: build and create a release ZIP in `releases/`.
- `npm run dev`: run Vite during UI development.

## Project structure

```text
src/popup/       React popup widget
src/content/     Page scanner, highlighter, picker, hide/restore logic
src/background/  MV3 service worker, permissions, auto-apply coordination
src/shared/      Types, storage, URL helpers, matching, Chrome wrappers
src/styles/      Tailwind entry styles
assets/brand/    Logo and wordmark SVG assets
public/          Manifest and generated extension icons
docs/            Usage and brand documentation
scripts/         Build helper scripts
```

## Contributing

Contributions are welcome. Good places to help:

- Site compatibility fixes.
- Conservative matching improvements.
- UI polish.
- Accessibility.
- Documentation.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT License. See [LICENSE](LICENSE).
