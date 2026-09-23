import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const RESOLVE_URL = "https://vavoo.to/mediahubmx-resolve.json";
const VAVOO_HOSTS = new Set(["vavoo.to", "vavoo.tv", "kool.to"]);

function normalizeVavooUrl(input: string): string {
  const u = new URL(input);

  if (u.pathname === "/watch") {
    const live = u.searchParams.get("live");
    if (live) return `https://vavoo.to/vavoo-iptv/play/${encodeURIComponent(live)}`;
  }

  const m = u.pathname.match(/\/play\/([^/?#]+)/i);
  if (m) return `https://vavoo.to/vavoo-iptv/play/${m[1]}`;

  return input;
}

function isVavooHost(hostname: string, forced?: string | null): boolean {
  const h = (forced || hostname).toLowerCase().replace(/^www\./, "");
  return h === "vavoo" || VAVOO_HOSTS.has(h) || h.endsWith(".vavoo.to");
}

function mediaType(url: string): ExtractResult["media_type"] {
  return /\.mpd(?:$|\?)/i.test(url) ? "dash" :
    /\.m3u8(?:$|\?)/i.test(url) ? "hls" : "stream";
}

export const vavooExtractor: Extractor = {
  name: "vavoo",

  matches(url, host) {
    return isVavooHost(url.hostname, host);
  },

  async extract(url, context): Promise<ExtractResult | null> {
    const normalized = normalizeVavooUrl(url.toString());

    const headers: Record<string, string> = {
      "origin": "https://vavoo.to",
      "referer": "https://vavoo.to/",
      "user-agent": "okhttp/4.11.0",
      "accept": "application/json",
      "content-type": "application/json; charset=utf-8",
      ...context.headers
    };

    // EasyProxy's current extractor sends this exact JSON request to the
    // Vavoo resolver endpoint instead of scraping arbitrary HTML.
    const response = await fetch(RESOLVE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        language: "de",
        region: "DE",
        url: normalized
      })
    });

    if (!response.ok) {
      throw new Error(`Vavoo resolve failed: HTTP ${response.status}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error("Vavoo resolve returned invalid JSON");
    }

    let destination: string | null = null;

    if (Array.isArray(data) && data.length && typeof data[0] === "object" && data[0] !== null) {
      const value = (data[0] as Record<string, unknown>).url;
      if (typeof value === "string") destination = value;
    }

    if (!destination && typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.url === "string") destination = obj.url;
      const nested = obj.data;
      if (!destination && typeof nested === "object" && nested !== null) {
        const value = (nested as Record<string, unknown>).url;
        if (typeof value === "string") destination = value;
      }
    }

    if (!destination) {
      throw new Error("Vavoo resolve returned no destination URL");
    }

    const safe = validateUpstreamUrl(destination, context.env.ALLOWED_HOSTS ?? "").toString();

    return {
      destination_url: safe,
      request_headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "referer": "https://vavoo.to",
        "origin": "https://vavoo.to",
        ...context.headers
      },
      source_url: url.toString(),
      extractor: "vavoo",
      media_type: mediaType(safe)
    };
  }
};
