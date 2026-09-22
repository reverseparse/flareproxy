import { sealState } from "../crypto/state";
import type { ProxyState } from "../types";

interface DashContext {
  baseUrl: string;
  media?: string;
  initialization?: string;
}

function resolve(base: string, value: string): string {
  return new URL(value, base).toString();
}

function getAttribute(tag: string, name: string): string | undefined {
  const expression = new RegExp(
    `\\s${name}\\s*=\\s*"([^"]*)"`,
    "i"
  );
  return tag.match(expression)?.[1];
}

function setAttribute(
  tag: string,
  name: string,
  value: string
): string {
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");

  const expression = new RegExp(
    `(\\s${name}\\s*=\\s*")([^"]*)(")`,
    "i"
  );

  return tag.replace(expression, `$1${escaped}$3`);
}

async function makeDashBase(
  upstreamDirectory: string,
  workerOrigin: string,
  secret: string,
  headers?: Record<string, string>
): Promise<string> {
  const state: ProxyState = {
    u: upstreamDirectory,
    h: headers,
    m: "dash",
    e: Date.now() + 15 * 60_000
  };

  const token = await sealState(state, secret);

  return `${workerOrigin}/proxy/d/${encodeURIComponent(token)}`;
}

/*
 * V0.4 DASH rewriting:
 *
 * - preserves SegmentTemplate variables;
 * - rewrites media and initialization to the Worker;
 * - handles BaseURL at MPD/Period/AdaptationSet/Representation levels;
 * - preserves SegmentTimeline untouched;
 * - resolves relative templates against the effective inherited BaseURL.
 *
 * This is intentionally a lexical XML transformer instead of a DOM parser:
 * Workers has no browser DOM dependency, and the MPD can be quite large.
 */
export async function rewriteMpd(
  xml: string,
  sourceUrl: string,
  workerOrigin: string,
  secret: string,
  headers?: Record<string, string>
): Promise<string> {
  const tokens = [...xml.matchAll(/<!--[^]*?-->|<[^>]+>|[^<]+/g)]
    .map(match => match[0]);

  const stack: DashContext[] = [];
  const output: string[] = [];
  const root = new URL(sourceUrl).toString();

  const currentBase = (): string =>
    stack.length ? stack[stack.length - 1].baseUrl : root;

  const isClosing = (token: string): boolean =>
    /^<\s*\//.test(token);

  const isSelfClosing = (token: string): boolean =>
    /\/\s*>$/.test(token);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (!token.startsWith("<")) {
      output.push(token);
      continue;
    }

    if (token.startsWith("<!--") || token.startsWith("<!")) {
      output.push(token);
      continue;
    }

    if (isClosing(token)) {
      output.push(token);
      stack.pop();
      continue;
    }

    const element = token.match(
      /^<\s*([A-Za-z_][\w:.-]*)\b/i
    );

    if (!element) {
      output.push(token);
      continue;
    }

    const name = element[1];
    const selfClosing = isSelfClosing(token);

    if (/^BaseURL$/i.test(name) && !selfClosing) {
      const value = (tokens[i + 1] ?? "").trim();
      const closing = tokens[i + 2] ?? "";

      if (
        value &&
        /^<\/BaseURL\s*>$/i.test(closing)
      ) {
        const absolute = resolve(currentBase(), value);
        const directory = absolute.endsWith("/")
          ? absolute
          : `${absolute}/`;

        const proxyBase = await makeDashBase(
          directory,
          workerOrigin,
          secret,
          headers
        );

        output.push(token, proxyBase + "/", closing);
        i += 2;

        if (stack.length) {
          stack[stack.length - 1].baseUrl = directory;
        }

        continue;
      }
    }

    if (/^SegmentTemplate$/i.test(name)) {
      const base = currentBase();
      let rewritten = token;

      for (const attribute of ["media", "initialization"]) {
        const value = getAttribute(token, attribute);
        if (!value) continue;

        const absolute = /^https?:\/\//i.test(value)
          ? value
          : resolve(base, value);

        const slash = absolute.lastIndexOf("/");
        const directory = slash >= 0
          ? absolute.slice(0, slash + 1)
          : absolute;
        const filename = slash >= 0
          ? absolute.slice(slash + 1)
          : absolute;

        const proxyBase = await makeDashBase(
          directory,
          workerOrigin,
          secret,
          headers
        );

        rewritten = setAttribute(
          rewritten,
          attribute,
          `${proxyBase}/${filename}`
        );
      }

      output.push(rewritten);

      if (!selfClosing) {
        stack.push({
          baseUrl: base,
          media: getAttribute(token, "media"),
          initialization: getAttribute(token, "initialization")
        });
      }

      continue;
    }

    output.push(token);

    if (!selfClosing) {
      stack.push({ baseUrl: currentBase() });
    }
  }

  return output.join("");
}
