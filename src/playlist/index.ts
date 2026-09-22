import { sealState } from "../crypto/state";

function parseUrls(raw: string): string[] {
  return raw.split(/\r?\n|;/).map(x => x.trim()).filter(Boolean);
}

export async function buildPlaylist(
  raw: string,
  origin: string,
  secret: string
): Promise<string> {
  const urls = parseUrls(raw);
  const lines = ["#EXTM3U"];
  let i = 0;
  for (const source of urls) {
    i++;
    const token = await sealState({ u: source, m: "hls", e: Date.now() + 15 * 60_000 }, secret);
    lines.push(`#EXTINF:-1,EasyProxy ${i}`);
    lines.push(`${origin}/proxy/s/${encodeURIComponent(token)}`);
  }
  return lines.join("\n") + "\n";
}
