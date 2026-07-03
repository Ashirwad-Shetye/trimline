# Using Trimline

Trimline cleans busy web pages in place. It does not replace the page with a separate reader view. Hidden sections are reversible, and saved rules stay in `chrome.storage.local`.

## Start Focus Mode

Open a normal article, docs page, blog, search result, or research-heavy page. Click the Trimline extension icon, then choose **Start Focus Mode** or **Edit Focus Mode**.

Trimline scans the visible page and highlights sections that are likely safe to remove.

Restricted browser pages such as `chrome://` pages, extension pages, and browser stores cannot run Trimline.

## Presets

Preset chips control what Trimline scans before edit mode starts.

- **Sidebars**: side navigation, table of contents, left/right rails, complementary regions.
- **Comments**: comments, discussions, replies, related content, recommendations, newsletters, promo sections.
- **Sticky bars**: sticky headers, fixed bars, cookie-style banners, persistent toolbars.

Presets only control discovery. Nothing is removed until you choose it.

## Remove sections

Highlighted sections show a small **Remove** button. Clicking it hides the section with Trimline-owned attributes and styles. The page reflows naturally when possible.

## Pick Element

Use **Pick Element** when Trimline misses something. Click the control, then click a section on the page. Picked sections are saved as manual rules if you save the session.

## Undo

The toolbar shows **Undo last** for one hidden section and **Undo** with a menu for multiple hidden sections. The menu lets you restore a specific section from the current editing session.

Undo is temporary for the current page session. To permanently delete saved rules, use the popup rules screen.

## Preview cleaned page

When at least one section is hidden, **Preview cleaned page** hides Trimline's edit controls so you can inspect the page. Use **Back to editing**, **Esc**, or **Done** to leave preview.

## Done and saving

Click **Done** when finished.

- If you made no new removals, edit mode exits without asking to save.
- If you removed new sections, Trimline asks how to save them.

Save scopes:

- **This Page**: applies only to the exact page.
- **Whole Website**: applies across the same website.

Exact page rules take priority over website rules.

## Auto-apply

When saving, you can enable **Auto-apply**. For website-level rules, Trimline requests permission only for that site. If permission is denied, rules stay saved but auto-apply remains off.

Auto-apply is conservative. If a saved rule match is low-confidence, Trimline does not hide it automatically and marks it for review.

## Saved websites

Saved sites appear as cards in the popup. Each card shows:

- Domain.
- Last saved page title and URL.
- Scope.
- Auto-apply status.
- Rule count.

Click a card to open the last saved page. Click the rules pill to view saved rules for that site.

## Rules screen

The rules screen lists saved rules grouped by **This Page** and **Whole Website**. Each rule shows a label, category, tag/path detail, and created date. Use the trash button to delete a saved rule.

## Reader width

Reader width is a global page adjustment, separate from saved cleanup rules.

- **Narrow**: 720px.
- **Comfort**: 860px.
- **Wide**: 1040px.
- **Custom**: 560px to 1280px.

Enable the reader width toggle to apply changes to the current tab. When disabled, width choices are saved but not applied.

## Reset current page

**Reset current page** restores hidden sections and removes reader-width styling on the active tab. It does not delete saved rules.

## Import and export

Use **Export JSON** to back up saved sites, rules, and settings. Use **Import JSON** to replace local rules and settings with a previous export.

Exports are local files. Trimline does not upload them.

## Privacy model

Trimline is local-first:

- No account.
- No cloud sync.
- No analytics.
- Saved rules and settings stay in `chrome.storage.local`.
- Host permission is requested per site only when auto-apply is enabled.
