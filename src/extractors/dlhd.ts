import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

function isDlhdHost(hostname: string, forced?: string | null): boolean {
  const h = (forced || hostname).toLowerCase().replace(/^www\./, "");
  if (["dlhd", "dlive", "daddylive", "daddylivehd"].includes(h)) return true;
  return /(?:daddylive|dlhd|dlive)/i.test(h);
}

function findMedia(text: string): string | null {
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi,
    /https?:\/\/[^\s"'<>\\]+?\.mpd(?:\?[^\s"'<>\\]*)?/gi
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      try { return validateUpstreamUrl(m[0].replaceAll("\\/", "/").replaceAll("&amp;", "&"), "").toString(); } catch {}
    }
  }
  return null;
}

function findIframe(text: string, base: string): string | null {
  const patterns = [
    /<iframe[^>]+src=["']([^"']+)["']/i,
    /(?:iframe|player|embed|source)\s*[:=]\s*["']([^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    try {
      const u = new URL(m[1].replaceAll("\\/", "/"), base);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch {}
  }
  return null;
}

export const dlhdExtractor: Extractor = {
  name: "dlhd",
  matches(url, host) {
    return isDlhdHost(url.hostname, host);
  },

  async extract(url, context): Promise<ExtractResult | null> {
    const headers = {
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "user-agent": context.headers["user-agent"] || "Mozilla/5.0",
      ...context.headers
    };

    let current = url.toString();
    for (let hop = 0; hop < 2; hop++) {
      const response = await fetch(current, { headers, redirect: "follow" });
      const text = await response.text();

      const direct = findMedia(text);
      if (direct) {
        return {
          destination_url: direct,
          request_headers: { ...headers, referer: current },
          source_url: url.toString(),
          extractor: "dlhd",
          media_type: /\.mpd(?:$|\?)/i.test(direct) ? "dash" : "hls"
        };
      }

      const iframe = findIframe(text, response.url || current);
      if (!iframe) break;
      current = iframe;
    }

    throw new Error(
      "DaddyLive/DLive page exposed no explicit HLS/DASH URL; " +
      "browser JavaScript/challenge resolution is not implemented in the Worker"
    );
  }
};
