import { AUTO_APPLY_CONFIDENCE } from "../shared/matcher";
import { exportState, getState, importState, removeRule, resetAllRules, resetSite, saveRules, setReadingSettings, setSiteAutoApply, setTheme } from "../shared/storage";
import type { ContentCommand, HiddenSectionRule, PopupSnapshot, RuntimeMessage, SavedSite } from "../shared/types";
import { canonicalPageKey, isRestrictedUrl, originPatternsForUrl, pageKey, siteIdFromUrl } from "../shared/url";

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse).catch((error) => {
    console.error("Trimline background error", error);
    sendResponse(undefined);
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url || isRestrictedUrl(tab.url)) return;
  void maybeAutoApply(tabId, tab.url);
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "SAVE_RULES": {
      const site = await saveRules(message.payload);
      return site;
    }
    case "GET_POPUP_SNAPSHOT":
      return getPopupSnapshot(message.url ?? sender.tab?.url, message.title ?? sender.tab?.title);
    case "EXPORT_STATE":
      return exportState();
    case "IMPORT_STATE":
      return importState(message.payload);
    case "REQUEST_AUTO_APPLY":
      return requestAutoApply(message.siteId);
    case "OPEN_SAVED_SITE":
      return openSavedSite(message.siteId);
    case "SET_THEME":
      await setTheme(message.theme);
      return true;
    case "SET_READING_SETTINGS":
      await setReadingSettings(message.reading);
      return true;
    case "SET_AUTO_APPLY":
      return setSiteAutoApply(message.siteId, message.autoApply);
    case "TOGGLE_AUTO_APPLY":
      return toggleAutoApply(message.siteId);
    case "REMOVE_RULE":
      await removeRule({ siteId: message.siteId, scope: message.scope, pageKey: message.pageKey, ruleId: message.ruleId });
      return true;
    case "RESET_SITE":
      await resetSite(message.siteId);
      return true;
    case "RESET_ALL_RULES":
      await resetAllRules();
      return true;
    default:
      return undefined;
  }
}

async function getPopupSnapshot(url?: string, title?: string): Promise<PopupSnapshot> {
  const state = await getState();
  const restricted = isRestrictedUrl(url);
  const siteId = url ? siteIdFromUrl(url) : undefined;
  const currentSite = siteId ? state.sites[siteId] : undefined;
  const pageRules = currentSite && url ? currentSite.pageRules[pageKey(url)] : undefined;

  let status: PopupSnapshot["status"] = "not_saved";
  if (restricted) status = "restricted";
  else if (currentSite?.reviewStatus === "needs_review") status = "needs_review";
  else if (pageRules?.length) status = "saved_page";
  else if (currentSite?.siteRules.length) status = "saved_site";

  return {
    url,
    title,
    domain: siteId,
    faviconUrl: currentSite?.faviconUrl || faviconFromUrl(url),
    restricted,
    status,
    currentSite,
    savedSites: Object.values(state.sites).sort((a, b) => b.updatedAt - a.updatedAt),
    settings: state.settings
  };
}

