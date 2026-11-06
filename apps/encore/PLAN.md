# Encore: a self-hosted, mobile-first YouTube player

Build plan for a personal web app, hosted on the homelab, that plays YouTube on a phone with:

1. **Background playback.** Audio keeps playing when the screen locks or you switch apps, with lock-screen and headphone controls and automatic next-track.
2. **No Shorts.** Shorts are filtered out on the server, so the UI never gets one.
3. **No ads.** Streams are fetched directly by the server, so YouTube's ad system never runs. SponsorBlock (optional) also skips sponsor reads inside videos.

You sign into Encore with your own password, not with a Google account. Your YouTube subscriptions come in from a Google Takeout CSV.

> **For the implementing agent:** read the whole document before writing code. Section 5 (player engine) and section 6 (stream proxy) cover what's hard about this project; most of the rest is a normal CRUD web app. Build in the phase order in section 10. Commit and push after each phase.

---

## 1. Hard limits (read first)

| What | Reality | What we do about it |
|---|---|---|
| Lock screen or switching apps | Works in mobile browsers **if audio plays through an `<audio>` element**. A `<video>` element is paused by the OS when the page goes to the background. | Audio always plays through one persistent `<audio>` element. Video, when shown, is a **muted** element kept in sync with it (section 5). |
| iPhone: Safari tab vs. Home-Screen web app | Background audio in a Safari tab is reliable. Home-Screen (standalone) web apps on iOS have a long history of stopping audio on lock or leaving lock-screen controls dead. | Build it as a PWA anyway, but **on iPhone the supported mode is a Safari tab.** Test both and write down which works on the user's iOS version. |
| Swiping the browser away in the app switcher | Kills playback on every phone, for every web app. No web technology gets around this. | Out of scope for the web app. Optional Phase 8 covers an Android native wrapper with a foreground service if that's ever needed. On iPhone, force-quitting stops even native apps. |
| YouTube changes things | yt-dlp and youtubei.js break now and then until upstream ships a fix, usually within days. | Keep YouTube access behind two small adapter modules (section 4). yt-dlp updates itself daily (section 9). |
| Terms of service | This bypasses YouTube's player and ads, which is against YouTube's ToS. | Personal, single-user, private network only. Never expose it publicly without the login, and never share it. |

---

## 2. Architecture

```
 Phone (Safari / Chrome)
   │  HTTPS, via Tailscale (https://encore.<tailnet>.ts.net)
   ▼
 ┌──────────────────────── Docker host (Proxmox LXC) ─────────────────────────┐
 │  tailscale (sidecar) ── terminates HTTPS, proxies to 127.0.0.1:3000        │
 │  encore (one container, shares tailscale's network namespace)              │
 │    Fastify (Node 24, TypeScript)                                           │
 │     ├─ serves the built React SPA (PWA)                                    │
 │     ├─ /api/*  JSON API (auth, search, channel, feed, library)             │
 │     ├─ /api/stream/*  Range-capable media proxy  ◄── the important bit     │
 │     ├─ youtubei.js  → search / channel / playlist / music / up-next        │
 │     ├─ yt-dlp (+ Deno + yt-dlp-ejs)  → resolves real stream URLs           │
 │     └─ SQLite (better-sqlite3) + audio disk cache in /data                 │
 │  bgutil (sidecar) ── PO-token provider for yt-dlp (port 4416)              │
 └────────────────────────────────────────────────────────────────────────────┘
```

### Key decisions (don't revisit without a reason)

- **Build our own instead of deploying Invidious or Piped.** Those projects have no reliable server-side Shorts removal, their players aren't designed for iOS background audio, and they're heavier (Postgres plus several services). We only need a thin slice of YouTube.
- **yt-dlp is the only thing that resolves stream URLs.** It's the most actively maintained extractor. Since yt-dlp 2025.11 it needs an external JS runtime (**Deno**) and the **yt-dlp-ejs** package to solve YouTube's JS challenges. Install it with `pip install "yt-dlp[default]"`, which pulls in yt-dlp-ejs, and put a `deno` binary on PATH.
- **youtubei.js is only for metadata** (search, browse, YouTube Music, up-next). It's fast and returns typed nodes, which makes Shorts easy to drop. It never deciphers streams (create it with `retrieve_player: false`).
- **Every stream goes through our server.** googlevideo URLs are bound to the IP that resolved them, so the phone can't use them directly. The proxy has to support HTTP Range correctly (iOS will not play media without it).
- **Audio is AAC/M4A, video is H.264 MP4.** These are the formats every iOS version plays. Don't serve WebM/Opus/VP9 to the phone.
- **Single user, password login, private network.** No Google OAuth.

