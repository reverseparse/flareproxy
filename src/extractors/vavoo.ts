import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const VAVOO_HOSTS = new Set(["vavoo.to", "vavoo.tv", "kool.to"]);

function mediaType(url: string): ExtractResult["media_type"] {
  return /\.mpd(?:$|\?)/i.test(url) ? "dash" : /\.m3u8(?:$|\?)/i.test(url) ? "hls" : "stream";
}

function explicitMediaUrls(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/[^\s"'<>\\]+?\.mpd(?:\?[^\s"'<>\\]*)?/gi
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      try { out.add(validateUpstreamUrl(m[0].replaceAll("\\/", "/").replaceAll("&amp;", "&"), "").toString()); } catch {}
    }
  }
  return [...out];
}

function directFromJson(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /\.(?:m3u8|mpd)(?:$|\?)/i.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const x of value) { const v = directFromJson(x, depth + 1); if (v) return v; }
    return null;
  }
  if (typeof value === "object") {
    for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
      if (/^(url|stream|stream_url|playlist|m3u8|mpd|source|src)$/i.test(k)) {
        const v = directFromJson(x, depth + 1);
        if (v) return v;
      }
      const nested = directFromJson(x, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function isVavooHost(hostname: string, forced?: string | null): boolean {
  const h = (forced || hostname).toLowerCase().replace(/^www\./, "");
  return h === "vavoo" || VAVOO_HOSTS.has(h) || h.endsWith(".vavoo.to");
}

export const vavooExtractor: Extractor = {
  name: "vavoo",
  matches(url, host) {
    return isVavooHost(url.hostname, host);
  },

  async extract(url, context): Promise<ExtractResult | null> {
    // If a caller already supplied a real media URL on a Vavoo hostname,
    // preserve it rather than downloading HTML.
    if (/\.(?:m3u8|mpd)(?:$|\?)/i.test(url.pathname)) {
      return {
        destination_url: url.toString(),
        request_headers: { ...context.headers, referer: "https://vavoo.to/" },
        source_url: url.toString(),
        extractor: "vavoo",
        media_type: mediaType(url.toString())
      };
    }

    const headers = {
      accept: "application/json, text/plain, */*",
      "user-agent": context.headers["user-agent"] || "Mozilla/5.0",
      ...context.headers,
      referer: "https://vavoo.to/"
    };

    const response = await fetch(url.toString(), { headers, redirect: "follow" });
    const type = (response.headers.get("content-type") || "").toLowerCase();
    const text = await response.text();

    let found: string | null = null;
    if (type.includes("json")) {
      try { found = directFromJson(JSON.parse(text)); } catch {}
    }
    if (!found) found = explicitMediaUrls(text)[0] || null;

    if (!found) {
      throw new Error(
        `Vavoo returned no explicit HLS/DASH URL (HTTP ${response.status}); ` +
        `the current Vavoo authentication/signature flow is not guessed by the Worker`
      );
    }

    const safe = validateUpstreamUrl(found, context.env.ALLOWED_HOSTS ?? "").toString();
    return {
      destination_url: safe,
      request_headers: { ...headers, referer: url.origin + "/" },
      source_url: url.toString(),
      extractor: "vavoo",
      media_type: mediaType(safe)
    };
  }
};
