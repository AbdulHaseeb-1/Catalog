import { browser } from "#imports";
import type { ExtensionRequestMessage, ExtensionResponseMessage } from "@verifybridge/shared";

/** Typed wrapper around `browser.runtime.sendMessage` for talking to the background worker. */
export async function sendToBackground(
  message: ExtensionRequestMessage,
): Promise<ExtensionResponseMessage> {
  return browser.runtime.sendMessage(message);
}

export async function getActiveTabOrigin(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).origin;
  } catch {
    return null;
  }
}