---

## 3. Tech stack and repo layout

| Layer | Choice |
|---|---|
| Server | Node 24 LTS, TypeScript, Fastify 5, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `zod`, `better-sqlite3`, `youtubei.js` (latest major), `undici` (upstream fetch) |
| Extractor | `yt-dlp[default]` in a Python venv, Deno binary, `bgutil-ytdlp-pot-provider` plugin (pin it to the same version as the sidecar image) |
| Web | React 18, Vite, TypeScript, React Router, Zustand (player and queue store, persisted), Tailwind CSS, `vite-plugin-pwa` |
| Tests | Vitest (server and web units), Playwright (mobile-viewport smoke tests) |
| Deploy | Docker Compose: `encore` + `tailscale` + `bgutil` |

```
apps/encore/
  PLAN.md                    ← this file
  README.md                  ← short: what it is, how to deploy (written in Phase 7)
  docker-compose.yml
  Dockerfile                 ← multi-stage: build web, build server, runtime
  .env.example
  tailscale/serve.json
  server/
    package.json  tsconfig.json  vitest.config.ts
    src/
      index.ts               ← Fastify bootstrap, static SPA, route registration
      config.ts              ← env parsing with zod
      auth.ts                ← login, signed session cookie, guard hook
      db/
        index.ts             ← open DB, run migrations
        migrations/001_init.sql
      yt/
        types.ts             ← normalized types (VideoItem, ChannelItem, ...)
        innertube.ts         ← ADAPTER: all youtubei.js calls live here, nowhere else
        ytdlp.ts             ← ADAPTER: spawn yt-dlp, parse JSON, select formats
        resolver.ts          ← resolution cache, in-flight dedupe, re-resolve on 403
        shorts.ts            ← Shorts detection and filtering (section 7)
      stream/
        proxy.ts             ← Range proxy to googlevideo
        audioCache.ts        ← prefetch-to-disk + LRU eviction
      routes/
        auth.ts search.ts video.ts channel.ts playlist.ts music.ts
        feed.ts subscriptions.ts library.ts stream.ts health.ts
      jobs/
        feedPoller.ts        ← refresh subscription feed
        ytdlpUpdater.ts      ← daily `pip install -U "yt-dlp[default]"`
    test/
  web/
    package.json  vite.config.ts  index.html  tailwind.config.ts
    public/icons/            ← original icon (not YouTube's logo), 192/512/maskable/apple-touch
    src/
      main.tsx  App.tsx  api.ts
      player/
        engine.ts            ← owns the <audio> and <video> elements (section 5)
        mediaSession.ts
        store.ts             ← Zustand: queue, index, mode, repeat, shuffle, radio
      pages/  Login.tsx Home.tsx Search.tsx Channel.tsx Playlist.tsx Library.tsx Settings.tsx
      components/  BottomNav.tsx MiniPlayer.tsx PlayerSheet.tsx TrackRow.tsx
                   TrackMenu.tsx QueueList.tsx SeekBar.tsx
```

Branding: the app is called **Encore** and has its own icon. Don't use YouTube's name, logo, or red play-button style anywhere in the UI.

---

## 4. Server: the API

Every route except `POST /api/auth/login` and `GET /api/health` requires a valid session (Fastify `onRequest` hook → 401).

### Normalized types (`server/src/yt/types.ts`)

```ts
export type VideoItem = {
  id: string;               // 11-char video id
  title: string;
  channelId?: string;
  channelName?: string;
  durationSec?: number;
  publishedAt?: number;     // epoch ms, when known
  publishedText?: string;   // "2 days ago" when that's all we have
  views?: string;
  thumbnail: string;        // https://i.ytimg.com/vi/<id>/mqdefault.jpg for lists
  artwork?: string;         // square art for songs (YT Music), else hqdefault
  kind: 'video' | 'song';
};
export type ChannelItem  = { id: string; name: string; avatar?: string; subscribers?: string };
export type PlaylistItem = { id: string; title: string; thumbnail?: string; count?: number; owner?: string };
export type Page<T> = { items: T[]; next?: string };  // `next` = opaque continuation token
```

Only `innertube.ts` and `ytdlp.ts` import third-party YouTube libraries. Everything else uses the normalized types. When youtubei.js changes shape between majors, only `innertube.ts` changes. **Check the installed version's typings** for the exact method names. The intended calls are roughly `yt.search`, `getContinuation`, `yt.getChannel(...).getVideos()`, `yt.getPlaylist`, `yt.getBasicInfo`, `yt.getSearchSuggestions`, `yt.music.search(q, { type: 'song' })`, `yt.music.getUpNext`, and `yt.resolveURL`. If youtubei.js search breaks, the fallback is `yt-dlp "ytsearch25:<q>" --flat-playlist -J`.

