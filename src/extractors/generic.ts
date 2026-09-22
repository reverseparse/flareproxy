import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

function kind(value: string): ExtractResult["media_type"] {
  const path = new URL(value).pathname.toLowerCase();
  if (path.includes(".mpd")) return "dash";
  if (path.includes(".m3u8")) return "hls";
  return "stream";
}

function candidateUrls(text: string, base: URL): string[] {
  const out = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>]+?\.m3u8(?:\?[^\s"'<>]*)?/gi,
    /https?:\/\/[^\s"'<>]+?\.mpd(?:\?[^\s"'<>]*)?/gi,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      try { out.add(validateUpstreamUrl(match[0].replaceAll("\\/", "/"), "").toString()); } catch {}
    }
  }
  try { out.add(new URL(text.trim(), base).toString()); } catch {}
  return [...out];
}

export const genericExtractor: Extractor = {
  name: "generic",
  matches(url, host) {
    if (host && host.toLowerCase() !== "generic") return false;
    return /\.m3u8(?:$|\?)/i.test(url.pathname + url.search) ||
      /\.mpd(?:$|\?)/i.test(url.pathname + url.search) ||
      /\.(mp4|mkv|webm|ts)(?:$|\?)/i.test(url.pathname + url.search) ||
      !url.hostname.includes("vavoo.to");
  },
  async extract(url, context) {
    const direct = /\.(m3u8|mpd|mp4|mkv|webm|ts)(?:$|\?)/i.test(url.pathname + url.search);
    if (direct) {
      return {
        destination_url: url.toString(),
        request_headers: context.headers,
        source_url: url.toString(),
        extractor: "generic",
        media_type: kind(url.toString())
      };
    }

    const response = await fetch(url.toString(), {
      headers: context.headers,
      redirect: "follow"
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
    const text = await response.text();
    const candidates = candidateUrls(text, url);
    const chosen = candidates.find(x => /\.(m3u8|mpd)(?:$|\?)/i.test(x));
    if (!chosen) return null;
    return {
      destination_url: chosen,
      request_headers: context.headers,
      source_url: url.toString(),
      extractor: "generic",
      media_type: kind(chosen)
    };
  }
};
