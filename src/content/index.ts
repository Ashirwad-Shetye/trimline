import { AUTO_APPLY_CONFIDENCE, findRuleMatch } from "../shared/matcher";
import type { AutoApplyResult, ContentCommand, FocusPreset, HiddenSectionRule, ReadingSettings, RuleCategory, RuleScope, SaveRulesPayload } from "../shared/types";

const HIDDEN_ATTR = "data-focus-mode-hidden";
const CANDIDATE_ATTR = "data-focus-mode-candidate";
const ADJUSTED_ATTR = "data-focus-mode-adjusted";
const READING_ATTR = "data-focus-mode-reading-adjusted";
const STYLE_ID = "focus-mode-content-styles";
const STYLE_VERSION = "2026-07-03-watch-preview-v3";
const TOOLBAR_ID = "focus-mode-toolbar";
const MODAL_ID = "focus-mode-save-modal";
const PREVIEW_ID = "focus-mode-preview-return";
const WATCH_MAX_MS = 120_000;
const WATCH_INITIAL_MS = 90_000;
const WATCH_AFTER_SUCCESS_MS = 20_000;

type RemovedEntry = {
  element: HTMLElement;
  hiddenElement: HTMLElement;
  rule: HiddenSectionRule;
  source: "existingRule" | "newRemoval";
};

let removedStack: RemovedEntry[] = [];
let candidateElements: HTMLElement[] = [];
let pickerEnabled = false;
let previewEnabled = false;
let noMatchesFound = false;
let applyWatcher: ApplyWatcher | undefined;
const appliedRuleIds = new Set<string>();
const DEFAULT_PRESETS: FocusPreset[] = ["sidebars", "comments", "stickyBars"];

type ApplyWatcher = {
  rules: HiddenSectionRule[];
  observer: MutationObserver;
  startedAt: number;
  stopAt: number;
  timer: number | undefined;
  scheduled: number | undefined;
};

declare global {
  interface Window {
    __focusModeContentLoaded?: boolean;
  }
}

if (!window.__focusModeContentLoaded) {
  window.__focusModeContentLoaded = true;
  chrome.runtime.onMessage.addListener((command: ContentCommand, _sender, sendResponse) => {
    void handleCommand(command).then(sendResponse);
    return true;
  });
}

async function handleCommand(command: ContentCommand): Promise<unknown> {
  switch (command.type) {
    case "PING":
      return true;
    case "START_EDITING":
      stopApplyWatcher();
      startEditing(command.rules ?? [], command.presets?.length ? command.presets : DEFAULT_PRESETS);
      return true;
    case "APPLY_RULES":
      return applyRules(command.rules, false, Boolean(command.watch));
    case "APPLY_READING_SETTINGS":
      applyReadingSettings(command.reading);
      return true;
    case "RESET_READING_SETTINGS":
      restoreReadingAdjustments();
      return true;
    case "RESET_PAGE":
      resetPage();
      return true;
    default:
      return undefined;
  }
}

function startEditing(existingRules: HiddenSectionRule[], presets: FocusPreset[]): void {
  injectStyles();
  previewEnabled = false;
  noMatchesFound = false;
  document.getElementById(PREVIEW_ID)?.remove();
  resetCandidates();
  if (existingRules.length) applyRules(existingRules, true);
  candidateElements = findCandidates(presets);
  noMatchesFound = candidateElements.length === 0;
  candidateElements.forEach(markCandidate);
  renderToolbar();
}

function findCandidates(presets: FocusPreset[]): HTMLElement[] {
  const selected = new Set(presets);
  const selectors = [
    ...(selected.has("sidebars") ? sidebarSelectors() : []),
    ...(selected.has("comments") ? commentSelectors() : []),
    ...(selected.has("stickyBars") ? stickyBarSelectors() : [])
  ];

  const visible = selectors.length
    ? Array.from(document.querySelectorAll<HTMLElement>(Array.from(new Set(selectors)).join(","))).filter((element) => matchesSelectedPreset(element, selected))
    : [];
  const layoutCandidates = Array.from(document.body.querySelectorAll<HTMLElement>("main > *, article > *, body > *")).filter((element) =>
    matchesSelectedPreset(element, selected)
  );

  return dedupe([...visible, ...layoutCandidates]).slice(0, 28);
}

function sidebarSelectors(): string[] {
  return [
    "aside",
    "nav",
    "[role='complementary']",
    "[role='navigation']",
    "[class*='sidebar' i]",
    "[id*='sidebar' i]",
    "[class*='toc' i]",
    "[id*='toc' i]",
    "[class*='side-nav' i]",
    "[class*='sidenav' i]"
  ];
}

function commentSelectors(): string[] {
  return [
    "[class*='comment' i]",
    "[id*='comment' i]",
    "[class*='discussion' i]",
    "[id*='discussion' i]",
    "[class*='response' i]",
    "[id*='response' i]",
    "[class*='reply' i]",
    "[id*='reply' i]",
    "[class*='related' i]",
    "[class*='recommend' i]",
    "[class*='popular' i]",
    "[class*='trending' i]",
    "[class*='newsletter' i]",
    "[class*='subscribe' i]",
    "[class*='promo' i]",
    "[class*='advertisement' i]"
  ];
}

function stickyBarSelectors(): string[] {
  return [
    "header",
    "footer",
    "[class*='sticky' i]",
    "[id*='sticky' i]",
    "[class*='fixed' i]",
    "[class*='floating' i]",
    "[class*='cookie' i]",
    "[class*='banner' i]",
    "[class*='toolbar' i]"
  ];
}

function isReasonableCandidate(element: HTMLElement): boolean {
  if (isExtensionElement(element)) return false;
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  const viewportArea = window.innerWidth * window.innerHeight;
  if (area < 1600 || area > viewportArea * 0.72) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (element.closest(`[${HIDDEN_ATTR}], #${TOOLBAR_ID}`)) return false;
  return true;
}

function matchesSelectedPreset(element: HTMLElement, selected: Set<FocusPreset>): boolean {
  if (!isReasonableCandidate(element)) return false;
  return (
    (selected.has("sidebars") && looksLikeSidebar(element)) ||
    (selected.has("comments") && looksLikeCommentOrRecommendation(element)) ||
    (selected.has("stickyBars") && looksLikeStickyBar(element))
  );
}

