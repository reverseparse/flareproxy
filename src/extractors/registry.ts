import { validateUpstreamUrl } from "../utils/security";
import { genericExtractor } from "./generic";
import { vixsrcExtractor } from "./vixsrc";
import type { ExtractContext, ExtractResult, Extractor } from "./types";

const extractors: Extractor[] = [vixsrcExtractor, genericExtractor];

export async function extractVideo(
  raw: string,
  context: ExtractContext,
  forcedHost?: string | null
): Promise<ExtractResult> {
  const url = validateUpstreamUrl(raw, context.env.ALLOWED_HOSTS ?? "");
  const candidates = forcedHost
    ? extractors.filter(item => item.matches(url, forcedHost))
    : extractors.filter(item => item.matches(url));

  if (!candidates.length) {
    throw new Error(`Unsupported extractor host: ${forcedHost || url.hostname}`);
  }

  let lastError: unknown = null;
  for (const extractor of candidates) {
    try {
      const result = await extractor.extract(url, context);
      if (result?.destination_url) return result;
    } catch (error) {
      lastError = error;
      // A specialized extractor can fail because the site changed or blocked
      // the edge request; do not silently convert its HTML into a stream URL.
      if (forcedHost && forcedHost.toLowerCase() !== "generic") throw error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("No direct stream URL found");
}

export function listExtractors(): string[] {
  return extractors.map(x => x.name);
}
