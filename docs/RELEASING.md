# Releasing Trimline

Trimline release builds are distributed as ZIP files through GitHub Releases until the extension is available in the Chrome Web Store.

## Checklist

1. Update `package.json` and `public/manifest.json` to the same semver version.
2. Run:

   ```bash
   npm install
   npm run icons
   npm run package
   ```

3. Confirm the ZIP exists:

   ```bash
   ls releases/trimline-v*.zip
   ```

4. Confirm the ZIP contains extension files at the root:

   ```bash
   unzip -l releases/trimline-v0.1.0.zip
   ```

   Expected root files include `manifest.json`, `popup.html`, `popup.js`, `background.js`, `content.js`, `assets/`, `chunks/`, and `icons/`.

5. Commit the release prep changes.
6. Create a git tag:

   ```bash
   git tag v0.1.0
   git push origin master --tags
   ```

7. Create the GitHub Release:

   ```bash
   gh release create v0.1.0 releases/trimline-v0.1.0.zip \
     --title "Trimline v0.1.0" \
     --notes "Initial public build."
   ```

## Manual install instructions for users

1. Download the latest `trimline-vX.Y.Z.zip` from GitHub Releases.
2. Unzip it.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped Trimline folder.

## Notes

- Do not commit `dist/` or `releases/`.
- Run `npm run icons` only when logo assets change.
- `npm run package` runs the full build before creating the ZIP.
- GitHub Releases is the canonical place for downloadable ZIP builds until Web Store distribution is ready.
