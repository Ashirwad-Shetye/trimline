export type RuleScope = "page" | "site";
export type ThemeMode = "system" | "light" | "dark";
export type ReviewStatus = "ready" | "needs_review";
export type FocusPreset = "sidebars" | "comments" | "stickyBars";
export type RuleCategory = "sidebar" | "comments" | "sticky" | "recommendation" | "manual" | "section";

export type LayoutPosition = {
  topRatio: number;
  leftRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type ParentLayoutContext = {
  tagName: string;
  display: string;
  gridTemplateColumns?: string;
  flexDirection?: string;
  childCount: number;
};

export type HiddenSectionRule = {
  id: string;
  scope: RuleScope;
  cssPath: string;
  tagName: string;
  role?: string;
  textHint?: string;
  category?: RuleCategory;
  label?: string;
  layoutPosition: LayoutPosition;
  sizeRatio: number;
  parentContext: ParentLayoutContext;
  createdAt: number;
};

export type SavedSite = {
  id: string;
  domain: string;
  originPattern: string;
  lastPageTitle: string;
  lastPageUrl: string;
  faviconUrl?: string;
  pageRules: Record<string, HiddenSectionRule[]>;
  siteRules: HiddenSectionRule[];
  autoApply: boolean;
  reviewStatus: ReviewStatus;
  updatedAt: number;
};

export type ReadingSettings = {
  enabled?: boolean;
  widthMode?: "preset" | "custom";
  maxContentWidth: number;
  pageMargin: number;
  fontScale: number;
};

export type AppSettings = {
  theme: ThemeMode;
  reading: ReadingSettings;
};

export type FocusModeState = {
  version: 1;
  sites: Record<string, SavedSite>;
  settings: AppSettings;
};

export type FocusModeExport = {
  app: "trimline" | "focus-mode-extension";
  exportedAt: string;
  state: FocusModeState;
};

export type CurrentPageStatus =
  | "restricted"
  | "not_saved"
  | "saved_page"
  | "saved_site"
  | "needs_review";

export type PopupSnapshot = {
  url?: string;
  title?: string;
  domain?: string;
  faviconUrl?: string;
  restricted: boolean;
  status: CurrentPageStatus;
  currentSite?: SavedSite;
  savedSites: SavedSite[];
  settings: AppSettings;
};

export type SaveRulesPayload = {
  pageUrl: string;
  pageTitle: string;
  faviconUrl?: string;
  scope: RuleScope;
  rules: HiddenSectionRule[];
};

export type AutoApplyResult = {
  applied: number;
  needsReview: boolean;
};

export type ContentCommand =
  | { type: "START_EDITING"; rules?: HiddenSectionRule[]; presets?: FocusPreset[] }
  | { type: "APPLY_RULES"; rules: HiddenSectionRule[]; watch?: boolean }
  | { type: "APPLY_READING_SETTINGS"; reading: ReadingSettings }
  | { type: "RESET_READING_SETTINGS" }
  | { type: "RESET_PAGE" }
  | { type: "PING" };

export type RuntimeMessage =
  | { type: "SAVE_RULES"; payload: SaveRulesPayload }
  | { type: "GET_POPUP_SNAPSHOT"; tabId?: number; url?: string; title?: string }
  | { type: "EXPORT_STATE" }
  | { type: "IMPORT_STATE"; payload: FocusModeExport | FocusModeState }
  | { type: "REQUEST_AUTO_APPLY"; siteId: string }
  | { type: "OPEN_SAVED_SITE"; siteId: string }
  | { type: "SET_THEME"; theme: ThemeMode }
  | { type: "SET_READING_SETTINGS"; reading: ReadingSettings }
  | { type: "SET_AUTO_APPLY"; siteId: string; autoApply: boolean }
  | { type: "TOGGLE_AUTO_APPLY"; siteId: string }
  | { type: "REMOVE_RULE"; siteId: string; scope: RuleScope; pageKey?: string; ruleId: string }
  | { type: "RESET_SITE"; siteId: string }
  | { type: "RESET_ALL_RULES" };
