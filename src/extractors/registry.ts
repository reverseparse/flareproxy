import { validateUpstreamUrl } from "../utils/security";
import { genericExtractor } from "./generic";
import type { ExtractContext, ExtractResult, Extractor } from "./types";

const extractors: Extractor[] = [genericExtractor];

export async function extractVideo(
  raw: string,
  context: ExtractContext,
  forcedHost?: string | null
): Promise<ExtractResult> {
  const url = validateUpstreamUrl(raw, context.env.ALLOWED_HOSTS ?? "");
  const extractor = extractors.find(item => item.matches(url, forcedHost));
  if (!extractor) throw new Error(`Unsupported extractor host: ${forcedHost || url.hostname}`);
  const result = await extractor.extract(url, context);
  if (!result) throw new Error("No direct stream URL found");
  return result;
}

export function listExtractors(): string[] { return extractors.map(x => x.name); }
