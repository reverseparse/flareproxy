const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./
];

const FORWARDED_HEADERS = new Set([
  "user-agent",
  "referer",
  "origin",
  "cookie",
  "authorization",
  "accept",
  "accept-language",
  "range",
  "if-none-match",
  "if-modified-since"
]);

function isPrivateHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return PRIVATE_IPV4.some(pattern => pattern.test(host));
  }

  if (host.includes(":")) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }

  return false;
}

export function validateUpstreamUrl(
  raw: string,
  allowedHosts = ""
): URL {
  const target = new URL(raw);

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP(S) upstreams are allowed");
  }

  if (isPrivateHostname(target.hostname)) {
    throw new Error("Private/local upstream is not allowed");
  }

  const allowlist = allowedHosts
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (
    allowlist.length > 0 &&
    !allowlist.some(host =>
      target.hostname.toLowerCase() === host ||
      target.hostname.toLowerCase().endsWith(`.${host}`)
    )
  ) {
    throw new Error("Upstream host is not allowlisted");
  }

  return target;
}

export function collectProxyHeaders(
  request: Request,
  overrides?: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const name of FORWARDED_HEADERS) {
    const value = overrides?.[name] ?? request.headers.get(name);
    if (value) result[name] = value;
  }

  return result;
}

export function copyProxyHeaders(
  request: Request,
  overrides?: Record<string, string>
): Headers {
  const result = new Headers();

  for (const [name, value] of Object.entries(
    collectProxyHeaders(request, overrides)
  )) {
    result.set(name, value);
  }

  return result;
}

export function responseHeaders(upstream: Response): Headers {
  const result = new Headers();

  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "etag",
    "last-modified",
    "expires"
  ]) {
    const value = upstream.headers.get(name);
    if (value) result.set(name, value);
  }

  result.set("access-control-allow-origin", "*");
  result.set(
    "access-control-expose-headers",
    "Content-Length, Content-Range, Accept-Ranges, ETag"
  );

  return result;
}
