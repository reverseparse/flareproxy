export function getTarget(url: URL): string | null {
  return url.searchParams.get("url") || url.searchParams.get("d");
}

export function boolParam(url: URL, name: string): boolean {
  const value = url.searchParams.get(name);
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function htmlInfo(version: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>EasyProxy Worker</title></head><body><h1>EasyProxy Worker</h1><p>API-compatible Cloudflare Worker.</p><p>Version: ${version}</p></body></html>`;
}