### Endpoints

| Method and path | Purpose |
|---|---|
| `POST /api/auth/login` `{password}` | Sets the session cookie. Rate limit: 5/min/IP. |
| `POST /api/auth/logout`, `GET /api/auth/me` | |
| `GET /api/search?q=&type=songs\|videos\|channels\|playlists&next=` | `songs` uses YouTube Music search. All video results go through the Shorts filter. |
| `GET /api/suggest?q=` | Search suggestions |
| `GET /api/resolve?url=` | Accepts youtube.com/watch, youtu.be, music.youtube.com, playlist, and channel URLs. A `/shorts/` URL returns 422 "Shorts are disabled". |
| `GET /api/video/:id` | Metadata plus filtered related videos. Live/upcoming videos come back with `playable:false`. |
| `GET /api/channel/:id?tab=videos\|playlists&next=` | **Videos tab only.** Never the Shorts tab. |
| `GET /api/playlist/:id?next=` | Playlist items, filtered |
| `GET /api/music/upnext/:id` | Radio continuation for autoplay (YouTube Music up-next / automix) |
| `GET /api/feed?before=<epochMs>` | Subscription feed from the DB, newest first, 40 per page |
| `GET/POST/DELETE /api/subscriptions[/:channelId]` | |
| `POST /api/subscriptions/import` (multipart CSV) | Google Takeout `subscriptions.csv` (columns: Channel Id, Channel URL, Channel Title) |
| `GET/PUT/DELETE /api/library/saved[/:id]` | "Liked" songs and videos |
| `GET/POST/PATCH/DELETE /api/playlists[/:id]`, `/api/playlists/:id/items` | Local playlists (add, remove, reorder) |
| `GET/POST /api/history` | Last 500 plays |
| `GET /api/stream/:id/audio` | **Range-capable** audio (section 6) |
| `GET /api/stream/:id/video?h=360\|480\|720` | **Range-capable** video-only H.264 |
| `POST /api/prefetch/:id` | Warm the resolution cache and start the audio disk-cache download. Returns 202 right away. |
| `GET /api/health` | `{ ok, ytdlpVersion, denoVersion, potProvider: up/down, db: ok }` |

### Auth

- `.env`: `APP_PASSWORD`, `SESSION_SECRET` (32+ random bytes), `COOKIE_SECURE=true`.
- Compare passwords with `crypto.timingSafeEqual` on SHA-256 digests.
- Cookie `encore_session`: an HMAC-signed `{ iat, exp }`, 180-day expiry, `HttpOnly; Secure; SameSite=Lax; Path=/`. Same-origin `<audio>` and `<video>` requests send it automatically.
- On iOS, a Home-Screen web app has its own cookie jar separate from Safari, so the user logs in once in each.

### Database (`migrations/001_init.sql`)

```sql
CREATE TABLE subscriptions (channel_id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, added_at INTEGER NOT NULL);
CREATE TABLE feed_videos (video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL,
  published_at INTEGER, published_text TEXT, duration_sec INTEGER, thumbnail TEXT, first_seen_at INTEGER NOT NULL);
CREATE INDEX feed_videos_pub ON feed_videos(published_at DESC);
CREATE TABLE saved (video_id TEXT PRIMARY KEY, title TEXT, channel_id TEXT, channel_name TEXT,
  duration_sec INTEGER, thumbnail TEXT, kind TEXT, saved_at INTEGER NOT NULL);
CREATE TABLE playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE playlist_items (playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, video_id TEXT NOT NULL, title TEXT, channel_name TEXT, duration_sec INTEGER,
  thumbnail TEXT, PRIMARY KEY (playlist_id, position));
CREATE TABLE history (id INTEGER PRIMARY KEY, video_id TEXT NOT NULL, title TEXT, channel_name TEXT,
  thumbnail TEXT, duration_sec INTEGER, played_at INTEGER NOT NULL);
CREATE TABLE shorts_check (video_id TEXT PRIMARY KEY, is_short INTEGER NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE audio_cache (video_id TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER NOT NULL,
  mime TEXT NOT NULL, last_access INTEGER NOT NULL);
```

Use a tiny migration runner: a `schema_version` table plus numbered `.sql` files, applied at startup. Enable WAL mode.

---

## 5. Player engine (web/src/player/engine.ts): the core feature

This is the part that makes background playback work. Follow it exactly.