function faviconFromUrl(url?: string): string | undefined {
  if (!url || isRestrictedUrl(url)) return undefined;

  try {
    const parsed = new URL(url);
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

async function requestAutoApply(siteId: string): Promise<boolean> {
  const site = (await getState()).sites[siteId];
  if (!site) return false;

  const granted = await chrome.permissions.request({ origins: permissionOriginsForSite(site) });
  if (granted) await setSiteAutoApply(siteId, true);
  return granted;
}

async function toggleAutoApply(siteId: string): Promise<SavedSite | undefined> {
  const site = (await getState()).sites[siteId];
  if (!site) return undefined;

  if (site.autoApply) {
    return setSiteAutoApply(siteId, false);
  }

  const granted = await requestAutoApply(siteId);
  return granted ? (await getState()).sites[siteId] : site;
}

async function openSavedSite(siteId: string): Promise<void> {
  const site = (await getState()).sites[siteId];
  if (!site) return;

  const tab = await chrome.tabs.create({ url: site.lastPageUrl, active: true });
  if (!tab.id) return;

  const applyAfterLoad = (tabId: number) => {
    void applyRulesForCurrentTab(tabId, site.lastPageUrl, true, true);
  };

  const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo, updatedTab: chrome.tabs.Tab) => {
    if (updatedTabId !== tab.id || changeInfo.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(listener);
    void applyRulesForUrl(updatedTabId, updatedTab.url ?? site.lastPageUrl, true, true);
  };
  chrome.tabs.onUpdated.addListener(listener);

  globalThis.setTimeout(() => {
    if (!tab.id) return;
    chrome.tabs.onUpdated.removeListener(listener);
    applyAfterLoad(tab.id);
  }, 2500);

  const hasPermission = await hasAnySitePermission(site);
  if (!hasPermission) {
    try {
      const granted = await chrome.permissions.request({ origins: permissionOriginsForSite(site) });
      if (granted && tab.id) applyAfterLoad(tab.id);
    } catch {
      return;
    }
  }
}

async function maybeAutoApply(tabId: number, url: string): Promise<void> {
  const state = await getState();
  const site = state.sites[siteIdFromUrl(url)];
  if (!site?.autoApply) return;

  const hasPermission = await hasAnySitePermission(site);
  if (!hasPermission) return;

  await wait(900);
  await applyRulesForUrl(tabId, url, false, true);
}

async function applyRulesForCurrentTab(tabId: number, fallbackUrl: string, manual: boolean, watch = !manual): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await applyRulesForUrl(tabId, tab.url ?? fallbackUrl, manual, watch);
  } catch {
    await applyRulesForUrl(tabId, fallbackUrl, manual, watch);
  }
}

async function applyRulesForUrl(tabId: number, url: string, manual: boolean, watch = !manual): Promise<void> {
  const state = await getState();
  const site = state.sites[siteIdFromUrl(url)];
  if (!site) return;

  const rules = getRulesForUrl(site, url);
  if (!rules.length) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    if (!manual) return;
  }

  const response = await sendRulesWithRetry(tabId, rules, watch);

  if (!manual && response?.needsReview) {
    await markNeedsReview(site.id);
  }
}

function getRulesForUrl(site: SavedSite, url: string): HiddenSectionRule[] {
  const exactRules = site.pageRules[pageKey(url)];
  if (exactRules?.length) return exactRules;

  const canonicalKey = canonicalPageKey(url);
  const canonicalRules = Object.entries(site.pageRules).find(([savedPageKey]) => canonicalPageKey(savedPageKey) === canonicalKey)?.[1];
  if (canonicalRules?.length) return canonicalRules;

  return site.siteRules;
}

function permissionOriginsForSite(site: SavedSite): string[] {
  return Array.from(new Set([site.originPattern, ...originPatternsForUrl(site.lastPageUrl)].filter(Boolean)));
}

async function hasAnySitePermission(site: SavedSite): Promise<boolean> {
  for (const origin of permissionOriginsForSite(site)) {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
  }

  return false;
}

async function sendRulesWithRetry(tabId: number, rules: HiddenSectionRule[], watch: boolean): Promise<{ needsReview?: boolean } | undefined> {
  let lastResponse: { needsReview?: boolean } | undefined;

  for (const delay of [0, 350, 900, 1800, 3200]) {
    if (delay) await wait(delay);
    try {
      lastResponse = await chrome.tabs.sendMessage(tabId, buildApplyCommand(rules, watch));
      if (lastResponse && !lastResponse.needsReview) return lastResponse;
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      } catch {
        return lastResponse;
      }
    }
  }

  return lastResponse;
}

function buildApplyCommand(rules: HiddenSectionRule[], watch: boolean): ContentCommand {
  return { type: "APPLY_RULES", rules, watch };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function markNeedsReview(siteId: string): Promise<void> {
  const state = await getState();
  const site = state.sites[siteId];
  if (!site || site.reviewStatus === "needs_review") return;

  await chrome.storage.local.set({
    focusModeState: {
      ...state,
      sites: {
        ...state.sites,
        [siteId]: {
          ...site,
          reviewStatus: "needs_review",
          updatedAt: Date.now()
        }
      }
    }
  });
}

export function confidenceAllowsAutoHide(confidence: number): boolean {
  return confidence >= AUTO_APPLY_CONFIDENCE;
}
