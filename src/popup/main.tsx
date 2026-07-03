import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Columns3,
  Download,
  Edit3,
  ExternalLink,
  Github,
  Heart,
  Info,
  ListChecks,
  Maximize2,
  Minimize2,
  Plus,
  Upload,
  RotateCcw,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import "../styles/popup.css";
import { getActiveTab, sendContentCommand } from "../shared/chrome";
import type { FocusModeExport, FocusPreset, HiddenSectionRule, PopupSnapshot, ReadingSettings, RuntimeMessage, RuleCategory, RuleScope, SavedSite, ThemeMode } from "../shared/types";
import { isRestrictedUrl, originPatternsForUrl, pageKey, shortUrl } from "../shared/url";

const fallbackSnapshot: PopupSnapshot = {
  restricted: true,
  status: "restricted",
  savedSites: [],
  settings: {
    theme: "system",
    reading: {
      enabled: false,
      widthMode: "preset",
      maxContentWidth: 860,
      pageMargin: 32,
      fontScale: 1
    }
  }
};

type PopupView = { name: "home" } | { name: "rules"; siteId: string } | { name: "sites" } | { name: "about" };
const ALL_PRESETS: FocusPreset[] = ["sidebars", "comments", "stickyBars"];
const CUSTOM_WIDTH_MIN = 560;
const CUSTOM_WIDTH_MAX = 1280;
const CUSTOM_WIDTH_STEP = 20;
const GITHUB_REPO_URL = "https://github.com/Ashirwad-Shetye/trimline";
const READER_WIDTH_PRESETS = [
  { label: "Narrow", width: 720, Icon: Minimize2 },
  { label: "Comfort", width: 860, Icon: Columns3 },
  { label: "Wide", width: 1040, Icon: Maximize2 }
];
const PRESET_LABELS: Record<FocusPreset, string> = {
  sidebars: "Sidebars",
  comments: "Comments",
  stickyBars: "Sticky bars"
};

type RuleListItem = {
  rule: HiddenSectionRule;
  scope: RuleScope;
  pageKey?: string;
  pageLabel?: string;
};

