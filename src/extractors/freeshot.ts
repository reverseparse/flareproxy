import type { ExtractContext, ExtractResult, Extractor } from "./types";
import { validateUpstreamUrl } from "../utils/security";

const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function codeOf(input:string):string {
  if (/^https?:\/\//i.test(input)) {
    const u=new URL(input);
    const q=u.searchParams.get("stream");
    if (q) return q;
    const p=u.pathname.match(/\/player\/([^/?#]+)/i); if(p) return p[1];
    const e=u.pathname.match(/\/embed\/([^/.]+)\.php/i); if(e) return e[1];
    const a=u.pathname.split("/").filter(Boolean); if(a.length) return a[a.length-1].replace(/\.(php|html?)$/i,"");
  }
  const g=input.match(/go\.php\?stream=([^&]+)/i); if(g) return decodeURIComponent(g[1]);
  return input.replace(/^freeshot:\/\//i,"").split("?")[0].split("&")[0].replace(/^\/+|\/+$/g,"");
}

export const freeshotExtractor:Extractor={
  name:"freeshot",
  matches(url,host){ const h=(host||url.hostname).toLowerCase(); return h==="freeshot"||h.includes("freeshot.live")||h.includes("popcdn.day"); },
  async extract(url,context):Promise<ExtractResult|null>{
    let channel=codeOf(url.toString());
    if(!channel) throw new Error("Freeshot channel code is empty");

    if(/freeshot\.live/i.test(url.hostname) && !/\/embed\//i.test(url.pathname)){
      const r=await fetch(url,{headers:{"User-Agent":UA,"Referer":"https://thisnot.business/","Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}});
      if(!r.ok) throw new Error(`Freeshot page failed: HTTP ${r.status}`);
      const html=await r.text();
      const m=html.match(/stream=([^&"'\\s]+)/i)||html.match(/embed\/([^/.]+)\.php/i);
      if(m) channel=m[1];
    }

    const target=`https://popcdn.day/player/${encodeURIComponent(channel)}`;
    const r=await fetch(target,{headers:{"User-Agent":UA,"Referer":"https://thisnot.business/","Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}});
    if(!r.ok) throw new Error(`Freeshot player failed: HTTP ${r.status}`);
    const body=await r.text();

    const sm=body.match(/streamUrl\s*:\s*"([^"]+)"/i);
    let finalUrl=sm ? sm[1].replace(/\\+/g,"") : null;
    if(!finalUrl){
      const im=body.match(/frameborder="0"\s+src="([^"]+)"/i);
      if(im){
        const token=new URL(im[1],target).searchParams.get("token");
        if(token) finalUrl=`https://planetary.lovecdn.ru/${encodeURIComponent(channel)}/tracks-v1a1/mono.m3u8?token=${encodeURIComponent(token)}`;
      }
    }
    if(!finalUrl) throw new Error("Freeshot token/streamUrl not found in player page");
    return {destination_url:validateUpstreamUrl(finalUrl,context.env.ALLOWED_HOSTS??"").toString(),
      request_headers:{"User-Agent":UA,"Referer":"https://popcdn.day/","Origin":"https://popcdn.day"},
      source_url:url.toString(),extractor:"freeshot",media_type:"hls"};
  }
};