### Elements

- On app start, create **one** `<audio>` element and append it to `document.body` outside the React tree. Route changes must never unmount it, and nothing should ever create a second one. Set `preload="auto"` and `x-webkit-airplay="allow"`.
- Create **one** `<video muted playsinline webkit-playsinline>` element. The `PlayerSheet` component reparents it into its container when it's open. It never carries sound.
- **The audio element is the master clock. The video follows it.**

### Rules

1. **First play must happen inside the tap handler, synchronously.** Set `audio.src = '/api/stream/<id>/audio'` and call `audio.play()` before any `await`. Load metadata in parallel. On iOS, an `await` before `play()` loses the user gesture and play gets rejected.
2. **Track changes go through the same element.** On `ended`, compute the next track and do `audio.src = next; audio.play()` straight away in the handler, with no `await` first. JS is throttled in the background, but media events still fire.
3. **Don't use timers for anything that has to happen in the background.** No `setTimeout`/`setInterval` for advancing tracks, the sleep timer, or SponsorBlock. Drive everything from media events (`ended`, `timeupdate`, `play`, `pause`).
4. **Never use the Web Audio API (`AudioContext`) for playback.** It gets suspended in the background on iOS.
5. **Audio session (Safari 16.4+):** at startup run `if ('audioSession' in navigator) navigator.audioSession.type = 'playback'`. This keeps audio playing with the silent switch on and in the background.
6. **Prefetch:** when a track starts playing, `POST /api/prefetch/:id` for the next 2 queue items. If radio autoplay is on and fewer than 3 items are left, fetch more from `/api/music/upnext/:id` **now**, not at the end of the track.
7. **Errors:** on `error`, retry once with `?fresh=1` (the server re-resolves and skips its cache). If that fails, toast "Couldn't play <title>" and skip to the next track. If `waiting` lasts more than 15 s, do the same.
8. **Previous:** if `currentTime > 3`, seek to 0. Otherwise go to the previous item.
9. **Resume:** save `{queue, index, currentTime}` to localStorage every 5 s while visible and on `pagehide`. On load, restore it paused.
10. **No volume slider on iOS.** iOS ignores `audio.volume`.

### Video mode (Phase 6)

- Mode toggle in the player sheet: **Audio** (default) or **Video**. Remember the choice in localStorage.
- In Video mode: `video.src = '/api/stream/<id>/video?h=<pref>'`, muted.
  - Mirror `play`, `pause`, `seeking`, and `ratechange` from audio to video.
  - While the page is visible, re-sync on each `timeupdate` if `|video.currentTime - audio.currentTime| > 0.3`.
- On `visibilitychange` → hidden: `video.pause(); video.removeAttribute('src'); video.load()` to free the decoder and the bandwidth. Audio keeps going.
- On visible, if in Video mode: restore `src`, seek to `audio.currentTime`, and play.

### Media Session (mediaSession.ts)

- On every track change, set `navigator.mediaSession.metadata = new MediaMetadata({ title, artist: channelName, album: 'Encore', artwork: [...] })`.
  - Artwork: the YT Music square art for songs, otherwise `https://i.ytimg.com/vi/<id>/hqdefault.jpg` with `sizes: '480x360'`.
  - If lock-screen artwork doesn't show on iOS, serve it same-origin through `GET /api/thumb/:id`.
- Register handlers for `play`, `pause`, `stop`, `previoustrack`, `nexttrack`, and `seekto`.
- **Don't register `seekbackward` or `seekforward`.** On iOS they replace the next/previous buttons on the lock screen with ±10 s.
- Call `setPositionState({ duration, position, playbackRate })` on `loadedmetadata`, `play`, `pause`, `seeked`, and `ratechange`. Don't call it on every `timeupdate`.
- Set `playbackState` on `play` and `pause`.

---

## 6. Stream proxy (server/src/stream/*): the other hard part

### Resolution (`ytdlp.ts`, `resolver.ts`)

- Run `yt-dlp -J --no-playlist --no-warnings --extractor-args "youtubepot-bgutilhttp:base_url=${POT_PROVIDER_URL}" -- "https://www.youtube.com/watch?v=<id>"`. Spawn it with an argument array (never a shell string) and validate `id` against `^[A-Za-z0-9_-]{11}$` first.
- Pick formats in Node from `formats[]`, keeping only `protocol === 'https'`:
  - **Audio:** `vcodec === 'none'` and `acodec` starts with `mp4a`. Take the highest `abr` (usually itag 140).
  - **Video:** `acodec === 'none'` and `vcodec` starts with `avc1`. Take the highest `height` ≤ the requested `h`, falling back to the lowest available.
