import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const DOMAIN_FEED =
  "https://raw.githubusercontent.com/realbestia1/domains/refs/heads/main/domains.json";

const DEFAULT_DOMAINS = ["vixsrc.to", "vixsrc.me", "vixsrc.sx"];

function hostMatches(hostname: string, forced?: string | null): boolean {
  const h = (forced || hostname).toLowerCase().replace(/^www\./, "");
  return h === "vixsrc" || h.startsWith("vixsrc.") || h.includes("vixsrc.");
}

function absolute(value: string, base: string): string | null {
  try {
    return validateUpstreamUrl(new URL(value, base).toString(), "").toString();
  } catch {
    return null;
  }
}

function findStringDeep(value: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringDeep(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key.toLowerCase()) && typeof item === "string" && item.trim()) {
        return item.trim();
      }
      const found = findStringDeep(item, keys, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function findUrlDeep(value: unknown): string | null {
  const keys = new Set(["url", "stream_url", "streamurl", "m3u8", "playlist", "file", "source", "src"]);
  return findStringDeep(value, keys);
}

function parseMasterPlaylist(html: string, pageUrl: string): string | null {
  // Current VixSrc implementations expose a masterPlaylist payload containing
  // a base URL plus token/expiry data. This parser accepts both JSON-like and
  // JS object syntax without executing page JavaScript.
  const base =
    html.match(/(?:url|file|source)\s*[:=]\s*["']([^"']+)["']/i)?.[1] ??
    html.match(/["'](?:url|file|source)["']\s*:\s*["']([^"']+)["']/i)?.[1];

  const token =
    html.match(/["']?token["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  const expires =
    html.match(/["']?expires["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1];

  if (!base) return null;
  const resolved = absolute(base, pageUrl);
  if (!resolved) return null;

  if (!token || !expires) {
    return /\.m3u8(?:$|\?)/i.test(resolved) ? resolved : null;
  }

  const out = new URL(resolved);
  if (!out.searchParams.has("token")) out.searchParams.set("token", token);
  if (!out.searchParams.has("expires")) out.searchParams.set("expires", expires);
  if (!out.searchParams.has("h")) out.searchParams.set("h", "1");
  if (!out.searchParams.has("lang")) out.searchParams.set("lang", "en");
  return out.toString();
}

async function currentDomain(context: ExtractContext, input: URL): Promise<string> {
  try {
    const response = await fetch(DOMAIN_FEED, {
      headers: { accept: "application/json", "user-agent": context.headers["user-agent"] || "EasyProxy-Worker/0.7" }
    });
    if (response.ok) {
      const data = await response.json() as unknown;
      const found = findStringDeep(data, new Set(["vixsrc", "domain", "host"]), 0);
      if (found && /vixsrc/i.test(found)) return found.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    }
  } catch {}
  return input.hostname;
}

function apiUrl(page: URL, domain: string): { url: string; media: "movie" | "tv" } | null {
  const parts = page.pathname.split("/").filter(Boolean);
  if (parts[0] === "movie" && /^\d+$/.test(parts[1] || "")) {
    return { url: `https://${domain}/api/movie/${parts[1]}`, media: "movie" };
  }
  if (parts[0] === "tv" && /^\d+$/.test(parts[1] || "") && /^\d+$/.test(parts[2] || "") && /^\d+$/.test(parts[3] || "")) {
    return { url: `https://${domain}/api/tv/${parts[1]}/${parts[2]}/${parts[3]}`, media: "tv" };
  }
  if (parts[0] === "api" && (parts[1] === "movie" || parts[1] === "tv")) {
    return { url: page.toString(), media: parts[1] as "movie" | "tv" };
  }
  return null;
}

export const vixsrcExtractor: Extractor = {
  name: "vixsrc",
  matches(url, host) {
    return hostMatches(url.hostname, host);
  },

  async extract(url, context): Promise<ExtractResult | null> {
    const domain = await currentDomain(context, url);
    const api = apiUrl(url, domain);
    if (!api) throw new Error("VixSrc URL must be /movie/{tmdbId} or /tv/{tmdbId}/{season}/{episode}");

    const headers: Record<string, string> = {
      ...context.headers,
      referer: `https://${domain}/`,
      accept: "application/json, text/plain, */*"
    };

    const response = await fetch(api.url, { headers, redirect: "follow" });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const text = await response.text();

    if (!response.ok) {
      if (response.status === 403 || response.status === 429 || response.status === 503) {
        throw new Error(`VixSrc upstream returned ${response.status}; browser challenge/edge block may be required`);
      }
      throw new Error(`VixSrc API returned ${response.status}`);
    }

    let embed: string | null = null;
    if (contentType.includes("json")) {
      try {
        embed = findUrlDeep(JSON.parse(text));
      } catch {}
    }

    // Some versions return an HTML/JS page even from the API endpoint.
    if (!embed) embed = parseMasterPlaylist(text, response.url || api.url);

    if (!embed) {
      const direct = text.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i)?.[0];
      if (direct) embed = direct;
    }

    if (!embed) {
      throw new Error("VixSrc returned no direct stream URL; browser-side JS/challenge flow is not implemented in the Worker");
    }

    // If the API already gives us the final HLS URL, return it. Otherwise
    // inspect one embed document and accept only a real playlist URL.
    const finalUrl = absolute(embed, response.url || api.url);
    if (!finalUrl) throw new Error("VixSrc returned an invalid stream URL");

    if (/\.m3u8(?:$|\?)/i.test(finalUrl)) {
      return {
        destination_url: finalUrl,
        request_headers: { ...context.headers, referer: `https://${domain}/` },
        source_url: url.toString(),
        extractor: "vixsrc",
        media_type: "hls"
      };
    }

    const embedResponse = await fetch(finalUrl, {
      headers: { ...context.headers, referer: `https://${domain}/` },
      redirect: "follow"
    });
    const embedText = await embedResponse.text();
    const playlist = parseMasterPlaylist(embedText, embedResponse.url || finalUrl)
      ?? embedText.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i)?.[0]
      ?? null;

    if (!playlist) {
      throw new Error("VixSrc embed did not expose a direct HLS playlist; browser-side JS/challenge flow is not implemented in the Worker");
    }

    return {
      destination_url: playlist,
      request_headers: { ...context.headers, referer: finalUrl },
      source_url: url.toString(),
      extractor: "vixsrc",
      media_type: "hls"
    };
  }
};
