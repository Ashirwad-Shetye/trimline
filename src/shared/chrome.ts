import type { ContentCommand } from "./types";

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies ContentCommand);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}

export async function sendContentCommand<T = unknown>(tabId: number, command: ContentCommand): Promise<T> {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, command);
}