- Keep `url`, `http_headers`, `filesize ?? filesize_approx`, the mime type (`audio/mp4` or `video/mp4`), and the expiry (the `expire=` query param on the URL).
- Cache in memory: key `<id>:<audio|video:h>`, TTL `min(expire − 30 min, 5 h)`. Deduplicate concurrent resolutions with an in-flight `Map<string, Promise>`.
- Run at most **3** yt-dlp processes at once (simple semaphore). The server is an i5-6500T, and each resolution costs 1–4 s of CPU in Deno. Kill a resolution that runs past 30 s.
- If yt-dlp output contains "Sign in to confirm you're not a bot", log it clearly and surface it in `/api/health`. Section 9 has the fix.

### Range proxy (`proxy.ts`)

- Read the client's `Range` header. Parse `bytes=start-end` and `bytes=start-`; reject multi-range with 416.
- **Cap each upstream request at 10 MB** (end = min(requestedEnd, start + 10 MB − 1)). googlevideo throttles or refuses large unbounded ranges. Fetch with undici, sending the format's `http_headers` and `Range: bytes=start-end`.
- Reply `206` with `Content-Range: bytes start-end/total`, `Content-Length`, `Accept-Ranges: bytes`, `Content-Type`, and `Cache-Control: no-store`. A response shorter than the open range the client asked for is legal, and browsers request the rest.
- With no `Range` header (browsers rarely do this for media), reply `200` with the full `Content-Length` and stream the body by looping 10 MB upstream chunks.
- iOS starts with `Range: bytes=0-1`. That must return exactly 2 bytes with a correct total in `Content-Range`.
- **Abort the upstream fetch when the client disconnects** (`request.raw.on('close')` → `AbortController`). iOS opens and cancels a lot of range requests.
- If upstream returns 403 or 410: invalidate the cache entry, re-resolve once, and retry. If it fails again, return 502.

### Audio disk cache (`audioCache.ts`, Phase 6)

- `POST /api/prefetch/:id`: resolve audio, then download the whole file in 10 MB chunks to `/data/cache/audio/<id>.m4a.part`, rename it on completion, and insert a row in `audio_cache`.
- In `GET /api/stream/:id/audio`, if a cached file exists, serve it with `reply.sendFile` (which handles Range) and update `last_access`.
- Evict least-recently-used files when the total exceeds `CACHE_MAX_GB` (default 10).
- What this buys you: when a song ends with the phone locked, the next one starts from local disk immediately. That's the most fragile moment on iOS.

---

## 7. Shorts removal (server/src/yt/shorts.ts)

Apply these in order. **Every** endpoint that returns `VideoItem[]` must call `filterShorts(items)`. Write one unit test per rule.

1. **Node type:** in `innertube.ts`, keep only regular video nodes (`Video`, `CompactVideo`, and lockup views whose content type is video). Drop `ShortsLockupView`, `ReelItem`, `ReelShelf`, and any shelf titled "Shorts".
2. **URL:** drop anything whose endpoint or URL contains `/shorts/`.
3. **Ambiguous items** (duration ≤ 180 s, or unknown): `HEAD https://www.youtube.com/shorts/<id>` with `redirect: 'manual'`. A `200` means it's a Short; a `3xx` redirect to `/watch` means it's a normal video. Cache the answer forever in `shorts_check`. Limit to 4 concurrent checks with a 3 s timeout; on timeout, keep the item.
   - *Verify this behaves as described during implementation.* If it doesn't, fall back to: drop items ≤ 60 s that have a vertical thumbnail (the `oardefault` or `oar2` thumbnail exists).
4. **Channel pages** only ever request the **Videos** and **Playlists** tabs.
5. **Subscription feed** uses the channel's "long-form uploads" source (section 8), so Shorts never get in.
6. **`/api/resolve`** rejects `/shorts/` URLs with 422.
7. **UI:** there is no Shorts tab, shelf, or section anywhere.

YouTube Music `songs` search never returns Shorts, so it skips rule 3 to save the HEAD requests.

---

## 8. Subscription feed (jobs/feedPoller.ts)

- Runs at startup and then every `FEED_POLL_MINUTES` (default 60). Processes subscriptions with concurrency 2 and a random 0–2 s jitter between channels.
- **Primary source:** the long-form-only uploads feed, `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF<channelId without "UC">`. Swapping the `UC` prefix for `UULF` gives regular videos only (no Shorts, no live) with exact publish timestamps.
  - The prefix is undocumented, and YouTube's RSS endpoint has had **intermittent 404/500 outages** since late 2025. Treat any non-200 as "use the fallback".
