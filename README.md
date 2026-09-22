# EasyProxy Worker V0.9

Cloudflare Workers adaptation of the EasyProxy HTTP contract.

## Deploy

The Free plan configuration deliberately contains **no `limits` block**.

```bash
npm install
npx wrangler deploy
```

The Worker is configured for `workers.dev` with the name `flareproxy`.

Keep the existing secret:

```bash
npx wrangler secret put PROXY_SECRET
```

Do not put the secret in `vars`.

## V0.9 changes

- Added `/extractor/video.m3u8`
- Added `/extractor/video.mp4`
- Added `/extractor/video.ts`
- Added `/extractor/video.mkv`
- Added `/extractor/video.webm`
- `/extractor/video` remains compatible with `url` and `d`
- `host`, `redirect_stream` and `h_*` query parameters remain supported
- Generic extractor no longer treats an HTML document as an HLS URL
- Added a portable VixSrc extractor using normal Worker `fetch()` and API/playlist parsing
- No FlareSolverr
- No WARP
- No WireGuard/SOCKS
- No browser automation or Turnstile solving
- No server-side DRM decryption

If an upstream requires a browser challenge or blocks Cloudflare edge traffic, V0.9 returns a structured error instead of generating a bogus signed URL.

## Cloudflare note

Workers execute at Cloudflare edge locations and can make outbound HTTP(S) subrequests with `fetch()`. That is sufficient for ordinary origin fetching; WARP is not required merely to provide Internet egress.


## V0.9 changes

- Adds dedicated `vavoo` and `dlhd` extractor modules.
- Generic extraction no longer scans arbitrary HTML for pseudo-URLs.
- HTML such as `<!doctype html>`, `<script>`, `watch.php`, and page markup can no longer be signed into `/proxy/s/...`.
- Vavoo/DLHD extractors accept only explicit HLS/DASH URLs exposed by the upstream response.
- No FlareSolverr, WARP, browser automation, or challenge bypass is added.
- The existing `PROXY_SECRET`, `workers.dev` deployment, and EasyProxy endpoint names remain unchanged.

### Important Vavoo limitation

Vavoo currently uses an authentication/signature flow that changes over time. The Worker does not invent or hard-code a guessed signature. If a Vavoo page/API does not expose an explicit `.m3u8`/`.mpd`, the endpoint returns a diagnostic error instead of returning a bogus proxy URL.


## V0.9 changes

- `/proxy/hls/manifest.m3u8` and `/proxy/manifest.m3u8` now detect specialized HTML inputs.
- DLHD `watch.php?id=...` is resolved before HLS rewriting.
- DLHD resolver follows explicit landing redirects, player buttons, iframe, channel key, authentication parameters, server lookup, and final `mono.m3u8`.
- The resolver does not execute arbitrary JavaScript and does not use WARP, SOCKS, FlareSolverr, or a browser.
- `@cloudflare/workers-types` is pinned to `^5.20260922.0`.
