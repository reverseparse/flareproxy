# EasyProxy Worker V0.6

Cloudflare Workers implementation of the portable EasyProxy HTTP contract.

## Compatibility

The Worker intentionally preserves the public EasyProxy endpoint family:

- `/proxy/manifest.m3u8`
- `/proxy/hls/manifest.m3u8`
- `/proxy/mpd/manifest.m3u8`
- `/proxy/stream`
- `/extractor/video`
- `/playlist`
- `/proxy/ip`
- `/generate_urls` (POST)
- `/license` and `/key`
- `/api/info`, `/info`, `/builder`
- `/record`, `/recordings`, `/api/recordings/*` return an explicit 501 because FFmpeg/filesystem DVR is not portable to this build.

### Parameter compatibility

`url` and `d` are aliases. Custom upstream headers use `h_<header>`, matching EasyProxy. `redirect_stream=true` is supported by `/extractor/video` and returns a 302 to a signed Worker proxy URL.

## Portable scope

Implemented with Workers Fetch/Streams: HLS rewriting, DASH MPD rewriting, generic HTTP proxying, stateless signed routes, generic direct URL/HTML extraction, playlist proxying.

Not included: FFmpeg recording, WARP/WireGuard/SOCKS subprocesses, browser/FlareSolverr automation, server-side CENC decryption.

## Deploy

Set a strong `PROXY_SECRET` and optionally `ALLOWED_HOSTS` as a comma-separated hostname allowlist.

```bash
npm install
npx wrangler secret put PROXY_SECRET
npm run check
npm run test
npx wrangler deploy
```
