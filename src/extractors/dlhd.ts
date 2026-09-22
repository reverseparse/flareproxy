import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const DLHD_HOST_RE = /(?:daddylive|dlhd|dlive)/i;

function isDlhdHost(hostname: string, forced?: string | null): boolean {
  const h = (forced || hostname).toLowerCase().replace(/^www\./, "");
  return ["dlhd", "dlive", "daddylive", "daddylivehd"].includes(h) || DLHD_HOST_RE.test(h);
}

function decodeB64(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

function findChannelId(input: string): string | null {
  const patterns = [
    /\/premium(\d+)\/mono\.m3u8/i,
    /\/(?:watch|stream|cast|player)\/stream-(\d+)\.php/i,
    /watch\.php\?id=(\d+)/i,
    /(?:%2F|\/)stream-(\d+)\.php/i,
    /stream-(\d+)\.php/i
  ];
  for (const re of patterns) {
    const m = input.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function findPlayerLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<button[^>]*data-url=["']([^"']+)["'][^>]*>\s*Player\s*\d+\s*<\/button>/gi;
  for (const m of html.matchAll(re)) {
    try { out.push(new URL(m[1].replaceAll("\\/", "/"), base).toString()); } catch {}
  }
  return out;
}

function findIframe(html: string, base: string): string | null {
  const patterns = [
    /<iframe[^>]+src=["']([^"']+)["']/i,
    /<iframe[^>]+src=([^ >]+)/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    try {
      const candidate = m[1].replace(/^["']|["']$/g, "").replaceAll("\\/", "/");
      return new URL(candidate, base).toString();
    } catch {}
  }
  return null;
}

function findRedirectTarget(html: string, base: string): string | null {
  const patterns = [
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.replace\(\s*["']([^"']+)["']\s*\)/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    try { return new URL(m[1].replaceAll("\\/", "/"), base).toString(); } catch {}
  }
  return null;
}

function extractChannelKey(html: string): string | null {
  const patterns = [
    /const\s+CHANNEL_KEY\s*=\s*["']([^"']+)["']/i,
    /channelKey\s*=\s*["']([^"']+)["']/i,
    /(?:let|const)\s+channelKey\s*=\s*["']([^"']+)["']/i,
    /var\s+channelKey\s*=\s*["']([^"']+)["']/i,
    /channel_id\s*:\s*["']([^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractAuthParams(html: string): Record<string, string> {
  const keyMap: Record<string, string[]> = {
    auth_host: ["host", "b_host", "server", "domain"],
    auth_php: ["script", "b_script", "php", "path"],
    auth_ts: ["ts", "b_ts", "timestamp", "time"],
    auth_rnd: ["rnd", "b_rnd", "random", "nonce"],
    auth_sig: ["sig", "b_sig", "signature", "sign"]
  };

  const result: Record<string, string> = {};
  const re = /(?:const|var|let)\s+[A-Z0-9_]+\s*=\s*["']([A-Za-z0-9+/=_-]{50,})["']/g;

  for (const match of html.matchAll(re)) {
    const decoded = decodeB64(match[1]);
    if (!decoded) continue;
    try {
      const obj = JSON.parse(decoded) as Record<string, unknown>;
      let complete = true;
      for (const [target, aliases] of Object.entries(keyMap)) {
        let found = false;
        for (const alias of aliases) {
          if (!(alias in obj)) continue;
          const raw = String(obj[alias]);
          result[target] = decodeB64(raw) ?? raw;
          found = true;
          break;
        }
        if (!found) { complete = false; break; }
      }
      if (complete) return result;
    } catch {}
  }

  return {};
}

function findLookupPath(html: string): string | null {
  const patterns = [
    /fetchWithRetry\(\s*["'](\/server_lookup\.(?:js|php)\?channel_id=)["']/i,
    /["'](\/server_lookup\.(?:js|php)\?channel_id=)["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function fetchText(url: string, headers: Record<string,string>): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, { headers, redirect: "follow" });
  const text = await response.text();
  return { response, text };
}

export const dlhdExtractor: Extractor = {
  name: "dlhd",

  matches(url, host) {
    return isDlhdHost(url.hostname, host);
  },

  async extract(url, context): Promise<ExtractResult | null> {
    const channelId = findChannelId(url.toString());
    if (!channelId) {
      throw new Error(`DLHD channel id not found in URL: ${url.toString()}`);
    }

    const ua = context.headers["user-agent"] ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36";

    const baseHeaders: Record<string,string> = {
      "user-agent": ua,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      referer: url.origin + "/",
      origin: url.origin,
      ...context.headers
    };

    // Current DLHD can return a lightweight redirect page before the actual
    // player page. Follow explicit JS redirects, but never execute arbitrary JS.
    let current = url.toString();
    let initial: { response: Response; text: string } | null = null;
    for (let i = 0; i < 3; i++) {
      initial = await fetchText(current, baseHeaders);
      const direct = initial.text.match(/https?:\/\/[^\s"'<>]+?\.m3u8(?:\?[^\s"'<>]*)?/i)?.[0];
      if (direct) {
        const safe = validateUpstreamUrl(direct.replaceAll("\\/", "/").replaceAll("&amp;", "&"), context.env.ALLOWED_HOSTS ?? "").toString();
        return { destination_url: safe, request_headers: {...baseHeaders, referer: current}, source_url: url.toString(), extractor: "dlhd", media_type: "hls" };
      }
      const redirect = findRedirectTarget(initial.text, initial.response.url || current);
      if (!redirect || redirect === current) break;
      current = redirect;
    }

    if (!initial) throw new Error("DLHD initial request failed");

    const baseUrl = new URL(initial.response.url || current).origin + "/";
    let playerLinks = findPlayerLinks(initial.text, baseUrl);
    let iframeUrl: string | null = null;

    // Current DLHD watch pages also expose the embed directly as:
    // /stream/stream-<channel>.php (and equivalent /cast, /watch, /plus,
    // /casting, /player folders). Prefer the explicit embed when present.
    const embedRe = /<iframe[^>]+src=["']([^"']*\/stream\/stream-\\d+\\.php[^"']*)["']/i;
    const embedMatch = initial.text.match(embedRe);
    if (embedMatch?.[1]) {
      try {
        iframeUrl = new URL(embedMatch[1].replaceAll("\\/", "/"), initial.response.url || current).toString();
      } catch {}
    }

    // If no iframe was embedded, construct the documented stream player URL
    // from the channel id. This is an explicit URL convention, not arbitrary
    // HTML/JS execution.
    if (!iframeUrl && channelId) {
      try {
        iframeUrl = new URL(`/stream/stream-${channelId}.php`, initial.response.url || current).toString();
      } catch {}
    }

    // Some current landing pages redirect to /lander?id=... before exposing
    // the Player buttons.
    if (!playerLinks.length) {
      const redirect = findRedirectTarget(initial.text, initial.response.url || current);
      if (redirect && redirect !== current) {
        const page = await fetchText(redirect, baseHeaders);
        playerLinks = findPlayerLinks(page.text, new URL(page.response.url || redirect).origin + "/");
        initial = page;
      }
    }

    // If an iframe is already present, use it directly.
    if (!iframeUrl) iframeUrl = findIframe(initial.text, initial.response.url || current);

    let lastError = "";
    for (const playerUrl of playerLinks.slice(0, 5)) {
      try {
        const player = await fetchText(playerUrl, {...baseHeaders, referer: current});
        const candidate = findIframe(player.text, player.response.url || playerUrl);
        if (candidate) { iframeUrl = candidate; break; }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    if (!iframeUrl) {
      throw new Error(
        `DLHD player iframe not found for channel ${channelId}` +
        (lastError ? `: ${lastError}` : "")
      );
    }

    const iframeHeaders = {
      ...baseHeaders,
      referer: iframeUrl,
      origin: new URL(iframeUrl).origin
    };

    const iframe = await fetchText(iframeUrl, iframeHeaders);
    const channelKey = extractChannelKey(iframe.text);
    const auth = extractAuthParams(iframe.text);
    if (!channelKey) throw new Error("DLHD channel key not found");
    for (const key of ["auth_host","auth_php","auth_ts","auth_rnd","auth_sig"]) {
      if (!auth[key]) throw new Error(`DLHD authentication parameter missing: ${key}`);
    }

    let authPhp = auth.auth_php.replace(/^\/+/, "");
    if (authPhp === "a.php") authPhp = "auth.php";
    const authUrl = new URL(authPhp, auth.auth_host.endsWith("/") ? auth.auth_host : auth.auth_host + "/");
    authUrl.searchParams.set("channel_id", channelKey);
    authUrl.searchParams.set("ts", auth.auth_ts);
    authUrl.searchParams.set("rnd", auth.auth_rnd);
    authUrl.searchParams.set("sig", auth.auth_sig);

    const authResponse = await fetch(authUrl.toString(), {
      headers: {...iframeHeaders, referer: iframeUrl, origin: new URL(iframeUrl).origin},
      redirect: "follow"
    });
    if (!authResponse.ok) throw new Error(`DLHD auth failed: HTTP ${authResponse.status}`);

    const lookupPath = findLookupPath(iframe.text);
    if (!lookupPath) throw new Error("DLHD server lookup endpoint not found");

    const lookupUrl = new URL(lookupPath + encodeURIComponent(channelKey), new URL(iframeUrl).origin).toString();
    const lookupResponse = await fetch(lookupUrl, {headers: iframeHeaders, redirect: "follow"});
    if (!lookupResponse.ok) throw new Error(`DLHD server lookup failed: HTTP ${lookupResponse.status}`);

    const serverData = await lookupResponse.json() as { server_key?: string };
    if (!serverData.server_key) throw new Error("DLHD server lookup returned no server_key");

    const serverKey = serverData.server_key;
    let streamUrl: string;
    if (serverKey === "top1/cdn") {
      streamUrl = `https://top1.newkso.ru/top1/cdn/${channelKey}/mono.m3u8`;
    } else if (serverKey.includes("/")) {
      const [domain] = serverKey.split("/");
      streamUrl = `https://${domain}.newkso.ru/${serverKey}/${channelKey}/mono.m3u8`;
    } else {
      streamUrl = `https://${serverKey}new.newkso.ru/${serverKey}/${channelKey}/mono.m3u8`
        .replace("top2new", "top1new");
    }

    const safe = validateUpstreamUrl(streamUrl, context.env.ALLOWED_HOSTS ?? "").toString();
    return {
      destination_url: safe,
      request_headers: {
        "user-agent": ua,
        referer: iframeUrl,
        origin: new URL(iframeUrl).origin
      },
      source_url: url.toString(),
      extractor: "dlhd",
      media_type: "hls"
    };
  }
};
