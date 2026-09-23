import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function channelCode(input: string): string {
  let value=input;

  if (/freeshot\.live/i.test(value)) {
    const embed=value.match(/embed\/([^/.]+)\.php/i);
    if (embed) return embed[1];

    // Preserve the EasyProxy behavior: inspect the page for stream=<code>
    // or an embed/<code>.php link. This is done in extract() because it
    // requires an upstream request.
  }

  const go=value.match(/go\.php\?stream=([^&]+)/i);
  if (go) return decodeURIComponent(go[1]);

  const player=value.match(/(?:popcdn|wideiptv)\.top\/player\/([^/?#]+)/i);
  if (player) return decodeURIComponent(player[1]);

  const emb=value.match(/embed\/([^/.]+)\.php/i);
  if (emb) return emb[1];

  if (!/^https?:\/\//i.test(value))
    return value.replace(/^freeshot:\/\//i,"").split("?")[0].split("&")[0];

  try {
    const u=new URL(value);
    const parts=u.pathname.split("/").filter(Boolean);
    if (parts.length) {
      let candidate=parts[parts.length-1];
      if (/^\d+$/.test(candidate) && parts.length>1) candidate=parts[parts.length-2];
      return candidate.replace(/\.php$/i,"");
    }
  } catch {}
  return value;
}

async function text(url:string, headers:Record<string,string>):Promise<string> {
  const r=await fetch(url,{headers,redirect:"follow"});
  if (!r.ok) throw new Error(`Freeshot fetch failed for ${url}: HTTP ${r.status}`);
  return r.text();
}

export const freeshotExtractor: Extractor = {
  name:"freeshot",

  matches(url,host) {
    const h=(host||url.hostname).toLowerCase();
    return h==="freeshot" ||
      h.includes("freeshot.live") ||
      h.includes("popcdn.day") ||
      h.includes("wideiptv.top");
  },

  async extract(url,context):Promise<ExtractResult|null> {
    let code=channelCode(url.toString());

    if (/freeshot\.live/i.test(url.hostname)) {
      const embed=url.pathname.match(/\/embed\/([^/.]+)\.php/i);
      if (embed) code=embed[1];
      else {
        const body=await text(url.toString(),{
          "User-Agent":UA,
          "Referer":"https://thisnot.business/",
          "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        });
        const stream=body.match(/stream=([^&"'\\s]+)/i);
        const emb=body.match(/embed\/([^/.]+)\.php/i);
        if(stream) code=decodeURIComponent(stream[1]);
        else if(emb) code=emb[1];
      }
    }

    code=code.split("?")[0].split("&")[0];
    if(!code) throw new Error("Freeshot channel code is empty");

    // This is the important difference from V1.2:
    // the current EasyProxy extractor supplied by the user resolves through
    // wideiptv.top/player/<code>, while popcdn.day/go.php is only an input
    // locator/legacy form.
    const player=`https://wideiptv.top/player/${encodeURIComponent(code)}`;

    const body=await text(player,{
      "User-Agent":UA,
      "Referer":"https://freeshot.live/",
      "Origin":"https://freeshot.live",
      "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });

    let destination:string|null=null;
    const streamUrl=body.match(/streamUrl\s*:\s*"([^"]+)"/i);
    if(streamUrl) {
      destination=streamUrl[1].replace(/\\/g,"");
    } else {
      const iframe=body.match(/frameborder="0"\s+src="([^"]+)"/i);
      if(iframe) {
        const iframeUrl=new URL(iframe[1],player);
        const token=iframeUrl.searchParams.get("token");
        if(token)
          destination=`https://planetary.lovecdn.ru/${encodeURIComponent(code)}/tracks-v1a1/mono.m3u8?token=${encodeURIComponent(token)}`;
      }
    }

    if(!destination)
      throw new Error("Freeshot token/streamUrl not found in wideiptv player");

    return {
      destination_url:validateUpstreamUrl(destination,context.env.ALLOWED_HOSTS??"").toString(),
      request_headers:{
        "User-Agent":UA,
        "Referer":"https://wideiptv.top/",
        "Origin":"https://wideiptv.top"
      },
      source_url:url.toString(),
      extractor:"freeshot",
      media_type:"hls"
    };
  }
};