function looksLikeSidebar(element: HTMLElement): boolean {
  if (!isReasonableCandidate(element)) return false;

  const rect = element.getBoundingClientRect();
  const semantic = element.matches("aside, nav, [role='complementary'], [role='navigation']");
  const name = elementName(element);
  const named = /(sidebar|side-nav|sidenav|toc|table-of-contents|left-rail|right-rail)/i.test(name);
  const sideColumn = rect.width < window.innerWidth * 0.42 && rect.height > window.innerHeight * 0.25;

  return (semantic || named) && sideColumn;
}

function looksLikeCommentOrRecommendation(element: HTMLElement): boolean {
  if (!isReasonableCandidate(element)) return false;

  const rect = element.getBoundingClientRect();
  const text = `${elementName(element)} ${element.innerText}`.toLowerCase();
  const hasDistractorText =
    /(comment|discussion|response|reply|related|recommended|recommendation|popular|trending|newsletter|subscribe|promo|advertisement)/i.test(text);
  const contentBand = rect.width > window.innerWidth * 0.45 && rect.height > 70;

  return hasDistractorText && contentBand;
}

function looksLikeStickyBar(element: HTMLElement): boolean {
  if (!isReasonableCandidate(element)) return false;

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const name = elementName(element);
  const isSticky = style.position === "sticky" || style.position === "fixed";
  const isHorizontalBand = rect.width > window.innerWidth * 0.6 && rect.height > 70 && rect.height < window.innerHeight * 0.34;
  const semanticBar = element.matches("header, footer") || /(sticky|fixed|floating|cookie|banner|toolbar|topbar|bottom-bar)/i.test(name);
  const smallFloatingControl = rect.width < window.innerWidth * 0.3 && rect.height < 90;

  return !smallFloatingControl && (isSticky || (semanticBar && isHorizontalBand));
}

function elementName(element: HTMLElement): string {
  return `${element.tagName} ${element.id} ${String(element.className)} ${element.getAttribute("role") ?? ""} ${element.getAttribute("aria-label") ?? ""}`;
}

function classifyElement(element: HTMLElement): RuleCategory {
  const name = elementName(element).toLowerCase();
  const text = safeTextHint(element)?.toLowerCase() ?? "";
  if (looksLikeSidebar(element)) return "sidebar";
  if (looksLikeStickyBar(element)) return "sticky";
  if (/(comment|discussion|response|reply)/i.test(`${name} ${text}`)) return "comments";
  if (/(related|recommended|recommendation|popular|trending|newsletter|subscribe|promo|advertisement)/i.test(`${name} ${text}`)) {
    return "recommendation";
  }
  return "section";
}

function buildReadableLabel(element: HTMLElement, category: RuleCategory, textHint?: string): string {
  if (category === "manual") return "Manual pick";
  if (category === "comments") return "Comments block";
  if (category === "recommendation") {
    if (/newsletter|subscribe/i.test(`${elementName(element)} ${textHint ?? ""}`)) return "Newsletter section";
    return "Recommendation section";
  }
  if (category === "sticky") {
    if (element.matches("footer") || element.getBoundingClientRect().top > window.innerHeight * 0.55) return "Sticky bottom bar";
    return "Sticky header";
  }
  if (category === "sidebar") {
    const rect = element.getBoundingClientRect();
    if (rect.left > window.innerWidth * 0.5) return "Right sidebar";
    if (rect.left < window.innerWidth * 0.18) return "Left sidebar";
    return "Sidebar";
  }
  if (textHint) return textHint.slice(0, 64);
  if (element.getAttribute("role")) return `${element.tagName.toLowerCase()} role ${element.getAttribute("role")}`;
  return `${element.tagName.toLowerCase()} section`;
}

function markCandidate(element: HTMLElement): void {
  element.setAttribute(CANDIDATE_ATTR, "true");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "focus-mode-remove-button";
  button.textContent = "Remove";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeElement(element);
  });

  const previousPosition = window.getComputedStyle(element).position;
  if (previousPosition === "static") element.style.position = "relative";
  element.appendChild(button);
}

function removeElement(element: HTMLElement, category: RuleCategory = "section"): void {
  if (isExtensionElement(element) || element.hasAttribute(HIDDEN_ATTR)) return;
  const rule = buildRule(element, "page", category);
  const hiddenElement = hideWithLayoutCompensation(element);
  removedStack.push({ element, hiddenElement, rule, source: "newRemoval" });
  cleanupCandidate(element);
  renderToolbar();
}

async function applyRules(rules: HiddenSectionRule[], editing = false, watch = false): Promise<AutoApplyResult> {
  injectStyles();
  const result = applyRulesOnce(rules, editing);

  if (watch) {
    startApplyWatcher(rules);
    return { applied: result.applied, needsReview: false };
  }

  return result;
}

function applyRulesOnce(rules: HiddenSectionRule[], editing = false): AutoApplyResult {
  let applied = 0;
  let needsReview = false;

  for (const rule of rules) {
    if (!editing && appliedRuleIds.has(rule.id)) continue;
    const match = findRuleMatch(rule);
    if (!match || (!editing && match.confidence < AUTO_APPLY_CONFIDENCE)) {
      needsReview = true;
      continue;
    }
    if (!editing && match.element.closest(`[${HIDDEN_ATTR}]`)) continue;

    const hiddenElement = hideWithLayoutCompensation(match.element);
    if (!editing) appliedRuleIds.add(rule.id);
    if (editing) removedStack.push({ element: match.element, hiddenElement, rule, source: "existingRule" });
    applied += 1;
  }

  return { applied, needsReview };
}

function startApplyWatcher(rules: HiddenSectionRule[]): void {
  stopApplyWatcher();
  const startedAt = Date.now();
  const watcher: ApplyWatcher = {
    rules,
    observer: new MutationObserver(() => scheduleApplyWatch()),
    startedAt,
    stopAt: Math.min(startedAt + WATCH_MAX_MS, Math.max(startedAt + WATCH_INITIAL_MS, Date.now() + WATCH_AFTER_SUCCESS_MS)),
    timer: undefined,
    scheduled: undefined
  };

  applyWatcher = watcher;
  watcher.observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", scheduleApplyWatch, { passive: true });
  window.addEventListener("resize", scheduleApplyWatch, { passive: true });
  scheduleApplyWatch(250);
  watcher.timer = window.setTimeout(stopApplyWatcher, WATCH_MAX_MS);
}

