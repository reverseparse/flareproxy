import { sealState } from "../crypto/state";
import type { ProxyState } from "../types";

const URI_ATTRIBUTE = /URI="([^"]*)"/g;

function resolveHttp(base: URL, value: string): string | null {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

async function signedUrl(
  target: string,
  workerOrigin: string,
  secret: string,
  headers?: Record<string, string>
): Promise<string> {
  const state: ProxyState = {
    u: target,
    h: headers,
    m: "hls",
    e: Date.now() + 15 * 60_000
  };

  const token = await sealState(state, secret);
  return `${workerOrigin}/proxy/s/${encodeURIComponent(token)}`;
}

export async function rewriteHls(
  input: string,
  sourceUrl: string,
  workerOrigin: string,
  secret: string,
  headers?: Record<string, string>
): Promise<string> {
  const base = new URL(sourceUrl);
  const lines = input.replaceAll("\r", "").split("\n");

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];

    if (line.startsWith("#")) {
      const matches = [...line.matchAll(URI_ATTRIBUTE)];

      for (const match of matches.reverse()) {
        const target = resolveHttp(base, match[1]);
        if (!target) continue;

        const replacement = await signedUrl(
          target,
          workerOrigin,
          secret,
          headers
        );

        const start = match.index! + 5;
        line =
          line.slice(0, start) +
          replacement +
          line.slice(start + match[1].length);
      }
    } else if (line.trim()) {
      const target = resolveHttp(base, line.trim());
      if (target) {
        line = await signedUrl(
          target,
          workerOrigin,
          secret,
          headers
        );
      }
    }

    lines[index] = line;
  }

  return lines.join("\n");
}