function App() {
  const [snapshot, setSnapshot] = useState<PopupSnapshot>(fallbackSnapshot);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<PopupView>({ name: "home" });
  const [activeSheetOpen, setActiveSheetOpen] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<FocusPreset[]>(ALL_PRESETS);

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", snapshot.settings.theme === "dark");
    if (snapshot.settings.theme === "system") {
      root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
  }, [snapshot.settings.theme]);

  const currentRules = useMemo(() => {
    if (!snapshot.currentSite || !snapshot.url) return [];
    return snapshot.currentSite.pageRules[pageKey(snapshot.url)] ?? snapshot.currentSite.siteRules;
  }, [snapshot.currentSite, snapshot.url]);

  const viewedSite = view.name === "rules" ? snapshot.savedSites.find((site) => site.id === view.siteId) : undefined;

  async function loadSnapshot() {
    const tab = await getActiveTab();
    const message: RuntimeMessage = {
      type: "GET_POPUP_SNAPSHOT",
      tabId: tab?.id,
      url: tab?.url,
      title: tab?.title
    };
    const response = (await chrome.runtime.sendMessage(message)) as PopupSnapshot;
    setSnapshot(response);
  }

  async function startEditing() {
    if (selectedPresets.length === 0) {
      setNotice("Select at least one preset.");
      return;
    }

    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) {
      setNotice("This page cannot run Focus Mode.");
      return;
    }

    setBusy(true);
    try {
      await sendContentCommand(tab.id, { type: "START_EDITING", rules: currentRules, presets: selectedPresets });
      setNotice("Editing controls are on the page.");
      window.close();
    } catch {
      setNotice("Could not start on this page.");
    } finally {
      setBusy(false);
    }
  }

  async function manageActiveSite() {
    if (!snapshot.currentSite) {
      setNotice("No saved rules for this site yet.");
      return;
    }

    setActiveSheetOpen(false);
    setView({ name: "rules", siteId: snapshot.currentSite.id });
  }

  async function resetCurrentPage() {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    await sendContentCommand(tab.id, { type: "RESET_PAGE" });
    setNotice("Current page restored.");
  }

  async function setTheme(theme: ThemeMode) {
    await chrome.runtime.sendMessage({ type: "SET_THEME", theme } satisfies RuntimeMessage);
    await loadSnapshot();
  }

  async function setReadingWidth(maxContentWidth: number, widthMode: ReadingSettings["widthMode"] = "preset", shouldReload = true) {
    const reading: ReadingSettings = { ...snapshot.settings.reading, widthMode, maxContentWidth };
    await chrome.runtime.sendMessage({ type: "SET_READING_SETTINGS", reading } satisfies RuntimeMessage);
    if (reading.enabled) {
      const applied = await applyReadingToActiveTab(reading);
      if (applied) setNotice(`Reader width applied at ${reading.maxContentWidth}px.`);
    } else {
      setNotice("Reader width saved. Enable to apply.");
    }
    if (shouldReload) {
      await loadSnapshot();
    } else {
      setSnapshot((current) => ({ ...current, settings: { ...current.settings, reading } }));
    }
  }

  async function activateCustomReaderWidth() {
    const width = clampWidth(snapshot.settings.reading.maxContentWidth);
    await setReadingWidth(width, "custom");
  }

  async function setCustomReaderWidth(maxContentWidth: number) {
    await setReadingWidth(clampWidth(maxContentWidth), "custom", false);
  }

  async function toggleReaderWidth() {
    const reading: ReadingSettings = { ...snapshot.settings.reading, enabled: !snapshot.settings.reading.enabled };
    await chrome.runtime.sendMessage({ type: "SET_READING_SETTINGS", reading } satisfies RuntimeMessage);
    if (reading.enabled) {
      const applied = await applyReadingToActiveTab(reading);
      if (applied) setNotice(`Reader width enabled at ${reading.maxContentWidth}px.`);
    } else {
      await resetReadingOnActiveTab();
      setNotice("Reader width disabled for this page.");
    }
    await loadSnapshot();
  }

  async function applyReadingToActiveTab(reading: ReadingSettings): Promise<boolean> {
    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) {
      setNotice("Reader width cannot run on this page.");
      return false;
    }

    await sendContentCommand(tab.id, { type: "APPLY_READING_SETTINGS", reading });
    return true;
  }

  async function resetReadingOnActiveTab() {
    const tab = await getActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) return;
    await sendContentCommand(tab.id, { type: "RESET_READING_SETTINGS" });
  }

  async function toggleAutoApply(site: SavedSite) {
    if (site.autoApply) {
      await chrome.runtime.sendMessage({ type: "SET_AUTO_APPLY", siteId: site.id, autoApply: false } satisfies RuntimeMessage);
      setNotice(`Auto-apply disabled for ${site.domain}.`);
      await loadSnapshot();
      return;
    }

    const origins = Array.from(new Set([site.originPattern, ...originPatternsForUrl(site.lastPageUrl)].filter(Boolean)));
    try {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) {
        setNotice("Auto-apply needs site permission.");
        return;
      }

      await chrome.runtime.sendMessage({ type: "SET_AUTO_APPLY", siteId: site.id, autoApply: true } satisfies RuntimeMessage);
      setNotice(`Auto-apply enabled for ${site.domain}.`);
      await loadSnapshot();
    } catch {
      setNotice("Chrome blocked the permission request.");
    }
  }

  async function resetSite(site: SavedSite) {
    await chrome.runtime.sendMessage({ type: "RESET_SITE", siteId: site.id } satisfies RuntimeMessage);
    await loadSnapshot();
  }

  async function removeSavedRule(site: SavedSite, item: RuleListItem) {
    await chrome.runtime.sendMessage({
      type: "REMOVE_RULE",
      siteId: site.id,
      scope: item.scope,
      pageKey: item.pageKey,
      ruleId: item.rule.id
    } satisfies RuntimeMessage);
    setNotice("Rule removed.");
    await loadSnapshot();
  }

  async function resetAllRules() {
    await chrome.runtime.sendMessage({ type: "RESET_ALL_RULES" } satisfies RuntimeMessage);
    await loadSnapshot();
  }

  async function exportJson() {
    const exported = (await chrome.runtime.sendMessage({ type: "EXPORT_STATE" } satisfies RuntimeMessage)) as FocusModeExport;
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `focus-mode-rules-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${Object.keys(exported.state.sites).length} saved sites.`);
  }

  async function importJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text()) as FocusModeExport;
      await chrome.runtime.sendMessage({ type: "IMPORT_STATE", payload } satisfies RuntimeMessage);
      await loadSnapshot();
      setNotice("Imported saved rules and settings.");
    } catch {
      setNotice("Import failed. Choose a Focus Mode JSON export.");
    }
  }

  async function openSite(site: SavedSite) {
    await chrome.runtime.sendMessage({ type: "OPEN_SAVED_SITE", siteId: site.id } satisfies RuntimeMessage);
    window.close();
  }

  function togglePreset(preset: FocusPreset) {
    setSelectedPresets((current) => (current.includes(preset) ? current.filter((item) => item !== preset) : [...current, preset]));
  }

  return (
    <main className="h-[590px] overflow-hidden bg-porcelain text-soot dark:bg-[#151515] dark:text-[#f8f1e9]">
      <div className="h-full overflow-y-auto bg-porcelain dark:bg-[#151515]">
        {viewedSite ? (
          <RulesScreen site={viewedSite} onBack={() => setView({ name: "home" })} onRemoveRule={removeSavedRule} />
        ) : view.name === "sites" ? (
          <SavedSitesScreen
            sites={snapshot.savedSites}
            onBack={() => setView({ name: "home" })}
            openSite={openSite}
            openRules={(site) => setView({ name: "rules", siteId: site.id })}
            toggleAutoApply={toggleAutoApply}
            resetSite={resetSite}
          />
        ) : view.name === "about" ? (
          <AboutScreen onBack={() => setView({ name: "home" })} />
        ) : (
          <HomeScreen
            snapshot={snapshot}
            busy={busy}
            notice={notice}
            activeSheetOpen={activeSheetOpen}
            setActiveSheetOpen={setActiveSheetOpen}
            startEditing={startEditing}
            resetCurrentPage={resetCurrentPage}
            manageActiveSite={manageActiveSite}
            selectedPresets={selectedPresets}
            togglePreset={togglePreset}
            setTheme={setTheme}
            setReadingWidth={setReadingWidth}
            activateCustomReaderWidth={activateCustomReaderWidth}
            setCustomReaderWidth={setCustomReaderWidth}
            toggleReaderWidth={toggleReaderWidth}
            toggleAutoApply={toggleAutoApply}
            resetSite={resetSite}
            resetAllRules={resetAllRules}
            exportJson={exportJson}
            importJson={importJson}
            openSite={openSite}
            openRules={(site) => setView({ name: "rules", siteId: site.id })}
            openSites={() => setView({ name: "sites" })}
            openAbout={() => setView({ name: "about" })}
          />
        )}
      </div>
    </main>
  );
}