function scheduleApplyWatch(delayOrEvent: number | Event = 450): void {
  if (!applyWatcher) return;
  const delay = typeof delayOrEvent === "number" ? delayOrEvent : 450;
  window.clearTimeout(applyWatcher.scheduled);
  applyWatcher.scheduled = window.setTimeout(runApplyWatch, delay);
}

function runApplyWatch(): void {
  if (!applyWatcher) return;
  const now = Date.now();
  if (now > applyWatcher.stopAt || now - applyWatcher.startedAt > WATCH_MAX_MS) {
    stopApplyWatcher();
    return;
  }

  const result = applyRulesOnce(applyWatcher.rules, false);
  if (result.applied > 0) {
    applyWatcher.stopAt = Math.min(applyWatcher.startedAt + WATCH_MAX_MS, Date.now() + WATCH_AFTER_SUCCESS_MS);
  }
}

function stopApplyWatcher(): void {
  if (!applyWatcher) return;
  applyWatcher.observer.disconnect();
  window.removeEventListener("scroll", scheduleApplyWatch);
  window.removeEventListener("resize", scheduleApplyWatch);
  window.clearTimeout(applyWatcher.timer);
  window.clearTimeout(applyWatcher.scheduled);
  applyWatcher = undefined;
}

function hideWithLayoutCompensation(element: HTMLElement): HTMLElement {
  const hiddenElement = getLayoutHideTarget(element);
  hiddenElement.setAttribute(HIDDEN_ATTR, "true");
  hiddenElement.style.display = "none";
  expandRemainingContent(hiddenElement);
  return hiddenElement;
}

function getLayoutHideTarget(element: HTMLElement): HTMLElement {
  const parent = element.parentElement;
  if (!parent || parent === document.body) return element;

  const parentRect = parent.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const parentClass = String(parent.className);
  const isBootstrapColumn = /\bcol(-(xs|sm|md|lg|xl|xxl))?-\d+\b/.test(parentClass);
  const isSideSized = parentRect.width <= window.innerWidth * 0.45 && elementRect.width <= parentRect.width + 8;
  const isSideSemantic =
    element.matches("aside, nav, [role='complementary'], [role='navigation']") ||
    /(sidebar|toc|related|recommend|comment|sticky)/i.test(`${element.className} ${element.id}`);

  if (isSideSemantic && isSideSized && (isBootstrapColumn || parent.children.length <= 3)) {
    return parent;
  }

  return element;
}

function expandRemainingContent(hiddenElement: HTMLElement): void {
  const layoutParent = hiddenElement.parentElement;
  if (!layoutParent) return;

  const siblings = Array.from(layoutParent.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child !== hiddenElement
  );
  const visibleSiblings = siblings.filter((sibling) => window.getComputedStyle(sibling).display !== "none");
  if (visibleSiblings.length !== 1) return;

  const parentStyle = window.getComputedStyle(layoutParent);
  const survivor = visibleSiblings[0];
  const hiddenRect = hiddenElement.getBoundingClientRect();
  const survivorRect = survivor.getBoundingClientRect();
  const looksLikeColumns =
    parentStyle.display.includes("flex") ||
    parentStyle.display.includes("grid") ||
    hiddenRect.left > survivorRect.left + survivorRect.width * 0.5 ||
    survivorRect.left > hiddenRect.left + hiddenRect.width * 0.5;

  if (!looksLikeColumns) return;

  rememberAndSet(survivor, {
    width: "100%",
    maxWidth: "100%",
    flex: "0 0 100%"
  });

  if (parentStyle.display.includes("grid")) {
    rememberAndSet(layoutParent, {
      gridTemplateColumns: "minmax(0, 1fr)"
    });
  }

  const content = survivor.querySelector<HTMLElement>("main, article, [class*='content' i]");
  if (content) {
    rememberAndSet(content, {
      width: "100%",
      maxWidth: "100%"
    });
  }
}

function rememberAndSet(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  if (!element.hasAttribute(ADJUSTED_ATTR)) {
    element.setAttribute(
      ADJUSTED_ATTR,
      JSON.stringify({
        width: element.style.width,
        maxWidth: element.style.maxWidth,
        flex: element.style.flex,
        gridTemplateColumns: element.style.gridTemplateColumns
      })
    );
  }

  for (const [property, value] of Object.entries(styles)) {
    if (typeof value === "string") {
      element.style.setProperty(camelToKebab(property), value, "important");
    }
  }
}

function buildRule(element: HTMLElement, scope: RuleScope, preferredCategory?: RuleCategory): HiddenSectionRule {
  const rect = element.getBoundingClientRect();
  const parent = element.parentElement;
  const parentStyle = window.getComputedStyle(parent ?? element);
  const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
  const category = preferredCategory ?? classifyElement(element);
  const textHint = safeTextHint(element);

  return {
    id: crypto.randomUUID(),
    scope,
    cssPath: getCssPath(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? undefined,
    textHint,
    category,
    label: buildReadableLabel(element, category, textHint),
    layoutPosition: {
      topRatio: clamp(rect.top / window.innerHeight),
      leftRatio: clamp(rect.left / window.innerWidth),
      widthRatio: clamp(rect.width / window.innerWidth),
      heightRatio: clamp(rect.height / window.innerHeight)
    },
    sizeRatio: clamp((rect.width * rect.height) / viewportArea),
    parentContext: {
      tagName: parent?.tagName.toLowerCase() ?? "body",
      display: parentStyle.display,
      gridTemplateColumns: parentStyle.gridTemplateColumns,
      flexDirection: parentStyle.flexDirection,
      childCount: parent?.children.length ?? 0
    },
    createdAt: Date.now()
  };
}

function renderToolbar(): void {
  document.getElementById(TOOLBAR_ID)?.remove();
  if (previewEnabled) return;

  const toolbar = document.createElement("div");
  toolbar.id = TOOLBAR_ID;
  const newRemovalCount = removedStack.filter((entry) => entry.source === "newRemoval").length;
  const undoLabel = removedStack.length > 1 ? "Undo ▴" : "Undo last";
  const pickActiveStyle = pickerEnabled
    ? ' style="background: linear-gradient(135deg, #f45d48, #fb923c) !important; color: white !important; box-shadow: 0 10px 24px rgba(244, 93, 72, 0.28) !important;"'
    : "";
  toolbar.innerHTML = `
    <div class="focus-mode-toolbar-title">Focus Mode</div>
    ${removedStack.length ? `<div class="focus-mode-removed-count">${removedStack.length} removed</div>` : noMatchesFound ? `<div class="focus-mode-empty-state">No matches found</div>` : ""}
    <button data-action="pick" class="${pickerEnabled ? "focus-mode-picker-active" : ""}" data-active="${pickerEnabled ? "true" : "false"}" aria-pressed="${pickerEnabled ? "true" : "false"}"${pickActiveStyle}>Pick Element</button>
    <div class="focus-mode-undo-menu">
      <button data-action="undo" ${removedStack.length === 0 ? "disabled" : ""}>${undoLabel}</button>
      ${
        removedStack.length > 1
          ? `<div class="focus-mode-undo-list">
              <div class="focus-mode-undo-header">
                <span>Restore removed section</span>
                <small>${removedStack.length} hidden</small>
              </div>
              ${removedStack
                .map(
                  (entry) => `
                    <button class="focus-mode-undo-row" data-action="undo-rule" data-rule-id="${entry.rule.id}">
                      <span class="focus-mode-rule-badge">${escapeHtml(ruleCategoryLabel(entry.rule.category))}</span>
                      <span class="focus-mode-undo-copy">
                        <strong>${escapeHtml(ruleLabel(entry.rule))}</strong>
                        <small>${escapeHtml(ruleDetail(entry.rule))}</small>
                      </span>
                      <span class="focus-mode-restore-action">Restore</span>
                    </button>
                  `
                )
                .join("")}
            </div>`
          : ""
      }
    </div>
    ${removedStack.length ? `<button data-action="preview">Preview</button>` : ""}
    <button data-action="reset">Reset Page</button>
    <button data-action="done">${newRemovalCount ? "Done" : "Exit"}</button>
  `;

  toolbar.addEventListener("click", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof HTMLElement)) return;
    const target = rawTarget.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "pick") enablePicker();
    if (action === "undo") undo();
    if (action === "undo-rule" && target.dataset.ruleId) undoRule(target.dataset.ruleId);
    if (action === "preview") enablePreview();
    if (action === "reset") resetPage();
    if (action === "done") void finishEditing();
  });

  document.documentElement.appendChild(toolbar);
}

