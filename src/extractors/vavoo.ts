import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const RESOLVE="https://vavoo.to/mediahubmx-resolve.json";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function normalize(input:string):string {
  const u=new URL(input);
  if(u.pathname.includes("/watch")) {
    const live=u.searchParams.get("live");
    if(live) return `https://vavoo.to/vavoo-iptv/play/${live}`;
  }
  const m=u.pathname.match(/\/play\/([^/?#]+)/i);
  if(m) return `https://vavoo.to/vavoo-iptv/play/${m[1]}`;
  return input;
}

export const vavooExtractor:Extractor={
  name:"vavoo",
  matches(url,host){
    const h=(host||url.hostname).toLowerCase().replace(/^www\./,"");
    return h==="vavoo" || h==="vavoo.to" || h==="vavoo.tv" || h==="kool.to";
  },
  async extract(url,context):Promise<ExtractResult|null>{
    if(!/vavoo\.to/i.test(url.toString()) && !/kool\.to/i.test(url.toString()))
      throw new Error("Not a valid Vavoo URL");

    const normalized=normalize(url.toString());
    const r=await fetch(RESOLVE,{
      method:"POST",
      headers:{
        "Origin":"https://vavoo.to",
        "Referer":"https://vavoo.to/",
        "User-Agent":UA,
        "Accept":"application/json",
        "Content-Type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({language:"de",region:"DE",url:normalized})
    });

    if(!r.ok) throw new Error(`Vavoo resolve failed: HTTP ${r.status}`);

    const data:any=await r.json();
    const destination=
      Array.isArray(data) && data[0]?.url ? String(data[0].url) :
      data?.url ? String(data.url) :
      data?.data?.url ? String(data.data.url) : null;

    if(!destination) throw new Error("Vavoo resolve returned no URL");

    const safe=validateUpstreamUrl(destination,context.env.ALLOWED_HOSTS??"").toString();

    return {
      destination_url:safe,
      request_headers:{
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer":"https://vavoo.to",
        "Origin":"https://vavoo.to",
        "X-EasyProxy-Disable-SSL":"1"
      },
      source_url:url.toString(),
      extractor:"vavoo",
      media_type:/\.mpd(?:$|\?)/i.test(safe)?"dash":/\.m3u8(?:$|\?)/i.test(safe)?"hls":"stream"
    };
  }
};
