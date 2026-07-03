import type { AppSettings, FocusModeExport, FocusModeState, HiddenSectionRule, ReadingSettings, ReviewStatus, RuleScope, SavedSite, ThemeMode } from "./types";
import { originPatternFromUrl, pageKey, siteIdFromUrl } from "./url";

const STORAGE_KEY = "focusModeState";

export const defaultSettings: AppSettings = {
  theme: "system",
  reading: {
    enabled: false,
    widthMode: "preset",
    maxContentWidth: 860,
    pageMargin: 32,
    fontScale: 1
  }
};

const emptyState = (): FocusModeState => ({
  version: 1,
  sites: {},
  settings: defaultSettings
});

export async function getState(): Promise<FocusModeState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const state = result[STORAGE_KEY] as FocusModeState | undefined;
  if (!state || state.version !== 1) return emptyState();

  return {
    ...emptyState(),
    ...state,
    settings: {
      ...defaultSettings,
      ...state.settings,
      reading: {
        ...defaultSettings.reading,
        ...state.settings?.reading
      }
    }
  };
}

export async function setState(state: FocusModeState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function exportState(): Promise<FocusModeExport> {
  return {
    app: "trimline",
    exportedAt: new Date().toISOString(),
    state: await getState()
  };
}

export async function importState(payload: FocusModeExport | FocusModeState): Promise<FocusModeState> {
  if ("app" in payload && payload.app !== "trimline" && payload.app !== "focus-mode-extension") {
    throw new Error("Invalid Trimline export.");
  }
  const rawState = "state" in payload ? payload.state : payload;
  const state = normalizeImportedState(rawState);
  await setState(state);
  return state;
}

export async function updateState(updater: (state: FocusModeState) => FocusModeState): Promise<FocusModeState> {
  const next = updater(await getState());
  await setState(next);
  return next;
}

export async function saveRules(params: {
  pageUrl: string;
  pageTitle: string;
  faviconUrl?: string;
  scope: RuleScope;
  rules: HiddenSectionRule[];
}): Promise<SavedSite> {
  const siteId = siteIdFromUrl(params.pageUrl);
  let saved!: SavedSite;

  await updateState((state) => {
    const existing = state.sites[siteId];
    const site: SavedSite = existing ?? {
      id: siteId,
      domain: siteId,
      originPattern: originPatternFromUrl(params.pageUrl),
      lastPageTitle: params.pageTitle || siteId,
      lastPageUrl: params.pageUrl,
      faviconUrl: params.faviconUrl,
      pageRules: {},
      siteRules: [],
      autoApply: false,
      reviewStatus: "ready",
      updatedAt: Date.now()
    };

    const stampedRules = params.rules.map((rule) => ({ ...rule, scope: params.scope }));
    const nextSite: SavedSite = {
      ...site,
      lastPageTitle: params.pageTitle || site.lastPageTitle,
      lastPageUrl: params.pageUrl,
      faviconUrl: params.faviconUrl || site.faviconUrl,
      originPattern: originPatternFromUrl(params.pageUrl),
      reviewStatus: "ready",
      updatedAt: Date.now(),
      ...(params.scope === "page"
        ? { pageRules: { ...site.pageRules, [pageKey(params.pageUrl)]: stampedRules } }
        : { siteRules: stampedRules })
    };

    saved = nextSite;
    return { ...state, sites: { ...state.sites, [siteId]: nextSite } };
  });

  return saved;
}

export async function setTheme(theme: ThemeMode): Promise<void> {
  await updateState((state) => ({ ...state, settings: { ...state.settings, theme } }));
}

export async function setReadingSettings(reading: ReadingSettings): Promise<void> {
  await updateState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      reading: {
        ...state.settings.reading,
        ...reading
      }
    }
  }));
}

export async function resetSite(siteId: string): Promise<void> {
  await updateState((state) => {
    const sites = { ...state.sites };
    delete sites[siteId];
    return { ...state, sites };
  });
}

export async function resetAllRules(): Promise<void> {
  await updateState((state) => ({ ...state, sites: {} }));
}

export async function removeRule(params: { siteId: string; scope: RuleScope; pageKey?: string; ruleId: string }): Promise<void> {
  await updateState((state) => {
    const site = state.sites[params.siteId];
    if (!site) return state;

    const nextSite: SavedSite =
      params.scope === "site"
        ? { ...site, siteRules: site.siteRules.filter((rule) => rule.id !== params.ruleId), updatedAt: Date.now() }
        : removePageRule(site, params.pageKey, params.ruleId);

    const hasPageRules = Object.values(nextSite.pageRules).some((rules) => rules.length > 0);
    const hasRules = hasPageRules || nextSite.siteRules.length > 0;
    const sites = { ...state.sites };

    if (hasRules) {
      sites[params.siteId] = nextSite;
    } else {
      delete sites[params.siteId];
    }

    return { ...state, sites };
  });
}

export async function setSiteAutoApply(siteId: string, autoApply: boolean): Promise<SavedSite | undefined> {
  let nextSite: SavedSite | undefined;
  await updateState((state) => {
    const site = state.sites[siteId];
    if (!site) return state;
    nextSite = { ...site, autoApply, updatedAt: Date.now() };
    return { ...state, sites: { ...state.sites, [siteId]: nextSite } };
  });
  return nextSite;
}

function removePageRule(site: SavedSite, targetPageKey: string | undefined, ruleId: string): SavedSite {
  const pageRules = { ...site.pageRules };
  const keys = targetPageKey ? [targetPageKey] : Object.keys(pageRules);

  for (const key of keys) {
    const rules = pageRules[key];
    if (!rules) continue;

    const nextRules = rules.filter((rule) => rule.id !== ruleId);
    if (nextRules.length) {
      pageRules[key] = nextRules;
    } else {
      delete pageRules[key];
    }
  }

  return { ...site, pageRules, updatedAt: Date.now() };
}

function normalizeImportedState(value: unknown): FocusModeState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.sites)) {
    throw new Error("Invalid Focus Mode export.");
  }

  const sites = Object.fromEntries(
    Object.entries(value.sites)
      .filter((entry): entry is [string, SavedSite] => isSavedSite(entry[1]))
      .map(([siteId, site]) => {
        const reviewStatus: ReviewStatus = site.reviewStatus === "needs_review" ? "needs_review" : "ready";
        const normalizedSite: SavedSite = {
          ...site,
          originPattern: originPatternFromUrl(site.lastPageUrl),
          faviconUrl: typeof site.faviconUrl === "string" ? site.faviconUrl : undefined,
          pageRules: isRecord(site.pageRules) ? site.pageRules : {},
          siteRules: Array.isArray(site.siteRules) ? site.siteRules : [],
          autoApply: Boolean(site.autoApply),
          reviewStatus
        };
        return [siteId, normalizedSite];
      })
  );

  return {
    version: 1,
    sites,
    settings: {
      ...defaultSettings,
      ...(isRecord(value.settings) ? value.settings : {}),
      reading: {
        ...defaultSettings.reading,
        ...(isRecord(value.settings) && isRecord(value.settings.reading) ? value.settings.reading : {})
      }
    }
  };
}

function isSavedSite(value: unknown): value is SavedSite {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.domain === "string" &&
    typeof value.originPattern === "string" &&
    typeof value.lastPageTitle === "string" &&
    typeof value.lastPageUrl === "string" &&
    isRecord(value.pageRules) &&
    Array.isArray(value.siteRules)
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