function HomeScreen(props: {
  snapshot: PopupSnapshot;
  busy: boolean;
  notice: string;
  activeSheetOpen: boolean;
  setActiveSheetOpen: (open: boolean) => void;
  startEditing: () => Promise<void>;
  resetCurrentPage: () => Promise<void>;
  manageActiveSite: () => Promise<void>;
  selectedPresets: FocusPreset[];
  togglePreset: (preset: FocusPreset) => void;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setReadingWidth: (maxContentWidth: number) => Promise<void>;
  activateCustomReaderWidth: () => Promise<void>;
  setCustomReaderWidth: (maxContentWidth: number) => Promise<void>;
  toggleReaderWidth: () => Promise<void>;
  toggleAutoApply: (site: SavedSite) => Promise<void>;
  resetSite: (site: SavedSite) => Promise<void>;
  resetAllRules: () => Promise<void>;
  exportJson: () => Promise<void>;
  importJson: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  openSite: (site: SavedSite) => Promise<void>;
  openRules: (site: SavedSite) => void;
  openSites: () => void;
  openAbout: () => void;
}) {
  const { snapshot } = props;
  const activeFaviconUrl = snapshot.currentSite?.faviconUrl || snapshot.faviconUrl;
  const activeRuleCount = snapshot.currentSite ? getRuleItems(snapshot.currentSite).length : 0;
  const visibleSavedSites = snapshot.savedSites.slice(0, 5);
  const customMode = snapshot.settings.reading.widthMode === "custom";
  const [customWidth, setCustomWidth] = useState(clampWidth(snapshot.settings.reading.maxContentWidth));
  const customWidthTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setCustomWidth(clampWidth(snapshot.settings.reading.maxContentWidth));
  }, [snapshot.settings.reading.maxContentWidth]);

  useEffect(() => {
    return () => {
      if (customWidthTimer.current) window.clearTimeout(customWidthTimer.current);
    };
  }, []);

  function changeCustomWidth(value: number) {
    const width = clampWidth(value);
    setCustomWidth(width);
    if (customWidthTimer.current) window.clearTimeout(customWidthTimer.current);
    customWidthTimer.current = window.setTimeout(() => {
      void props.setCustomReaderWidth(width);
    }, 80);
  }

  return (
    <div className="relative min-h-full px-4 py-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_25%_10%,rgba(255,139,95,0.35),transparent_42%),radial-gradient(circle_at_85%_0%,rgba(255,209,170,0.38),transparent_36%)] dark:opacity-50" />
        <section className="relative overflow-hidden rounded-card bg-gradient-to-br from-coral-500 via-ember-400 to-ember-200 p-5 pb-8 text-white shadow-ember">
          <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-white/25 blur-2xl" />
          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            {snapshot.currentSite && activeRuleCount > 0 ? (
              <button
                type="button"
                className="flex h-9 items-center justify-center rounded-full border border-white/20 bg-white/24 px-3 text-xs font-bold text-white shadow-pill backdrop-blur transition hover:bg-white/35 focus:outline-none focus:ring-2 focus:ring-white/45"
                onClick={props.manageActiveSite}
              >
                {activeRuleCount} {activeRuleCount === 1 ? "rule" : "rules"}
              </button>
            ) : (
              <div className="flex h-9 items-center justify-center rounded-full border border-white/20 bg-white/24 px-3 text-xs font-bold text-white shadow-pill backdrop-blur">
                {statusLabel(snapshot.status)}
              </div>
            )}
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/24 text-white shadow-pill backdrop-blur transition hover:bg-white/35 focus:outline-none focus:ring-2 focus:ring-white/45"
              title="Edit active site"
              onClick={() => props.setActiveSheetOpen(!props.activeSheetOpen)}
            >
              <Edit3 size={15} />
            </button>
          </div>
          <div className="relative">
            <SiteIcon
              className="mb-8 h-11 w-11 rounded-full bg-white/20 p-2 shadow-pill backdrop-blur"
              domain={snapshot.domain}
              faviconUrl={activeFaviconUrl}
              fallback="brand"
            />
            <p className="text-sm font-semibold text-white/82">Current site</p>
            <h1 className="mt-1 break-words text-3xl font-bold leading-tight tracking-normal">
              {snapshot.domain ?? "Restricted page"}
            </h1>
            <p className="mb-4 mt-3 line-clamp-2 text-sm font-medium text-white/78">
              {snapshot.title ?? "Open a normal website to start cleaning distractions."}
            </p>
          </div>
          {props.activeSheetOpen ? (
            <div className="relative mt-4 rounded-[22px] border border-white/25 bg-white/20 p-2 text-sm font-bold shadow-pill backdrop-blur">
              <button type="button" className="flex w-full items-center gap-2 rounded-[17px] px-3 py-2 text-left transition hover:bg-white/20" onClick={props.startEditing}>
                <Plus size={15} /> Add page rule
              </button>
              <button type="button" className="flex w-full items-center gap-2 rounded-[17px] px-3 py-2 text-left transition hover:bg-white/20" onClick={props.manageActiveSite}>
                <ListChecks size={15} /> Manage rules
              </button>
              <button type="button" className="flex w-full items-center gap-2 rounded-[17px] px-3 py-2 text-left transition hover:bg-white/20" onClick={props.resetCurrentPage}>
                <RotateCcw size={15} /> Reset current page
              </button>
            </div>
          ) : null}
        </section>

        <section className="relative -mt-5 rounded-[26px] border border-white/75 bg-white/78 p-3 shadow-glass backdrop-blur-xl dark:border-white/10 dark:bg-[#252525]">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-[22px] bg-white px-4 py-4 text-left shadow-pill transition hover:-translate-y-0.5 hover:shadow-glass disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#343434] dark:text-[#fff8ef]"
            disabled={props.busy || snapshot.restricted || props.selectedPresets.length === 0}
            onClick={props.startEditing}
          >
            <span>
              <span className="block text-base font-bold">{snapshot.status === "not_saved" ? "Start Focus Mode" : "Edit Focus Mode"}</span>
              <span className="mt-0.5 block text-xs font-semibold text-zinc-500 dark:text-zinc-200">
                {props.selectedPresets.length === 0 ? "Select at least one preset." : "Highlight sections, remove, then save rules."}
              </span>
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-soot text-white dark:bg-ember-300 dark:text-soot">
              <ArrowUpRight size={18} />
            </span>
          </button>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {ALL_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={props.selectedPresets.includes(preset)}
                className={`rounded-full px-3 py-2 text-center text-[11px] font-bold shadow-pill transition focus:outline-none focus:ring-2 focus:ring-ember-300 ${
                  props.selectedPresets.includes(preset)
                    ? "bg-ember-100 text-ember-700 dark:bg-ember-500/25 dark:text-ember-100"
                    : "bg-white/50 text-zinc-400 hover:bg-white/75 dark:bg-[#303030] dark:text-zinc-400 dark:hover:bg-[#3a3a3a]"
                }`}
                onClick={() => props.togglePreset(preset)}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
        </section>

        <section className="relative mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">Saved websites</h2>
            <div className="flex items-center gap-2">
              {snapshot.savedSites.length > 5 ? (
                <button
                  type="button"
                  className="rounded-full bg-white px-3 py-2 text-[11px] font-bold text-zinc-600 shadow-pill dark:bg-[#303030] dark:text-zinc-100"
                  onClick={props.openSites}
                >
                  Show all
                </button>
              ) : null}
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-pill dark:bg-[#303030] dark:text-zinc-100"
                title="Reset current page"
                onClick={props.resetCurrentPage}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {snapshot.savedSites.length === 0 ? (
              <div className="rounded-card border border-white/75 bg-white/70 p-5 text-sm font-semibold text-zinc-500 shadow-pill dark:border-white/10 dark:bg-[#252525] dark:text-zinc-100">
                Saved focus rules will appear here as compact site cards.
              </div>
            ) : (
              visibleSavedSites.map((site) => (
                <SavedSiteCard
                  key={site.id}
                  site={site}
                  onOpen={() => props.openSite(site)}
                  onOpenRules={() => props.openRules(site)}
                  onToggleAutoApply={() => props.toggleAutoApply(site)}
                  onReset={() => props.resetSite(site)}
                />
              ))
            )}
          </div>
        </section>

        <section className="relative mt-5 rounded-card border border-white/75 bg-white/70 p-4 shadow-glass dark:border-white/10 dark:bg-[#252525] dark:text-[#fff8ef]">
          <div className="mb-3 flex items-center gap-2">
            <Settings2 size={18} />
            <h2 className="text-lg font-bold">Settings</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-full bg-zinc-100 p-1 dark:bg-[#171717]">
            {(["system", "light", "dark"] satisfies ThemeMode[]).map((theme) => (
              <button
                key={theme}
                className={`rounded-full px-3 py-2 text-xs font-bold capitalize transition ${
                  snapshot.settings.theme === theme
                    ? "bg-white text-ember-600 shadow-pill dark:bg-[#4a4039] dark:text-ember-100"
                    : "text-zinc-500 dark:text-zinc-100"
                }`}
                onClick={() => props.setTheme(theme)}
              >
                {theme}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-[22px] bg-zinc-50 p-3.5 shadow-pill dark:bg-[#303030]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ember-100 text-ember-600 dark:bg-ember-500/20 dark:text-ember-100">
                  <SlidersHorizontal size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-black">Reader width</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-200">
                    {(customMode ? customWidth : snapshot.settings.reading.maxContentWidth)}px · Constrain article width
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-pressed={Boolean(snapshot.settings.reading.enabled)}
                className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${
                  snapshot.settings.reading.enabled ? "justify-end bg-ember-400 shadow-ember" : "justify-start bg-zinc-200 dark:bg-[#171717]"
                }`}
                onClick={props.toggleReaderWidth}
              >
                <span className="h-6 w-6 rounded-full bg-white shadow-pill" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {READER_WIDTH_PRESETS.map((preset) => {
                const Icon = preset.Icon;
                const active = snapshot.settings.reading.widthMode !== "custom" && snapshot.settings.reading.maxContentWidth === preset.width;
                return (
                  <button
                    key={preset.width}
                    type="button"
                    className={`rounded-[18px] px-2.5 py-3 text-left transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-ember-300 ${
                      active
                        ? "bg-white text-ember-700 shadow-pill dark:bg-[#4a4039] dark:text-ember-100"
                        : "bg-white/55 text-zinc-600 hover:bg-white dark:bg-[#252525] dark:text-zinc-100 dark:hover:bg-[#383838]"
                    }`}
                    onClick={() => props.setReadingWidth(preset.width)}
                  >
                    <Icon className={active ? "text-ember-500" : "text-zinc-400 dark:text-zinc-200"} size={16} />
                    <span className="mt-2 block text-[11px] font-black leading-tight">{preset.label}</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-zinc-400 dark:text-zinc-300">{preset.width}px</span>
                  </button>
                );
              })}
              <button
                type="button"
                className={`rounded-[18px] px-2.5 py-3 text-left transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-ember-300 ${
                  customMode
                    ? "bg-white text-ember-700 shadow-pill dark:bg-[#4a4039] dark:text-ember-100"
                    : "bg-white/55 text-zinc-600 hover:bg-white dark:bg-[#252525] dark:text-zinc-100 dark:hover:bg-[#383838]"
                }`}
                onClick={props.activateCustomReaderWidth}
              >
                <SlidersHorizontal className={customMode ? "text-ember-500" : "text-zinc-400 dark:text-zinc-200"} size={16} />
                <span className="mt-2 block text-[11px] font-black leading-tight">Custom</span>
                <span className="mt-0.5 block text-[10px] font-bold text-zinc-400 dark:text-zinc-300">{customWidth}px</span>
              </button>
            </div>
            <div
              className={`grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
                customMode ? "mt-3 grid-rows-[1fr] opacity-100 translate-y-0" : "mt-0 grid-rows-[0fr] opacity-0 -translate-y-1"
              }`}
            >
              <div className="overflow-hidden">
                <div className="rounded-[18px] bg-white/65 p-3 dark:bg-[#252525]">
                  <div className="mb-2 flex items-center justify-between text-[10px] font-black text-zinc-400 dark:text-zinc-300">
                    <span>{CUSTOM_WIDTH_MIN}px</span>
                    <span className="rounded-full bg-ember-100 px-3 py-1 text-ember-700 dark:bg-ember-500/20 dark:text-ember-100">{customWidth}px</span>
                    <span>{CUSTOM_WIDTH_MAX}px</span>
                  </div>
                  <input
                    type="range"
                    min={CUSTOM_WIDTH_MIN}
                    max={CUSTOM_WIDTH_MAX}
                    step={CUSTOM_WIDTH_STEP}
                    value={customWidth}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-ember-500 outline-none transition dark:bg-[#171717]"
                    style={{
                      background: `linear-gradient(to right, rgb(255 139 95) 0%, rgb(255 139 95) ${((customWidth - CUSTOM_WIDTH_MIN) / (CUSTOM_WIDTH_MAX - CUSTOM_WIDTH_MIN)) * 100}%, ${snapshot.settings.theme === "dark" ? "rgb(23 23 23)" : "rgb(228 228 231)"} ${((customWidth - CUSTOM_WIDTH_MIN) / (CUSTOM_WIDTH_MAX - CUSTOM_WIDTH_MIN)) * 100}%, ${snapshot.settings.theme === "dark" ? "rgb(23 23 23)" : "rgb(228 228 231)"} 100%)`
                    }}
                    onChange={(event) => changeCustomWidth(Number(event.currentTarget.value))}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" className="rounded-soft bg-zinc-50 p-3 text-left dark:bg-[#303030]" onClick={props.resetAllRules}>
              <Trash2 className="mb-2 text-coral-500" size={16} />
              <p className="text-[11px] font-bold">Reset rules</p>
              <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-200">Local only</p>
            </button>
            <button type="button" className="rounded-soft bg-zinc-50 p-3 text-left dark:bg-[#303030]" onClick={props.exportJson}>
              <Download className="mb-2 text-ember-500" size={16} />
              <p className="text-[11px] font-bold">Export JSON</p>
              <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-200">{snapshot.savedSites.length} sites</p>
            </button>
            <label className="cursor-pointer rounded-soft bg-zinc-50 p-3 text-left dark:bg-[#303030]">
              <Upload className="mb-2 text-emerald-500" size={16} />
              <p className="text-[11px] font-bold">Import JSON</p>
              <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-200">Replace rules</p>
              <input className="hidden" type="file" accept="application/json,.json" onChange={props.importJson} />
            </label>
          </div>
        </section>

        {props.notice ? (
          <p className="relative mt-4 rounded-full bg-white/70 px-3 py-2 text-center text-[11px] font-bold text-zinc-500 shadow-pill dark:bg-[#252525] dark:text-zinc-100">
            {props.notice}
          </p>
        ) : null}

        <footer className="relative mt-4 flex items-center justify-between rounded-full bg-white/60 px-3 py-2 shadow-pill dark:bg-[#252525]">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-black text-zinc-500 dark:text-zinc-100">
            <span>Made with</span>
            <Heart className="fill-coral-500 text-coral-500" size={13} />
            <span>by Ashirwad</span>
            <span className="ml-1 rounded-full bg-ember-100 px-2 py-0.5 text-[10px] text-ember-700 dark:bg-ember-500/20 dark:text-ember-100">
              v{__APP_VERSION__}
            </span>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-500 shadow-pill transition hover:-translate-y-0.5 hover:text-ember-600 focus:outline-none focus:ring-2 focus:ring-ember-300 dark:bg-[#303030] dark:text-zinc-100 dark:hover:text-ember-100"
            title="About Trimline"
            onClick={props.openAbout}
          >
            <Info size={14} />
          </button>
        </footer>
      </div>
  );
}

function SavedSiteCard(props: {
  site: SavedSite;
  onOpen: () => void;
  onOpenRules: () => void;
  onToggleAutoApply: () => void;
  onReset: () => void;
}) {
  const { site } = props;
  const pageRuleCount = Object.values(site.pageRules).reduce((total, rules) => total + rules.length, 0);
  const scope = site.siteRules.length > 0 ? "Whole Website" : "This Page";

  return (
    <article
      className="cursor-pointer rounded-card border border-white/75 bg-white/82 p-3 shadow-glass transition hover:-translate-y-0.5 hover:shadow-ember dark:border-white/10 dark:bg-[#252525] dark:text-[#fff8ef]"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") props.onOpen();
      }}
    >
      <div className="flex w-full items-center gap-3 text-left">
        <SiteIcon className="h-14 w-14 rounded-[20px] bg-gradient-to-br from-ember-200 to-coral-500 text-lg font-black text-white shadow-ember" domain={site.domain} faviconUrl={site.faviconUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-black">{site.domain}</h3>
            {site.reviewStatus === "needs_review" ? <ShieldAlert className="text-coral-500" size={14} /> : <CheckCircle2 className="text-emerald-500" size={14} />}
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-zinc-500 dark:text-zinc-100">{site.lastPageTitle}</p>
          <p className="truncate text-[11px] font-semibold text-zinc-400 dark:text-zinc-300">{shortUrl(site.lastPageUrl)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-ember-100 px-3 py-1 text-[11px] font-bold text-ember-700 dark:bg-ember-500/20 dark:text-ember-200">{scope}</span>
        <button
          type="button"
          className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-bold text-zinc-600 dark:bg-[#3a3a3a] dark:text-zinc-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleAutoApply();
          }}
        >
          Auto {site.autoApply ? "on" : "off"}
        </button>
        <button
          type="button"
          className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-bold text-zinc-600 transition hover:bg-ember-100 hover:text-ember-700 dark:bg-[#3a3a3a] dark:text-zinc-100 dark:hover:bg-ember-500/20 dark:hover:text-ember-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenRules();
          }}
        >
          {site.siteRules.length + pageRuleCount} rules
        </button>
        <button
          type="button"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-[#3a3a3a] dark:text-zinc-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onReset();
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function SiteIcon(props: {
  className: string;
  domain?: string;
  faviconUrl?: string;
  fallback?: "letter" | "brand";
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(props.faviconUrl && !failed);

  useEffect(() => {
    setFailed(false);
  }, [props.faviconUrl]);

  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden ${props.className}`}>
      {showImage ? (
        <img className="h-full w-full rounded-[inherit] object-cover" src={props.faviconUrl} alt="" onError={() => setFailed(true)} />
      ) : props.fallback === "brand" ? (
        <BrandIcon />
      ) : (
        <span>{props.domain?.slice(0, 1).toUpperCase() ?? "F"}</span>
      )}
    </div>
  );
}

function BrandIcon(props: { className?: string }) {
  return <img className={`h-full w-full rounded-[inherit] object-cover ${props.className ?? ""}`} src="icons/icon-128.png" alt="" />;
}

function SavedSitesScreen(props: {
  sites: SavedSite[];
  onBack: () => void;
  openSite: (site: SavedSite) => Promise<void>;
  openRules: (site: SavedSite) => void;
  toggleAutoApply: (site: SavedSite) => Promise<void>;
  resetSite: (site: SavedSite) => Promise<void>;
}) {
  return (
    <div className="relative min-h-full px-4 py-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_20%_0%,rgba(255,139,95,0.28),transparent_42%),radial-gradient(circle_at_90%_15%,rgba(253,186,116,0.25),transparent_38%)] dark:opacity-50" />
      <header className="relative flex items-center gap-3">
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-pill transition hover:-translate-x-0.5 dark:bg-[#303030]"
          onClick={props.onBack}
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-ember-600 dark:text-ember-200">Saved websites</p>
          <h1 className="truncate text-2xl font-black">{props.sites.length} saved {props.sites.length === 1 ? "site" : "sites"}</h1>
        </div>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-ember-200 to-coral-500 p-1 shadow-ember">
          <BrandIcon />
        </div>
      </header>

      <div className="relative mt-5 space-y-3">
        {props.sites.map((site) => (
          <SavedSiteCard
            key={site.id}
            site={site}
            onOpen={() => props.openSite(site)}
            onOpenRules={() => props.openRules(site)}
            onToggleAutoApply={() => props.toggleAutoApply(site)}
            onReset={() => props.resetSite(site)}
          />
        ))}
      </div>
    </div>
  );
}

function AboutScreen(props: { onBack: () => void }) {
  return (
    <div className="relative min-h-full px-4 py-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_20%_0%,rgba(255,139,95,0.28),transparent_42%),radial-gradient(circle_at_90%_15%,rgba(253,186,116,0.25),transparent_38%)] dark:opacity-50" />
      <header className="relative flex items-center gap-3">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-pill transition hover:-translate-x-0.5 focus:outline-none focus:ring-2 focus:ring-ember-300 dark:bg-[#303030]"
          onClick={props.onBack}
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-ember-600 dark:text-ember-200">About</p>
          <h1 className="truncate text-2xl font-black">Trimline</h1>
        </div>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-ember-200 to-coral-500 p-1 shadow-ember">
          <BrandIcon />
        </div>
      </header>

      <section className="relative mt-5 rounded-card border border-white/75 bg-white/78 p-5 shadow-glass dark:border-white/10 dark:bg-[#252525]">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[20px] bg-gradient-to-br from-coral-500 to-ember-300 p-1.5 shadow-ember">
          <BrandIcon />
        </div>
        <h2 className="mt-4 text-xl font-black">Cleaner pages, same website.</h2>
        <p className="mt-2 text-sm font-semibold leading-relaxed text-zinc-500 dark:text-zinc-100">
          Trimline helps readers and researchers trim distracting sections, save cleanup rules, and keep the original page layout intact.
        </p>
      </section>

      <section className="relative mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-soft bg-white/78 p-4 shadow-pill dark:bg-[#252525]">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-ember-600 dark:text-ember-200">Version</p>
          <p className="mt-2 text-lg font-black">v{__APP_VERSION__}</p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-200">Extension build</p>
        </div>
        <div className="rounded-soft bg-white/78 p-4 shadow-pill dark:bg-[#252525]">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-ember-600 dark:text-ember-200">Storage</p>
          <p className="mt-2 text-lg font-black">v1</p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-200">Local schema</p>
        </div>
      </section>

      <section className="relative mt-3 rounded-card border border-white/75 bg-white/78 p-4 shadow-pill dark:border-white/10 dark:bg-[#252525]">
        <p className="text-sm font-black">Local by design</p>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-zinc-500 dark:text-zinc-100">
          Saved rules, reader settings, and site preferences stay in <span className="font-black">chrome.storage.local</span>. There is no account, sync, or cloud backup in this version.
        </p>
      </section>

      <button
        type="button"
        className="relative mt-3 flex w-full items-center gap-3 rounded-card border border-white/75 bg-white/78 p-4 text-left shadow-pill transition hover:-translate-y-0.5 hover:shadow-glass focus:outline-none focus:ring-2 focus:ring-ember-300 dark:border-white/10 dark:bg-[#252525]"
        onClick={() => chrome.tabs.create({ url: GITHUB_REPO_URL })}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 dark:bg-[#303030] dark:text-zinc-100">
          <Github size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black">View on GitHub</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-zinc-500 dark:text-zinc-200">Ashirwad-Shetye/trimline</span>
        </span>
        <ExternalLink className="text-zinc-400 dark:text-zinc-200" size={16} />
      </button>

      <footer className="relative mt-4 flex items-center justify-center gap-1.5 rounded-full bg-white/60 px-3 py-2 text-[11px] font-black text-zinc-500 shadow-pill dark:bg-[#252525] dark:text-zinc-100">
        <span>Made with</span>
        <Heart className="fill-coral-500 text-coral-500" size={13} />
        <span>by Ashirwad</span>
      </footer>
    </div>
  );
}

function RulesScreen(props: {
  site: SavedSite;
  onBack: () => void;
  onRemoveRule: (site: SavedSite, item: RuleListItem) => Promise<void>;
}) {
  const items = getRuleItems(props.site);
  const pageItems = items.filter((item) => item.scope === "page");
  const siteItems = items.filter((item) => item.scope === "site");

  return (
    <div className="relative min-h-full px-4 py-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_20%_0%,rgba(255,139,95,0.28),transparent_42%),radial-gradient(circle_at_90%_15%,rgba(253,186,116,0.25),transparent_38%)] dark:opacity-50" />
      <header className="relative flex items-center gap-3">
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-pill transition hover:-translate-x-0.5 dark:bg-[#303030]"
          onClick={props.onBack}
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-ember-600 dark:text-ember-200">Saved rules</p>
          <h1 className="truncate text-2xl font-black">{props.site.domain}</h1>
        </div>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-ember-200 to-coral-500 p-1 shadow-ember">
          <BrandIcon />
        </div>
      </header>

      <section className="relative mt-5 rounded-card border border-white/75 bg-white/78 p-4 shadow-glass dark:border-white/10 dark:bg-[#252525]">
        <p className="text-sm font-bold">{items.length} saved {items.length === 1 ? "rule" : "rules"}</p>
        <p className="mt-1 line-clamp-2 text-xs font-semibold text-zinc-500 dark:text-zinc-200">{props.site.lastPageTitle}</p>
        <p className="mt-0.5 truncate text-[11px] font-semibold text-zinc-400 dark:text-zinc-300">{shortUrl(props.site.lastPageUrl)}</p>
      </section>

      <RuleGroup title="Whole Website" items={siteItems} site={props.site} onRemoveRule={props.onRemoveRule} />
      <RuleGroup title="This Page" items={pageItems} site={props.site} onRemoveRule={props.onRemoveRule} />

      {items.length === 0 ? (
        <section className="relative mt-4 rounded-card border border-white/75 bg-white/78 p-5 text-sm font-semibold text-zinc-500 shadow-pill dark:border-white/10 dark:bg-[#252525] dark:text-zinc-100">
          No saved rules remain for this site.
        </section>
      ) : null}
    </div>
  );
}

function RuleGroup(props: {
  title: string;
  items: RuleListItem[];
  site: SavedSite;
  onRemoveRule: (site: SavedSite, item: RuleListItem) => Promise<void>;
}) {
  if (!props.items.length) return null;

  return (
    <section className="relative mt-5">
      <h2 className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-300">{props.title}</h2>
      <div className="space-y-3">
        {props.items.map((item) => (
          <article key={`${item.scope}-${item.pageKey ?? "site"}-${item.rule.id}`} className="rounded-card border border-white/75 bg-white/82 p-3 shadow-glass dark:border-white/10 dark:bg-[#252525]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-ember-100 text-ember-700 dark:bg-ember-500/20 dark:text-ember-100">
                <ListChecks size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">{ruleLabel(item.rule)}</p>
                <p className="mt-1 line-clamp-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-200">{item.rule.cssPath}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-ember-100 px-2.5 py-1 text-[10px] font-bold uppercase text-ember-700 dark:bg-ember-500/20 dark:text-ember-100">
                    {ruleCategoryLabel(item.rule.category)}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold uppercase text-zinc-600 dark:bg-[#3a3a3a] dark:text-zinc-100">
                    {item.rule.tagName}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600 dark:bg-[#3a3a3a] dark:text-zinc-100">
                    {item.scope === "site" ? "Website" : "Page"}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600 dark:bg-[#3a3a3a] dark:text-zinc-100">
                    {formatDate(item.rule.createdAt)}
                  </span>
                </div>
              </div>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-coral-500 hover:text-white dark:bg-[#3a3a3a] dark:text-zinc-100"
                title="Remove rule"
                onClick={() => props.onRemoveRule(props.site, item)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {item.pageLabel ? <p className="mt-3 truncate text-[11px] font-semibold text-zinc-400 dark:text-zinc-300">{shortUrl(item.pageLabel)}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function getRuleItems(site: SavedSite): RuleListItem[] {
  const siteItems = site.siteRules.map((rule) => ({ rule, scope: "site" as const }));
  const pageItems = Object.entries(site.pageRules).flatMap(([savedPageKey, rules]) =>
    rules.map((rule) => ({ rule, scope: "page" as const, pageKey: savedPageKey, pageLabel: savedPageKey }))
  );

  return [...siteItems, ...pageItems];
}

function ruleLabel(rule: HiddenSectionRule): string {
  if (rule.label) return rule.label;
  if (rule.textHint) return rule.textHint.slice(0, 64);
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

function formatDate(value: number): string {
  if (!Number.isFinite(value)) return "Unknown";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clampWidth(value: number): number {
  const normalized = Number.isFinite(value) ? value : 860;
  const stepped = Math.round(normalized / CUSTOM_WIDTH_STEP) * CUSTOM_WIDTH_STEP;
  return Math.min(CUSTOM_WIDTH_MAX, Math.max(CUSTOM_WIDTH_MIN, stepped));
}

function statusLabel(status: PopupSnapshot["status"]): string {
  switch (status) {
    case "restricted":
      return "Unavailable";
    case "saved_page":
      return "Page saved";
    case "saved_site":
      return "Site saved";
    case "needs_review":
      return "Site saved";
    default:
      return "Not saved";
  }
}

createRoot(document.getElementById("root")!).render(<App />);
