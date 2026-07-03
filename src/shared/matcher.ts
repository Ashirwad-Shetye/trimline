import type { HiddenSectionRule } from "./types";

export type MatchResult = {
  element: HTMLElement;
  confidence: number;
};

export const AUTO_APPLY_CONFIDENCE = 0.72;

export function findRuleMatch(rule: HiddenSectionRule, root: ParentNode = document): MatchResult | undefined {
  const direct = safeQuery(rule.cssPath, root);
  if (direct) {
    const confidence = scoreElement(direct, rule);
    if (confidence >= 0.52) return { element: direct, confidence };
  }

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(rule.tagName.toLowerCase()));
  let best: MatchResult | undefined;

  for (const element of candidates) {
    const confidence = scoreElement(element, rule);
    if (!best || confidence > best.confidence) best = { element, confidence };
  }

  return best;
}

function safeQuery(selector: string, root: ParentNode): HTMLElement | undefined {
  try {
    const element = root.querySelector(selector);
    return element instanceof HTMLElement ? element : undefined;
  } catch {
    return undefined;
  }
}

function scoreElement(element: HTMLElement, rule: HiddenSectionRule): number {
  const rect = element.getBoundingClientRect();
  const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
  const sizeRatio = clamp((rect.width * rect.height) / viewportArea);
  const style = window.getComputedStyle(element.parentElement ?? element);
  let score = 0;

  if (element.tagName.toLowerCase() === rule.tagName.toLowerCase()) score += 0.18;
  if ((element.getAttribute("role") ?? undefined) === rule.role) score += 0.12;
  if (rule.textHint && normalizeText(element.innerText).includes(normalizeText(rule.textHint))) score += 0.18;
  if (Math.abs(sizeRatio - rule.sizeRatio) < 0.16) score += 0.18;
  if (Math.abs(rect.top / window.innerHeight - rule.layoutPosition.topRatio) < 0.2) score += 0.12;
  if (Math.abs(rect.left / window.innerWidth - rule.layoutPosition.leftRatio) < 0.2) score += 0.1;
  if (style.display === rule.parentContext.display) score += 0.08;
  if ((element.parentElement?.children.length ?? 0) === rule.parentContext.childCount) score += 0.04;

  return clamp(score);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 96);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
