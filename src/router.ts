import { openState, sealState } from "./crypto/state";
import { rewriteHls } from "./manifest/hls";
import { rewriteMpd } from "./manifest/mpd";
import { passThrough, fetchUpstream } from "./proxy/upstream";
import { extractVideo, listExtractors } from "./extractors/registry";
import { buildPlaylist } from "./playlist";
import { boolParam, getTarget, htmlInfo } from "./compat";
import type { Env } from "./types";
import { collectProxyHeaders, validateUpstreamUrl } from "./utils/security";

const VERSION = "1.1.0";

function json(value: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extra
    }
  });
}
function error(message: string, status = 400): Response { return json({ error: message }, status); }
function queryHeaders(request: Request, url: URL): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of url.searchParams) if (key.toLowerCase().startsWith("h_")) overrides[key.slice(2)] = value;
  return collectProxyHeaders(request, overrides);
}
function requireSecret(env: Env): void { if (!env.PROXY_SECRET) throw new Error("PROXY_SECRET is not configured"); }

async function proxyTarget(request: Request, env: Env, target: string, headers: Record<string,string>, method = request.method): Promise<Response> {
  const safe = validateUpstreamUrl(target, env.ALLOWED_HOSTS ?? "");
  if (method === "POST") {
    const upstream = await fetch(safe.toString(), { method: "POST", headers, body: request.body, redirect: "follow" });
    return passThrough(upstream);
  }
  return passThrough(await fetchUpstream(request, safe.toString(), env, headers));
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin":"*", "access-control-allow-methods":"GET,HEAD,POST,DELETE,OPTIONS", "access-control-allow-headers":"Content-Type, Authorization, Range" }});

  if (path === "/api/health") return json({ ok:true, service:"easyproxy-worker", version:VERSION, runtime:"cloudflare-workers" });
  if (path === "/api/info") return json({ ok:true, service:"easyproxy-worker", version:VERSION, endpoints:["/proxy/manifest.m3u8","/proxy/hls/manifest.m3u8","/proxy/mpd/manifest.m3u8","/proxy/stream","/extractor/video","/extractor/video.m3u8","/extractor/video.mp4","/extractor/video.ts","/extractor/video.mkv","/extractor/video.webm","/playlist","/proxy/ip","/generate_urls","/license","/key"], extractors:listExtractors(), unsupported:["/record","/recordings","/api/recordings/*","/proxy/mpd/segment.mp4"] });
  if (path === "/info") return new Response(htmlInfo(VERSION), { headers:{"content-type":"text/html; charset=utf-8"} });
  if (path === "/builder") return new Response("EasyProxy Worker playlist builder API is available at /generate_urls and /playlist.", {headers:{"content-type":"text/plain; charset=utf-8"}});
  if (path === "/") return new Response("EasyProxy Worker V1.0\nCompatible API surface for EasyProxy clients.\n", {headers:{"content-type":"text/plain; charset=utf-8"}});

  try {
    if (path === "/proxy/ip") {
      const cf = (request as Request & { cf?: { clientTcpRtt?: number } }).cf;
      return json({ ip: request.headers.get("CF-Connecting-IP") || null, client_tcp_rtt: cf?.clientTcpRtt ?? null });
    }

    if (path === "/proxy/manifest.m3u8" || path === "/proxy/hls/manifest.m3u8" || path === "/proxy/hls") {
      requireSecret(env); const raw = getTarget(url); if (!raw) return error("Missing url");
      let target = validateUpstreamUrl(raw, env.ALLOWED_HOSTS ?? ""); const headers = queryHeaders(request,url);
      let upstream = await fetchUpstream(request,target.toString(),env,headers);
      let resolvedHeaders = headers;

      // EasyProxy-compatible behavior: a non-manifest page such as
      // dlhd.dad/watch.php?id=850 is an extractor input, not an HLS manifest.
      // Resolve known specialized hosts before passing content to the HLS rewriter.
      const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
      const looksManifest = contentType.includes("mpegurl") || contentType.includes("vnd.apple.mpegurl") ||
        contentType.includes("dash+xml");
      if (upstream.ok && !looksManifest) {
        const sample = await upstream.clone().text();
        const isHls = /^\s*#EXTM3U(?:\s|$)/i.test(sample);
        const isMpd = /<MPD[\s>]/i.test(sample);
        if (!isHls && !isMpd) {
          const host = target.hostname.toLowerCase();
          if (/(?:daddylive|dlhd|dlive|vavoo)/i.test(host)) {
            const result = await extractVideo(target.toString(), {request, env, headers}, null);
            target = validateUpstreamUrl(result.destination_url, env.ALLOWED_HOSTS ?? "");
            resolvedHeaders = result.request_headers || headers;
            upstream = await fetchUpstream(request,target.toString(),env,resolvedHeaders);
          }
        }
      }
      if (!upstream.ok) {
        const upstreamStatus = upstream.status;
        const upstreamType = (upstream.headers.get("content-type") || "").toLowerCase();
        // Do not expose a successful HTTP 200 HTML error page as an HLS
        // manifest. This is especially important for CDN/DNS errors such
        // as Cloudflare 1016 returned by a provider upstream.
        if (upstreamStatus === 200 && upstreamType.includes("text/html")) {
          return json({
            ok: false,
            error: "Upstream returned HTML instead of an HLS/DASH manifest",
            code: "UPSTREAM_NOT_MEDIA",
            upstream_url: target.toString()
          }, 502);
        }
        return passThrough(upstream);
      }

      const text = await upstream.text();
      const isHls = /^\s*#EXTM3U(?:\s|$)/i.test(text);
      const isMpd = /<MPD[\s>]/i.test(text);
      if (!isHls && !isMpd) {
        return json({
          ok: false,
          error: "Upstream response is not an HLS or DASH manifest",
          code: "UPSTREAM_NOT_MANIFEST",
          upstream_url: target.toString(),
          content_type: upstream.headers.get("content-type") || null
        }, 502);
      }
      if (isMpd) {
        const body = await rewriteMpd(text,target.toString(),url.origin,env.PROXY_SECRET,resolvedHeaders);
        return new Response(body,{headers:{"content-type":"application/dash+xml","cache-control":"no-store","access-control-allow-origin":"*"}});
      }
      const body = await rewriteHls(text,target.toString(),url.origin,env.PROXY_SECRET,resolvedHeaders);
      return new Response(body,{headers:{"content-type":"application/vnd.apple.mpegurl","cache-control":"no-store","access-control-allow-origin":"*"}});
    }

    if (path === "/proxy/mpd/manifest.m3u8" || path === "/proxy/mpd") {
      requireSecret(env); const raw = getTarget(url); if (!raw) return error("Missing url");
      const target = validateUpstreamUrl(raw,env.ALLOWED_HOSTS??""); const headers=queryHeaders(request,url);
      const upstream=await fetchUpstream(request,target.toString(),env,headers); if(!upstream.ok)return passThrough(upstream);
      const body=await rewriteMpd(await upstream.text(),target.toString(),url.origin,env.PROXY_SECRET,headers);
      return new Response(body,{headers:{"content-type":"application/dash+xml","cache-control":"no-store","access-control-allow-origin":"*"}});
    }

    if (path === "/proxy/stream") {
      const raw=getTarget(url); if(!raw)return error("Missing url");
      return proxyTarget(request,env,raw,queryHeaders(request,url));
    }

    if (path === "/proxy/s" || path.startsWith("/proxy/s/")) {
      requireSecret(env); const token=path.slice("/proxy/s/".length); if(!token)return error("Missing token");
      const state=await openState(decodeURIComponent(token),env.PROXY_SECRET); return passThrough(await fetchUpstream(request,state.u,env,state.h));
    }

    if (path.startsWith("/proxy/d/")) {
      requireSecret(env); const rest=path.slice("/proxy/d/".length); const i=rest.indexOf("/"); const token=i<0?rest:rest.slice(0,i); const suffix=i<0?"":rest.slice(i+1);
      const state=await openState(decodeURIComponent(token),env.PROXY_SECRET); const target=suffix?new URL(suffix,state.u).toString():state.u;
      return passThrough(await fetchUpstream(request,target,env,state.h));
    }

    const extractorPaths = new Set([
      "/extractor/video",
      "/extractor/video.m3u8",
      "/extractor/video.mp4",
      "/extractor/video.ts",
      "/extractor/video.mkv",
      "/extractor/video.webm"
    ]);

    if (extractorPaths.has(path)) {
      const raw=getTarget(url);
      if(!raw)return json({ok:false, error:"Missing url or d", supported_hosts:listExtractors()},400);

      const forcedHost=url.searchParams.get("host");
      const result=await extractVideo(raw,{request,env,headers:queryHeaders(request,url)},forcedHost);

      // Extension aliases are compatibility aliases, not a request to lie about
      // the origin format. They always return a proxied/redirected destination.
      const wantsRedirect = boolParam(url,"redirect_stream") || path !== "/extractor/video";
      if(wantsRedirect) {
        requireSecret(env);
        const mediaType = path.endsWith(".m3u8") ? "hls" :
          path.endsWith(".mp4") || path.endsWith(".ts") || path.endsWith(".mkv") || path.endsWith(".webm") ? "stream" :
          result.media_type;
        const token=await sealState({
          u:result.destination_url,
          h:result.request_headers,
          m:mediaType,
          e:Date.now()+15*60_000
        },env.PROXY_SECRET);
        const route=mediaType==="dash"?`/proxy/d/${encodeURIComponent(token)}`:`/proxy/s/${encodeURIComponent(token)}`;
        return Response.redirect(new URL(route,url.origin).toString(),302);
      }

      return json({
        ok:true,
        destination_url:result.destination_url,
        request_headers:result.request_headers||{},
        source_url:result.source_url,
        extractor:result.extractor,
        media_type:result.media_type
      });
    }

    if (path === "/playlist") {
      requireSecret(env); const raw=getTarget(url); if(!raw)return error("Missing url");
      const response=await fetch(validateUpstreamUrl(raw,env.ALLOWED_HOSTS??"").toString(),{headers:queryHeaders(request,url),redirect:"follow"});
      if(!response.ok)return passThrough(response);
      const playlist=await buildPlaylist(await response.text(),url.origin,env.PROXY_SECRET);
      return new Response(playlist,{headers:{"content-type":"application/vnd.apple.mpegurl","cache-control":"no-store","access-control-allow-origin":"*"}});
    }

    if (path === "/generate_urls" && request.method === "POST") {
      requireSecret(env); const input=await request.json() as {urls?:string[]|string}; const values=Array.isArray(input.urls)?input.urls:(typeof input.urls==="string"?input.urls.split(/\r?\n/):[]);
      const urls=[]; for(const value of values){ const target=validateUpstreamUrl(value,env.ALLOWED_HOSTS??""); const token=await sealState({u:target.toString(),e:Date.now()+15*60_000},env.PROXY_SECRET); urls.push(`${url.origin}/proxy/s/${encodeURIComponent(token)}`); }
      return json({urls});
    }

    if (path === "/key" || path === "/license") {
      const raw=getTarget(url); if(!raw)return error("Missing url");
      const headers=queryHeaders(request,url);
      return proxyTarget(request,env,raw,headers,request.method === "POST" ? "POST" : "GET");
    }

    if (path === "/record" || path === "/recordings" || path.startsWith("/api/recordings")) return json({ok:false,error:"DVR is not available in the Cloudflare Worker build",code:"DVR_UNSUPPORTED"},501);

    return error("Not found",404);
  } catch (cause) {
    const message=cause instanceof Error?cause.message:"Internal error";
    const status=/not allowed|allowlisted/i.test(message)?403:/missing|invalid parameter/i.test(message)?400:502;
    return json({
      ok:false,
      error:message,
      code: /VixSrc/i.test(message) ? "VIXSRC_UNAVAILABLE" : "UPSTREAM_ERROR"
    }, status);
  }
}