function enablePicker(): void {
  pickerEnabled = !pickerEnabled;
  if (!pickerEnabled) {
    disablePicker();
    renderToolbar();
    return;
  }

  document.documentElement.classList.add("focus-mode-picking");
  document.addEventListener("mouseover", onPickerHover, true);
  document.addEventListener("click", onPickerClick, true);
  renderToolbar();
}

function disablePicker(): void {
  pickerEnabled = false;
  document.documentElement.classList.remove("focus-mode-picking");
  document.querySelectorAll(".focus-mode-picker-target").forEach((element) => element.classList.remove("focus-mode-picker-target"));
  document.removeEventListener("mouseover", onPickerHover, true);
  document.removeEventListener("click", onPickerClick, true);
}

function onPickerHover(event: MouseEvent): void {
  if (!pickerEnabled || !(event.target instanceof HTMLElement) || isExtensionElement(event.target)) return;
  document.querySelectorAll(".focus-mode-picker-target").forEach((element) => element.classList.remove("focus-mode-picker-target"));
  event.target.classList.add("focus-mode-picker-target");
}

function onPickerClick(event: MouseEvent): void {
  if (!pickerEnabled || !(event.target instanceof HTMLElement) || isExtensionElement(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  removeElement(event.target, "manual");
  disablePicker();
  renderToolbar();
}

function undo(): void {
  const last = removedStack.pop();
  if (!last) return;
  last.hiddenElement.removeAttribute(HIDDEN_ATTR);
  last.hiddenElement.style.display = "";
  restoreLayoutAdjustments();
  removedStack.forEach((entry) => expandRemainingContent(entry.hiddenElement));
  markCandidate(last.element);
  renderToolbar();
}

function undoRule(ruleId: string): void {
  const index = removedStack.findIndex((entry) => entry.rule.id === ruleId);
  if (index < 0) return;

  const [entry] = removedStack.splice(index, 1);
  entry.hiddenElement.removeAttribute(HIDDEN_ATTR);
  entry.hiddenElement.style.display = "";
  restoreLayoutAdjustments();
  removedStack.forEach((remainingEntry) => expandRemainingContent(remainingEntry.hiddenElement));
  markCandidate(entry.element);
  renderToolbar();
}

function resetPage(): void {
  disablePicker();
  disablePreview();
  stopApplyWatcher();
  document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`).forEach((element) => {
    element.removeAttribute(HIDDEN_ATTR);
    element.style.display = "";
  });
  restoreLayoutAdjustments();
  restoreReadingAdjustments();
  removedStack = [];
  resetCandidates();
  document.getElementById(TOOLBAR_ID)?.remove();
  document.getElementById(MODAL_ID)?.remove();
  document.getElementById(PREVIEW_ID)?.remove();
}

function enablePreview(): void {
  if (!removedStack.length) return;
  previewEnabled = true;
  disablePicker();
  document.getElementById(TOOLBAR_ID)?.remove();
  candidateElements.forEach(cleanupCandidate);
  document.querySelectorAll<HTMLElement>(`[${CANDIDATE_ATTR}]`).forEach(cleanupCandidate);

  const preview = document.createElement("div");
  preview.id = PREVIEW_ID;
  preview.innerHTML = `
    <div class="focus-mode-preview-pill">Preview mode</div>
    <button type="button" data-action="back">Back to editing</button>
    <button type="button" data-action="done">Done</button>
  `;
  preview.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "back") disablePreview();
    if (action === "done") void finishEditing();
  });
  document.documentElement.appendChild(preview);
  document.addEventListener("keydown", onPreviewKeyDown, true);
}

function disablePreview(): void {
  if (!previewEnabled && !document.getElementById(PREVIEW_ID)) return;
  clearPreviewUi();
  candidateElements.filter((element) => element.isConnected && !element.hasAttribute(HIDDEN_ATTR)).forEach(markCandidate);
  renderToolbar();
}

function clearPreviewUi(): void {
  previewEnabled = false;
  document.getElementById(PREVIEW_ID)?.remove();
  document.removeEventListener("keydown", onPreviewKeyDown, true);
}

function onPreviewKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  disablePreview();
}

function restoreLayoutAdjustments(): void {
  document.querySelectorAll<HTMLElement>(`[${ADJUSTED_ATTR}]`).forEach((element) => {
    const previous = parsePreviousStyles(element.getAttribute(ADJUSTED_ATTR));
    element.style.width = previous.width;
    element.style.maxWidth = previous.maxWidth;
    element.style.flex = previous.flex;
    element.style.gridTemplateColumns = previous.gridTemplateColumns;
    element.removeAttribute(ADJUSTED_ATTR);
  });
}

function applyReadingSettings(reading: ReadingSettings): void {
  injectStyles();
  restoreReadingAdjustments();
  const target = findReadingContainer();
  if (!target) return;

  target.setAttribute(
    READING_ATTR,
    JSON.stringify({
      maxWidth: target.style.maxWidth,
      marginLeft: target.style.marginLeft,
      marginRight: target.style.marginRight,
      paddingLeft: target.style.paddingLeft,
      paddingRight: target.style.paddingRight,
      fontSize: target.style.fontSize,
      width: target.style.width,
      boxSizing: target.style.boxSizing
    })
  );
  target.style.setProperty("max-width", `${reading.maxContentWidth}px`, "important");
  target.style.setProperty("width", `calc(100% - ${reading.pageMargin * 2}px)`, "important");
  target.style.setProperty("margin-left", "auto", "important");
  target.style.setProperty("margin-right", "auto", "important");
  target.style.setProperty("padding-left", `${Math.min(reading.pageMargin, 32)}px`, "important");
  target.style.setProperty("padding-right", `${Math.min(reading.pageMargin, 32)}px`, "important");
  target.style.setProperty("box-sizing", "border-box", "important");
  if (reading.fontScale !== 1) target.style.setProperty("font-size", `${reading.fontScale}em`, "important");
}

function restoreReadingAdjustments(): void {
  document.querySelectorAll<HTMLElement>(`[${READING_ATTR}]`).forEach((element) => {
    const previous = parsePreviousStyles(element.getAttribute(READING_ATTR));
    element.style.maxWidth = previous.maxWidth;
    element.style.marginLeft = previous.marginLeft;
    element.style.marginRight = previous.marginRight;
    element.style.paddingLeft = previous.paddingLeft;
    element.style.paddingRight = previous.paddingRight;
    element.style.fontSize = previous.fontSize;
    element.style.width = previous.width;
    element.style.boxSizing = previous.boxSizing;
    element.removeAttribute(READING_ATTR);
  });
}

function findReadingContainer(): HTMLElement | undefined {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("article, main article, main, [role='main'], .content, .post, .article, .entry-content, .markdown-body")
  ).filter((element) => !isExtensionElement(element));

  return candidates
    .map((element) => ({ element, rect: element.getBoundingClientRect(), textLength: element.innerText.replace(/\s+/g, " ").trim().length }))
    .filter(({ rect, textLength }) => textLength > 600 && rect.width > Math.min(window.innerWidth * 0.35, 360))
    .sort((a, b) => b.textLength - a.textLength)[0]?.element;
}

async function finishEditing(): Promise<void> {
  const newEntries = removedStack.filter((entry) => entry.source === "newRemoval");
  if (newEntries.length === 0) {
    exitEditing();
    return;
  }

  if (previewEnabled) clearPreviewUi();
  const choice = await showSaveModal();
  if (!choice) return;

  const scope = choice.scope;
  const rules = newEntries.map((entry) => ({ ...entry.rule, scope }));
  const payload: SaveRulesPayload = {
    pageUrl: location.href,
    pageTitle: document.title,
    faviconUrl: resolveFaviconUrl(),
    scope,
    rules
  };

  await chrome.runtime.sendMessage({ type: "SAVE_RULES", payload });

  if (choice.autoApply) {
    await chrome.runtime.sendMessage({ type: "REQUEST_AUTO_APPLY", siteId: location.hostname.replace(/^www\./, "") });
  }

  resetCandidates();
  document.getElementById(TOOLBAR_ID)?.remove();
  document.getElementById(PREVIEW_ID)?.remove();
}

function exitEditing(): void {
  disablePicker();
  clearPreviewUi();
  resetCandidates();
  document.getElementById(TOOLBAR_ID)?.remove();
  document.getElementById(MODAL_ID)?.remove();
}

function showSaveModal(): Promise<{ scope: RuleScope; autoApply: boolean } | undefined> {
  document.getElementById(MODAL_ID)?.remove();
  const newRemovalCount = removedStack.filter((entry) => entry.source === "newRemoval").length;

  return new Promise((resolve) => {
    let scope: RuleScope = "page";
    let autoApply = false;
    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="focus-mode-modal-card" role="dialog" aria-modal="true" aria-label="Save focus rules">
        <div class="focus-mode-modal-header">
          <div class="focus-mode-modal-icon">✦</div>
          <div>
            <h2>Save Focus Rules</h2>
            <p>${newRemovalCount} ${newRemovalCount === 1 ? "section" : "sections"} will be saved for repeat cleanup.</p>
          </div>
        </div>
        <div class="focus-mode-toggle-row" data-toggle-group="scope">
          <button type="button" data-scope="page" class="is-active">This Page</button>
          <button type="button" data-scope="site">Whole Website</button>
        </div>
        <button type="button" class="focus-mode-switch" data-action="toggle-auto" aria-pressed="false">
          <span>
            <strong>Auto-apply</strong>
            <small>Apply matching rules after the site loads.</small>
          </span>
          <i></i>
        </button>
        <div class="focus-mode-modal-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="button" data-action="save">Save</button>
        </div>
      </div>
    `;

    const cleanup = (value: { scope: RuleScope; autoApply: boolean } | undefined) => {
      modal.remove();
      resolve(value);
    };

    modal.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const scopeButton = target.closest<HTMLElement>("[data-scope]");
      if (scopeButton) {
        scope = scopeButton.dataset.scope === "site" ? "site" : "page";
        modal.querySelectorAll("[data-scope]").forEach((button) => button.classList.toggle("is-active", button === scopeButton));
        return;
      }

      const actionButton = target.closest<HTMLElement>("[data-action]");
      const action = actionButton?.dataset.action;
      if (action === "toggle-auto") {
        autoApply = !autoApply;
        actionButton?.classList.toggle("is-active", autoApply);
        actionButton?.setAttribute("aria-pressed", String(autoApply));
      }
      if (action === "cancel") cleanup(undefined);
      if (action === "save") cleanup({ scope, autoApply });
    });

    document.documentElement.appendChild(modal);
  });
}

