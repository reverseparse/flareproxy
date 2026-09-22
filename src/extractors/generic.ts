import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

function kind(value: string): ExtractResult["media_type"] {
  const path = new URL(value).pathname.toLowerCase();
  if (path.endsWith(".mpd")) return "dash";
  if (path.endsWith(".m3u8")) return "hls";
  return "stream";
}

function looksLikeHls(text: string): boolean {
  return /^\s*#EXTM3U(?:\s|$)/i.test(text);
}

function looksLikeDash(text: string): boolean {
  return /<MPD(?:\s|>)/i.test(text);
}

function extractExplicitMediaUrls(text: string): string[] {
  const out = new Set<string>();
  // Deliberately require a media extension. This prevents strings such as
  // "<!doctype html>" or "watch.php?id=..." from becoming upstream URLs.
  const re = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|mkv|webm|ts)(?:\?[^\s"'<>\\]*)?/gi;
  for (const match of text.matchAll(re)) {
    const candidate = match[0].replaceAll("\\/", "/").replaceAll("&amp;", "&");
    try { out.add(validateUpstreamUrl(candidate, "").toString()); } catch {}
  }
  return [...out];
}

function isDirectMedia(url: URL): boolean {
  return /\.(?:m3u8|mpd|mp4|mkv|webm|ts)$/i.test(url.pathname);
}

export const genericExtractor: Extractor = {
  name: "generic",
  matches(url, host) {
    if (host && host.toLowerCase() !== "generic") return false;
    return isDirectMedia(url);
  },

  async extract(url, context) {
    if (!isDirectMedia(url)) return null;
    return {
      destination_url: url.toString(),
      request_headers: context.headers,
      source_url: url.toString(),
      extractor: "generic",
      media_type: kind(url.toString())
    };
  }
};