- **Fallback:** `innertube.getChannelVideos(channelId)` (Videos tab, first page). It only gives relative times ("3 days ago"), so parse them into approximate `published_at` values. For ids we already have, keep the earliest `first_seen_at`.
- Upsert into `feed_videos`. Then fill in `duration_sec` for up to 20 rows that are missing it, using `getBasicInfo`.
- Prune `feed_videos` older than 90 days that aren't in `saved` or a playlist.

---

## 9. Configuration, Docker, and running in production

### `.env.example`

```dotenv
APP_PASSWORD=change-me
SESSION_SECRET=                # openssl rand -hex 32
COOKIE_SECURE=true
PORT=3000
DATA_DIR=/data
CACHE_MAX_GB=10
FEED_POLL_MINUTES=60
DEFAULT_VIDEO_HEIGHT=480
POT_PROVIDER_URL=http://bgutil:4416
YTDLP_COOKIES_FILE=            # optional, only if YouTube starts demanding sign-in (see below)
TS_AUTHKEY=                    # Tailscale auth key (reusable or ephemeral=false), tag:encore
```

### Dockerfile (outline)

```dockerfile
FROM node:24-bookworm-slim AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-bookworm-slim AS server
WORKDIR /src/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
# Pin a real, existing tag:
COPY --from=denoland/deno:bin-<pinned-2.x> /deno /usr/local/bin/deno
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir "yt-dlp[default]" "bgutil-ytdlp-pot-provider==<same version as sidecar>" \
 && chown -R node:node /opt/venv
ENV PATH=/opt/venv/bin:$PATH NODE_ENV=production
WORKDIR /app
COPY --from=server /src/server/dist ./dist
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/package.json ./
COPY --from=web /src/web/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","dist/index.js"]
```

`better-sqlite3` is native: build it in the `server` stage on the same base image as the runtime (as above).

### docker-compose.yml

```yaml
services:
  tailscale:
    image: tailscale/tailscale:stable
    hostname: encore
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}
      TS_STATE_DIR: /var/lib/tailscale
      TS_SERVE_CONFIG: /config/serve.json
      TS_USERSPACE: "true"          # no /dev/net/tun needed: works in an unprivileged LXC
    volumes:
      - ./tailscale/state:/var/lib/tailscale
      - ./tailscale/serve.json:/config/serve.json:ro
    restart: unless-stopped

  encore:
    build: .
    network_mode: service:tailscale # reachable only through the tailnet
    env_file: .env
    volumes:
      - ./data:/data
    depends_on: [tailscale, bgutil]
    restart: unless-stopped

  bgutil:
    image: brainicism/bgutil-ytdlp-pot-provider:<pinned, same version as the pip plugin>
    restart: unless-stopped
```

`tailscale/serve.json`:

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": { "${TS_CERT_DOMAIN}:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } }
}
```

### Keeping it working

- **Daily yt-dlp self-update** (`jobs/ytdlpUpdater.ts`): every 24 h and at startup, run `pip install -U "yt-dlp[default]"` with a 120 s timeout. Log the old and new versions and never crash if it fails. Don't auto-update the bgutil plugin; it's pinned to match the sidecar.
- **"Sign in to confirm you're not a bot":** a residential IP rarely sees this. If it happens, the user exports a `cookies.txt` from a **throwaway** Google account (never their main one) into `/data/cookies.txt` and sets `YTDLP_COOKIES_FILE`. The server then passes `--cookies <file>`.
- **Pi-hole:** some blocklists block `*.googlevideo.com`, which breaks every stream. Make sure `googlevideo.com`, `youtube.com`, `youtubei.googleapis.com`, `ytimg.com`, and `music.youtube.com` are allowed for the Docker host.
- **Logs:** structured pino logs. Log every resolution (id, ms, format chosen) and every upstream non-2xx response.

---

## 10. Build phases (in order, one commit or more per phase)

Each phase lists **acceptance checks**. Don't start the next phase until the current one's checks pass. Commit and push at the end of each phase.

### Phase 0: Scaffold, auth, Docker
- Repo layout from section 3, Fastify serving a placeholder SPA, `config.ts`, migrations, login and logout, the session guard, `/api/health`, Dockerfile, compose file, `.env.example`.
- ✅ `docker compose build` succeeds. With no cookie, `GET /api/search?q=x` returns 401. Login sets the cookie. `/api/health` reports the yt-dlp and Deno versions.

### Phase 1: Stream pipeline
- `ytdlp.ts`, `resolver.ts`, `proxy.ts`, and `GET /api/stream/:id/audio|video`.
- Unit tests: range parsing, format selection (use a saved `yt-dlp -J` fixture), and the 10 MB cap.
- ✅ `curl -s -D- -H 'Range: bytes=0-1' --cookie … /api/stream/dQw4w9WgXcQ/audio` returns `206`, `Content-Length: 2`, and a correct `Content-Range` total.
- ✅ The full file downloads and plays in desktop Chrome and desktop Safari, and seeking to 75% works.
- ✅ A second request inside the TTL doesn't spawn yt-dlp (it hits the cache).

### Phase 2: Search, video, channel, and the Shorts filter
- `innertube.ts` with normalized types, `shorts.ts` with the section 7 rules and a unit test per rule, and the search/suggest/resolve/video/channel/playlist/music routes.
- ✅ Searching "funny cats" (videos) returns no item that `HEAD /shorts/<id>` reports as a Short. Spot-check 20 results.
- ✅ The channel endpoint returns Videos-tab content only. `/api/resolve?url=https://youtube.com/shorts/<id>` returns 422.