function resetCandidates(): void {
  candidateElements.forEach(cleanupCandidate);
  document.querySelectorAll<HTMLElement>(`[${CANDIDATE_ATTR}]`).forEach(cleanupCandidate);
  candidateElements = [];
}

function cleanupCandidate(element: HTMLElement): void {
  element.removeAttribute(CANDIDATE_ATTR);
  element.querySelectorAll(":scope > .focus-mode-remove-button").forEach((button) => button.remove());
}

function getCssPath(element: HTMLElement): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current instanceof HTMLElement && current !== document.body) {
    const id = current.id && !/\s/.test(current.id) ? `#${CSS.escape(current.id)}` : "";
    if (id) {
      parts.unshift(`${current.tagName.toLowerCase()}${id}`);
      break;
    }

    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    const currentTagName = current.tagName;
    const siblings = Array.from(parent.children).filter((sibling): sibling is HTMLElement => {
      return sibling instanceof HTMLElement && sibling.tagName === currentTagName;
    });
    const nth = siblings.indexOf(current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${nth})`);
    current = parent;
  }

  return parts.join(" > ");
}

function safeTextHint(element: HTMLElement): string | undefined {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(`#${TOOLBAR_ID}, #${MODAL_ID}, #${PREVIEW_ID}, .focus-mode-remove-button, [${CANDIDATE_ATTR}] .focus-mode-remove-button`)
    .forEach((node) => node.remove());
  const text = clone.innerText.replace(/\bRemove\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.slice(0, 96);
}

function resolveFaviconUrl(): string {
  const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon'], link[rel='shortcut icon']");
  const href = icon?.href || "/favicon.ico";
  return new URL(href, location.origin).toString();
}

function dedupe(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function isExtensionElement(element: HTMLElement): boolean {
  return Boolean(element.closest(`#${TOOLBAR_ID}, #${MODAL_ID}, #${PREVIEW_ID}, .focus-mode-remove-button`));
}

function ruleLabel(rule: HiddenSectionRule): string {
  if (rule.label) return rule.label;
  if (rule.textHint) return rule.textHint.slice(0, 54);
  if (rule.role) return `${rule.tagName} role ${rule.role}`;
  return `${rule.tagName} section`;
}

function ruleCategoryLabel(category: RuleCategory | undefined): string {
  switch (category) {
    case "sidebar":
      return "Sidebar";
    case "comments":
      return "Comments";
    case "sticky":
      return "Sticky";
    case "recommendation":
      return "Rec";
    case "manual":
      return "Manual";
    default:
      return "Section";
  }
}

function ruleDetail(rule: HiddenSectionRule): string {
  const path = rule.cssPath.length > 42 ? `${rule.cssPath.slice(0, 42)}...` : rule.cssPath;
  return `${rule.tagName}${rule.role ? ` · ${rule.role}` : ""}${path ? ` · ${path}` : ""}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char] ?? char;
  });
}

function parsePreviousStyles(
  value: string | null
): Record<"width" | "maxWidth" | "flex" | "gridTemplateColumns" | "marginLeft" | "marginRight" | "paddingLeft" | "paddingRight" | "fontSize" | "boxSizing", string> {
  const fallback = {
    width: "",
    maxWidth: "",
    flex: "",
    gridTemplateColumns: "",
    marginLeft: "",
    marginRight: "",
    paddingLeft: "",
    paddingRight: "",
    fontSize: "",
    boxSizing: ""
  };
  if (!value) return fallback;

  try {
    return { ...fallback, ...JSON.parse(value) };
  } catch {
    return fallback;
  }
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function injectStyles(): void {
  const existingStyle = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (existingStyle?.dataset.focusModeStyleVersion === STYLE_VERSION) return;

  const style = existingStyle ?? document.createElement("style");
  style.id = STYLE_ID;
  style.dataset.focusModeStyleVersion = STYLE_VERSION;
  style.textContent = `
    @keyframes focus-mode-toolbar-in {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes focus-mode-menu-in {
      from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.98); }
      to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
    }

    @keyframes focus-mode-modal-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes focus-mode-modal-card-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    [${CANDIDATE_ATTR}="true"] {
      outline: 2px solid rgba(249, 115, 22, 0.78) !important;
      outline-offset: 3px !important;
      transition: outline-color 140ms ease, outline-offset 140ms ease !important;
    }

    .focus-mode-remove-button {
      position: absolute !important;
      z-index: 2147483645 !important;
      top: 8px !important;
      right: 8px !important;
      border: 0 !important;
      border-radius: 999px !important;
      padding: 6px 10px !important;
      background: linear-gradient(135deg, #f45d48, #fb923c) !important;
      color: white !important;
      box-shadow: 0 10px 28px rgba(244, 93, 72, 0.28) !important;
      cursor: pointer !important;
      font: 700 12px/1 ui-sans-serif, system-ui, sans-serif !important;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease !important;
    }

    .focus-mode-remove-button:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 14px 32px rgba(244, 93, 72, 0.34) !important;
    }

    #${TOOLBAR_ID},
    #${PREVIEW_ID} {
      position: fixed !important;
      z-index: 2147483646 !important;
      left: 50% !important;
      bottom: 24px !important;
      transform: translateX(-50%) !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 10px !important;
      border-radius: 999px !important;
      border: 1px solid rgba(255, 255, 255, 0.72) !important;
      background: rgba(250, 247, 242, 0.88) !important;
      box-shadow: 0 18px 60px rgba(43, 40, 40, 0.2) !important;
      backdrop-filter: blur(18px) !important;
      color: #2b2828 !important;
      font: 700 13px/1 ui-sans-serif, system-ui, sans-serif !important;
      animation: focus-mode-toolbar-in 180ms ease-out both !important;
    }

    #${TOOLBAR_ID} button,
    #${PREVIEW_ID} button {
      border: 0 !important;
      border-radius: 999px !important;
      padding: 9px 12px !important;
      background: white !important;
      color: #2b2828 !important;
      box-shadow: 0 8px 18px rgba(43, 40, 40, 0.1) !important;
      cursor: pointer !important;
      font: inherit !important;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, color 120ms ease !important;
    }

    #${TOOLBAR_ID} button:hover,
    #${PREVIEW_ID} button:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 11px 22px rgba(43, 40, 40, 0.14) !important;
    }

    #${TOOLBAR_ID} button:active,
    #${PREVIEW_ID} button:active {
      transform: translateY(0) scale(0.98) !important;
    }

    .focus-mode-undo-menu {
      position: relative !important;
      display: inline-flex !important;
      padding-top: 12px !important;
      margin-top: -12px !important;
    }

    #${TOOLBAR_ID} button:disabled {
      opacity: 0.48 !important;
      cursor: not-allowed !important;
    }

    .focus-mode-removed-count,
    .focus-mode-empty-state {
      border-radius: 999px !important;
      padding: 8px 10px !important;
      background: rgba(255, 255, 255, 0.58) !important;
      color: #8a3a12 !important;
      font: 800 12px/1 ui-sans-serif, system-ui, sans-serif !important;
      box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.12) !important;
      white-space: nowrap !important;
    }

    .focus-mode-empty-state {
      color: #6f6760 !important;
    }

    .focus-mode-undo-list {
      position: absolute !important;
      left: 50% !important;
      bottom: calc(100% - 2px) !important;
      transform: translateX(-50%) translateY(6px) !important;
      width: 320px !important;
      max-height: 360px !important;
      overflow: auto !important;
      border-radius: 24px !important;
      border: 1px solid rgba(255, 255, 255, 0.74) !important;
      background: rgba(250, 247, 242, 0.96) !important;
      box-shadow: 0 18px 52px rgba(43, 40, 40, 0.22) !important;
      padding: 12px !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 140ms ease, transform 140ms ease, box-shadow 140ms ease !important;
      backdrop-filter: blur(18px) !important;
      display: grid !important;
      gap: 8px !important;
    }

    .focus-mode-undo-menu:hover .focus-mode-undo-list,
    .focus-mode-undo-menu:focus-within .focus-mode-undo-list {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translateX(-50%) translateY(0) !important;
      animation: focus-mode-menu-in 140ms ease-out both !important;
    }

    .focus-mode-undo-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 2px 4px 6px !important;
      color: #2b2828 !important;
      font: 900 12px/1.1 ui-sans-serif, system-ui, sans-serif !important;
    }

    .focus-mode-undo-header small {
      color: #8b8179 !important;
      font: 800 11px/1 ui-sans-serif, system-ui, sans-serif !important;
    }

    .focus-mode-undo-list .focus-mode-undo-row {
      display: grid !important;
      grid-template-columns: auto minmax(0, 1fr) auto !important;
      align-items: center !important;
      gap: 10px !important;
      width: 100% !important;
      margin: 0 !important;
      border-radius: 18px !important;
      padding: 10px !important;
      overflow: hidden !important;
      text-align: left !important;
      box-shadow: none !important;
      background: rgba(255, 255, 255, 0.74) !important;
      color: #2b2828 !important;
    }

    .focus-mode-undo-list .focus-mode-undo-row:hover {
      background: rgba(255, 237, 213, 0.94) !important;
      color: #c2410c !important;
    }

    .focus-mode-rule-badge {
      border-radius: 999px !important;
      padding: 5px 7px !important;
      background: rgba(249, 115, 22, 0.14) !important;
      color: #c2410c !important;
      font: 900 10px/1 ui-sans-serif, system-ui, sans-serif !important;
      text-transform: uppercase !important;
      white-space: nowrap !important;
    }

    .focus-mode-undo-copy {
      min-width: 0 !important;
      display: grid !important;
      gap: 3px !important;
    }

    .focus-mode-undo-copy strong,
    .focus-mode-undo-copy small {
      display: block !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    .focus-mode-undo-copy strong {
      font: 900 13px/1.15 ui-sans-serif, system-ui, sans-serif !important;
    }

    .focus-mode-undo-copy small {
      color: #7b716a !important;
      font: 750 11px/1.1 ui-sans-serif, system-ui, sans-serif !important;
    }

    .focus-mode-restore-action {
      color: #c2410c !important;
      font: 900 11px/1 ui-sans-serif, system-ui, sans-serif !important;
    }

    #${PREVIEW_ID} {
      z-index: 2147483647 !important;
    }

    .focus-mode-preview-pill {
      border-radius: 999px !important;
      padding: 9px 12px !important;
      background: linear-gradient(135deg, #f45d48, #fb923c) !important;
      color: white !important;
      box-shadow: 0 10px 24px rgba(244, 93, 72, 0.28) !important;
      font: 900 13px/1 ui-sans-serif, system-ui, sans-serif !important;
      white-space: nowrap !important;
    }

    #${PREVIEW_ID} button[data-action="done"] {
      background: #2b2828 !important;
      color: white !important;
    }

    #${TOOLBAR_ID} button[data-action="done"] {
      background: #2b2828 !important;
      color: white !important;
    }

    #${TOOLBAR_ID} button.is-active,
    #${TOOLBAR_ID} button.focus-mode-picker-active,
    #${TOOLBAR_ID} button[data-action="pick"].is-active,
    #${TOOLBAR_ID} button[data-action="pick"][data-active="true"] {
      background: linear-gradient(135deg, #f45d48, #fb923c) !important;
      color: white !important;
      box-shadow: 0 10px 24px rgba(244, 93, 72, 0.28) !important;
    }

    .focus-mode-toolbar-title {
      padding: 0 6px 0 10px !important;
      color: #c2410c !important;
    }

    .focus-mode-picker-target {
      outline: 3px solid #f45d48 !important;
      outline-offset: 4px !important;
      cursor: crosshair !important;
    }

    #${MODAL_ID} {
      position: fixed !important;
      z-index: 2147483647 !important;
      inset: 0 !important;
      display: grid !important;
      place-items: center !important;
      background: rgba(24, 22, 21, 0.24) !important;
      backdrop-filter: blur(8px) !important;
      color: #2b2828 !important;
      font: 700 14px/1.3 ui-sans-serif, system-ui, sans-serif !important;
      animation: focus-mode-modal-in 180ms ease-out both !important;
    }

    .focus-mode-modal-card {
      box-sizing: border-box !important;
      width: min(400px, calc(100vw - 32px)) !important;
      border-radius: 30px !important;
      border: 1px solid rgba(255, 255, 255, 0.78) !important;
      background: linear-gradient(145deg, rgba(252, 249, 244, 0.98), rgba(244, 239, 232, 0.96)) !important;
      box-shadow: 0 34px 90px rgba(43, 40, 40, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.75) !important;
      padding: 22px !important;
      animation: focus-mode-modal-card-in 180ms ease-out both !important;
    }

    .focus-mode-modal-header {
      display: grid !important;
      grid-template-columns: 50px 1fr !important;
      align-items: center !important;
      gap: 14px !important;
      margin-bottom: 18px !important;
    }

    .focus-mode-modal-icon {
      display: grid !important;
      place-items: center !important;
      width: 50px !important;
      height: 50px !important;
      border-radius: 20px !important;
      background: linear-gradient(135deg, #f45d48, #fb923c, #fed7aa) !important;
      color: white !important;
      box-shadow: 0 18px 38px rgba(244, 93, 72, 0.3) !important;
      font-size: 18px !important;
      line-height: 1 !important;
    }

    .focus-mode-modal-card h2 {
      margin: 0 !important;
      color: #292424 !important;
      font-size: 22px !important;
      font-weight: 900 !important;
      line-height: 1.08 !important;
      letter-spacing: 0 !important;
    }

    .focus-mode-modal-card p {
      margin: 6px 0 0 !important;
      color: #746b63 !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      line-height: 1.35 !important;
    }

    .focus-mode-toggle-row {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 5px !important;
      border-radius: 999px !important;
      background: rgba(43, 40, 40, 0.075) !important;
      padding: 5px !important;
      margin-bottom: 12px !important;
    }

    .focus-mode-toggle-row button,
    .focus-mode-modal-actions button,
    .focus-mode-switch {
      border: 0 !important;
      box-sizing: border-box !important;
      cursor: pointer !important;
      font: inherit !important;
      outline: none !important;
    }

    .focus-mode-toggle-row button {
      min-height: 44px !important;
      border-radius: 999px !important;
      background: transparent !important;
      color: #6f6760 !important;
      padding: 0 14px !important;
      text-align: center !important;
      font-size: 13px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, color 120ms ease !important;
    }

    .focus-mode-toggle-row button.is-active {
      background: white !important;
      color: #c2410c !important;
      box-shadow: 0 8px 18px rgba(43, 40, 40, 0.11) !important;
    }

    .focus-mode-switch {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 18px !important;
      width: 100% !important;
      min-height: 68px !important;
      border-radius: 24px !important;
      background: white !important;
      color: #2b2828 !important;
      padding: 13px 14px 13px 16px !important;
      text-align: left !important;
      box-shadow: 0 10px 24px rgba(43, 40, 40, 0.085) !important;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease !important;
    }

    .focus-mode-switch span {
      min-width: 0 !important;
      display: block !important;
    }

    .focus-mode-switch strong {
      display: block !important;
      color: #292424 !important;
      font-size: 14px !important;
      font-weight: 900 !important;
      line-height: 1.15 !important;
    }

    .focus-mode-switch small {
      display: block !important;
      margin-top: 4px !important;
      color: #81766e !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      line-height: 1.3 !important;
    }

    .focus-mode-switch i {
      position: relative !important;
      flex: 0 0 auto !important;
      width: 46px !important;
      height: 28px !important;
      border-radius: 999px !important;
      background: #d9d3cd !important;
      transition: background 140ms ease !important;
    }

    .focus-mode-switch i::after {
      content: "" !important;
      position: absolute !important;
      top: 4px !important;
      left: 4px !important;
      width: 20px !important;
      height: 20px !important;
      border-radius: 999px !important;
      background: white !important;
      box-shadow: 0 4px 10px rgba(43, 40, 40, 0.18) !important;
      transition: transform 140ms ease !important;
    }

    .focus-mode-switch.is-active i {
      background: #fb923c !important;
    }

    .focus-mode-switch.is-active i::after {
      transform: translateX(18px) !important;
    }

    .focus-mode-modal-actions {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 12px !important;
      margin-top: 14px !important;
    }

    .focus-mode-modal-actions button {
      min-height: 50px !important;
      border-radius: 999px !important;
      padding: 0 16px !important;
      background: white !important;
      color: #2b2828 !important;
      font-size: 14px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      box-shadow: 0 8px 18px rgba(43, 40, 40, 0.1) !important;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, color 120ms ease !important;
    }

    .focus-mode-modal-actions button:hover,
    .focus-mode-switch:hover,
    .focus-mode-toggle-row button:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 11px 22px rgba(43, 40, 40, 0.14) !important;
    }

    .focus-mode-modal-actions button:active,
    .focus-mode-switch:active,
    .focus-mode-toggle-row button:active {
      transform: translateY(0) scale(0.99) !important;
    }

    .focus-mode-modal-actions button:focus-visible,
    .focus-mode-switch:focus-visible,
    .focus-mode-toggle-row button:focus-visible {
      box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.28), 0 8px 18px rgba(43, 40, 40, 0.1) !important;
    }

    .focus-mode-modal-actions button[data-action="save"] {
      background: #2b2828 !important;
      color: white !important;
    }

    .focus-mode-modal-actions button[data-action="save"]:hover {
      background: #1f1b1b !important;
      box-shadow: 0 13px 28px rgba(43, 40, 40, 0.22) !important;
    }

    @media (max-width: 390px) {
      .focus-mode-modal-card {
        padding: 18px !important;
        border-radius: 26px !important;
      }

      .focus-mode-modal-header {
        grid-template-columns: 44px 1fr !important;
        gap: 12px !important;
      }

      .focus-mode-modal-icon {
        width: 44px !important;
        height: 44px !important;
        border-radius: 17px !important;
      }

      .focus-mode-modal-card h2 {
        font-size: 20px !important;
      }

      .focus-mode-toggle-row button {
        font-size: 12px !important;
        padding: 0 10px !important;
      }

      .focus-mode-switch {
        gap: 12px !important;
        padding-left: 14px !important;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #${TOOLBAR_ID},
      #${PREVIEW_ID},
      #${MODAL_ID},
      .focus-mode-modal-card,
      .focus-mode-undo-list,
      .focus-mode-remove-button,
      #${TOOLBAR_ID} button,
      #${PREVIEW_ID} button,
      .focus-mode-modal-actions button,
      .focus-mode-switch,
      .focus-mode-toggle-row button,
      [${CANDIDATE_ATTR}="true"] {
        animation: none !important;
        transition: none !important;
      }

      #${TOOLBAR_ID} button:hover,
      #${PREVIEW_ID} button:hover,
      .focus-mode-modal-actions button:hover,
      .focus-mode-switch:hover,
      .focus-mode-toggle-row button:hover,
      .focus-mode-remove-button:hover {
        transform: none !important;
      }
    }
  `;
  if (!existingStyle) document.documentElement.appendChild(style);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
