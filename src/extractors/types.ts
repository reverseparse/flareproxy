export interface ExtractResult {
  destination_url: string;
  request_headers?: Record<string, string>;
  source_url?: string;
  extractor?: string;
  media_type?: "hls" | "dash" | "stream";
}

export interface ExtractContext {
  request: Request;
  env: { ALLOWED_HOSTS?: string };
  headers: Record<string, string>;
}

export interface Extractor {
  name: string;
  matches(url: URL, host?: string | null): boolean;
  extract(url: URL, context: ExtractContext): Promise<ExtractResult | null>;
}