### Phase 3: Mobile UI shell and the player engine (the main deliverable)
- Pages: Login, Search (segmented **Songs | Videos | Channels | Playlists**, default **Songs**; a paste-a-link box), Channel, Playlist, Settings.
- `engine.ts` + `mediaSession.ts` + `store.ts`, plus MiniPlayer (above the bottom nav) and a full-screen PlayerSheet (artwork, title, channel, seek bar, prev/play/next, shuffle, repeat, radio toggle, queue).
- TrackMenu (⋯): Play now, Play next, Add to queue, Save, Add to playlist, Go to channel.
- Mobile requirements:
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  - `env(safe-area-inset-*)` padding
  - `100dvh`, not `100vh`
  - touch targets ≥ 44 px
  - dark theme by default with a light theme via `prefers-color-scheme`, plus a `theme-color` meta
  - `overscroll-behavior: contain` on the sheet
  - swipe down to close the sheet
  - no hover-only controls
- ✅ Playwright at iPhone 15 and Pixel 7 viewports: log in, search, play (assert `audio.paused === false` with muted autoplay allowed in the test), next, and open and close the sheet.
- ✅ **Hand-off to a real phone.** Section 11's checklist items 1–6 are the release gate. The agent can't run them, so leave a clear note in the commit or PR asking the user to.

### Phase 4: PWA
- `vite-plugin-pwa` (generateSW).
  - Manifest: `name: "Encore"`, `display: "standalone"`, `background_color` and `theme_color`, 192/512/maskable icons, plus `apple-touch-icon` and `apple-mobile-web-app-capable` meta tags.
  - Precache the app shell. Use `navigateFallback: '/index.html'` with `navigateFallbackDenylist: [/^\/api\//]`.
  - Runtime cache `i.ytimg.com` thumbnails: CacheFirst, 7 days, 500 entries.
  - **The service worker must not handle `/api/stream/*` at all** (no route for it). A service worker in the path of media range requests breaks playback on iOS.
- Android only: a manifest `share_target` (GET, `url` and `text` params) → `/share?url=…`, which resolves the link and plays it. So "Share → Encore" works from other apps.
- ✅ Lighthouse PWA installability passes, and `/api/stream` requests show "from network" (not the service worker) in DevTools.

### Phase 5: Library, subscriptions, and feed
- Home = the subscription feed (infinite scroll), with a "Continue" card at the top for the resume state.
- Library = Saved, Playlists (create, rename, delete, add, remove, reorder with up/down buttons), History, and Subscriptions (list, unsubscribe, **Import from Google Takeout CSV**, with instructions shown inline: takeout.google.com → "YouTube and YouTube Music" → subscriptions).
- Subscribe and unsubscribe buttons on channel pages. The feed poller from section 8.
- ✅ Importing a sample Takeout CSV fills the feed within one poll. The feed contains no Shorts. Library data survives a container restart.

