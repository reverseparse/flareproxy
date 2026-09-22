# EasyProxy Worker V0.7

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

## V0.7 changes

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

If an upstream requires a browser challenge or blocks Cloudflare edge traffic, V0.7 returns a structured error instead of generating a bogus signed URL.

## Cloudflare note

Workers execute at Cloudflare edge locations and can make outbound HTTP(S) subrequests with `fetch()`. That is sufficient for ordinary origin fetching; WARP is not required merely to provide Internet egress.
