const RESTRICTED_PROTOCOLS = new Set(["chrome:", "chrome-extension:", "edge:", "about:", "devtools:"]);

export function parseHttpUrl(url?: string): URL | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;

  try {
    const parsed = new URL(url);
    if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return true;
    if (parsed.hostname === "chrome.google.com" || parsed.hostname === "chromewebstore.google.com") return true;
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
}

export function pageKey(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url;
  parsed.hash = "";
  return parsed.toString();
}

export function canonicalPageKey(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url;
  parsed.hash = "";
  parsed.hostname = parsed.hostname.replace(/^www\./, "");
  return parsed.toString();
}

export function siteIdFromUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  return parsed?.hostname.replace(/^www\./, "") ?? "unknown";
}

export function originPatternFromUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return "";
  return `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "")}/*`;
}

export function originPatternsForUrl(url: string): string[] {
  const parsed = parseHttpUrl(url);
  if (!parsed) return [];

  const bareHost = parsed.hostname.replace(/^www\./, "");
  return [`${parsed.protocol}//${bareHost}/*`, `${parsed.protocol}//www.${bareHost}/*`];
}

export function shortUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url;
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.hostname.replace(/^www\./, "")}${path}`.slice(0, 54);
}
