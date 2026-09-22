import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

function kind(value: string): ExtractResult["media_type"] {
  const path = new URL(value).pathname.toLowerCase();
  if (/\.(?:mpd)$/i.test(path)) return "dash";
  if (/\.(?:m3u8)$/i.test(path)) return "hls";
  return "stream";
}

function looksLikeHls(text: string): boolean {
  return /^\s*#EXTM3U(?:\s|$)/i.test(text);
}

function looksLikeDash(text: string): boolean {
  return /<MPD(?:\s|>)/i.test(text);
}

function candidateUrls(text: string, base: URL): string[] {
  const out = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/[^\s"'<>\\]+?\.mpd(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|mkv|webm|ts)(?:\?[^\s"'<>\\]*)?/gi
  ];

  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      try {
        out.add(validateUpstreamUrl(match[0].replaceAll("\\/", "/"), "").toString());
      } catch {}
    }
  }

  return [...out];
}

function isDirectMedia(url: URL): boolean {
  return /\.(m3u8|mpd|mp4|mkv|webm|ts)(?:$)/i.test(url.pathname);
}

export const genericExtractor: Extractor = {
  name: "generic",
  matches(url, host) {
    if (host && host.toLowerCase() !== "generic") return false;
    return isDirectMedia(url) || !url.hostname.includes("vavoo.to");
  },

  async extract(url, context) {
    if (isDirectMedia(url)) {
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

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const text = await response.text();

    // A raw playlist returned from an extension-less URL is valid.
    if (looksLikeHls(text) || /mpegurl|vnd\.apple\.mpegurl/i.test(contentType)) {
      return {
        destination_url: response.url || url.toString(),
        request_headers: context.headers,
        source_url: url.toString(),
        extractor: "generic",
        media_type: "hls"
      };
    }

    if (looksLikeDash(text) || /dash\+xml/i.test(contentType)) {
      return {
        destination_url: response.url || url.toString(),
        request_headers: context.headers,
        source_url: url.toString(),
        extractor: "generic",
        media_type: "dash"
      };
    }

    // Only accept URLs explicitly found in the document. Never use the
    // whole HTML document as a URL.
    if (contentType.includes("text/html") || contentType.includes("text/plain") || !contentType) {
      const candidates = candidateUrls(text, url);
      const chosen = candidates.find(x => /\.(m3u8|mpd)(?:$|\?)/i.test(x))
        ?? candidates.find(x => /\.(mp4|mkv|webm|ts)(?:$|\?)/i.test(x));

      if (!chosen) return null;

      return {
        destination_url: chosen,
        request_headers: context.headers,
        source_url: url.toString(),
        extractor: "generic",
        media_type: kind(chosen)
      };
    }

    return null;
  }
};