### Phase 6: Video mode, radio, and the prefetch cache
- Muted synced video (section 5) with a quality setting of 360/480/720.
- Radio autoplay from `/api/music/upnext`.
- Prefetch + audio disk cache with LRU (section 6).
- ✅ In Video mode, after 10 minutes of playback and a few seeks, drift stays under 0.3 s while visible. A prefetched track starts in under 1 s (it's served from disk).

### Phase 7: Production hardening and the deploy README
- yt-dlp updater, a richer `/api/health`, pino logs, error toasts, empty states, and `apps/encore/README.md` with section 12's deploy steps.
- ✅ `docker compose up -d` from a clean clone works with only `.env` filled in.

### Phase 8 (optional, only if asked)
- **SponsorBlock:** `GET https://sponsor.ajay.app/api/skipSegments?videoID=<id>&categories=["sponsor","selfpromo","music_offtopic"]`, fetched when the track starts. Skip on `timeupdate`. `music_offtopic` is the useful one for music videos: it skips non-music intros and outros. Add a toggle in Settings.
- **Sleep timer** driven by `timeupdate`: stop at a wall-clock deadline or at the end of the current track.
- **Image to GHCR:** a GitHub Actions workflow that builds the image weekly and on push, so yt-dlp is fresh and Portainer can pull without building.
- **Android native wrapper** (Capacitor + a media-session foreground-service plugin) if surviving "swipe away from recents" ever matters.

### Rules for the implementing agent
- Don't add anything that shows Shorts. Don't add a "recommended for you" algorithm feed. Home is subscriptions.
- Don't play audio through anything except the single persistent `<audio>` element.
- Don't import youtubei.js or call yt-dlp outside the two adapter files.
- Don't commit `.env`, `data/`, `tailscale/state/`, or cookies. Add them to `.gitignore`.
- Don't use YouTube's logo or name in the UI.
- Pin every Docker image tag and the bgutil plugin version. Check the latest releases at build time rather than trusting versions remembered from training.
- If a library API named here doesn't exist in the installed version, adapt inside the adapter and leave a comment. Don't change the architecture.

---

## 11. Real-device test checklist (the user runs this)

Run on the actual phone after Phase 3, and again after Phase 6.

| # | Test | iPhone Safari tab | iPhone Home-Screen app | Android Chrome | Android installed app |
|---|---|---|---|---|---|
| 1 | Play a song, lock the screen: keeps playing for 30+ min | | | | |
| 2 | Lock-screen or notification shows title, channel, and art; play/pause/next/prev work | | | | |
| 3 | A song ends while locked: the next one starts by itself (let 8+ tracks run) | | | | |
| 4 | Switch to another app: keeps playing | | | | |
| 5 | (iPhone) Silent switch ON: still audible | | | n/a | n/a |
| 6 | AirPods or Bluetooth buttons: play/pause/next work | | | | |
| 7 | Video mode, lock the screen: audio continues; unlock: the video catches up | | | | |
| 8 | Phone call or Siri interruption: can resume from the lock screen | | | | |
| 9 | Searching "music video" and a few channels: no Shorts anywhere | | | | |
| 10 | Pasting a `/shorts/` link: refused | | | | |

Whichever column passes rows 1–4 is how you use Encore day to day. On iPhone, expect it to be the **Safari tab**.

---

## 12. Deploy guide (for the user, on this homelab)

The homelab is Proxmox on a ThinkCentre M910q, with Docker/Portainer already running in a container.

1. **Docker host:** use the existing Docker LXC, or create a Debian 12 LXC (2 vCPU, 2 GB RAM, 20 GB disk, `nesting=1`) and install Docker. Tailscale userspace mode means no `/dev/net/tun` passthrough is needed.
2. **Tailscale:** create a free account. In the admin console, enable **MagicDNS** and **HTTPS certificates** (DNS page). Create an auth key (Settings → Keys) and install the Tailscale app on your phone, signed into the same account. On iPhone, turn on "VPN On Demand" so it's always connected.
3. **On the Docker host:**
   ```bash
   git clone https://github.com/willirey/homelab.git && cd homelab/apps/encore
   cp .env.example .env && nano .env          # set APP_PASSWORD, SESSION_SECRET, TS_AUTHKEY
   docker compose up -d --build
   docker compose logs -f encore              # wait for "listening on 3000"
   ```
4. **On the phone:** open `https://encore.<your-tailnet>.ts.net` and log in.
   - **iPhone:** use it in Safari. Optionally also try Share → Add to Home Screen and run the section 11 checklist on both.
   - **Android:** in Chrome, ⋮ → Install app.
5. **Import subscriptions:** takeout.google.com → deselect all → **YouTube and YouTube Music** → only "subscriptions" → export. Then in Encore go to Library → Subscriptions → Import CSV.
6. **Updating:** `git pull && docker compose up -d --build`. yt-dlp also updates itself daily.
7. **Backups:** the only state is `apps/encore/data/` (SQLite and the audio cache). Your Proxmox backup of the LXC covers it.

Portainer: if you'd rather deploy from Portainer, use Stacks → Add stack → Repository (this repo, compose path `apps/encore/docker-compose.yml`). Relative bind mounts may need Portainer Business, so the SSH method above is the default.
