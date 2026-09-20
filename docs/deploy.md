# Putting the site online (Cloudflare Pages)

Written for the owner, step by step. Nothing here asks you to type a password into a
script: every login happens on the Cloudflare or GitHub website, in your browser.

Cloudflare Pages is free for this use (unlimited visits and bandwidth on the free plan,
500 builds a month, commercial use allowed). It builds the site from the GitHub repository
every time `master` changes, and it serves the `_headers` file the build writes (caching,
security, the closed-beta switch).

## What you need before starting

- The GitHub account that owns `github.com/pallii5811/project-flow`.
- A Cloudflare account (free). If you do not have one: <https://dash.cloudflare.com/sign-up>.
- Ten minutes. No domain yet: the site starts on a free `….pages.dev` address.

## 1. Create the project

1. Open <https://dash.cloudflare.com> and log in.
2. In the menu on the left: **Workers & Pages** → **Create** → the **Pages** tab →
   **Connect to Git**.
3. Choose **GitHub** → **Connect GitHub**. GitHub asks which repositories Cloudflare may
   read: pick **Only select repositories** → `project-flow` → **Install & Authorize**.
4. Back on Cloudflare, select `project-flow` → **Begin setup**.

## 2. Build settings (copy them exactly)

| Field                    | Value                  |
| ------------------------ | ---------------------- |
| Project name             | `cliffies` (see below) |
| Production branch        | `master`               |
| Framework preset         | **None**               |
| Build command            | `npm run export:web`   |
| Build output directory   | `apps/web/out`         |
| Root directory (advanced) | leave empty           |

The project name becomes the free address: `cliffies` gives `https://cliffies.pages.dev`.
If Cloudflare says the name is taken, pick another one and use **that** address in the
next step.

## 3. Environment variables

Still on the same page, open **Environment variables (advanced)** and add, one per row:

| Variable name              | Value                          | Why                                                                                       |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`     | `https://cliffies.pages.dev`   | The address every shared link and preview card points at. Exactly the address from step 2, `https://`, no `/` at the end |
| `FLOW_ALLOW_NO_ANALYTICS`  | `1`                            | There is no event collector yet (batch 6). Remove this row the day one exists, and add `NEXT_PUBLIC_ANALYTICS_ENDPOINT` instead |
| `NODE_VERSION`             | `22`                           | The Node.js version the build uses, same as the repository's CI                            |

Do **not** add `FLOW_PUBLIC`. Without it the site is a **closed beta**: every page and
every file says `noindex` (in the page and in the `X-Robots-Tag` header), and there is no
sitemap. `robots.txt` lets crawlers in on purpose: a search engine only obeys a `noindex`
it has read, and one kept out by `robots.txt` could still list a link a tester shared in
public, as a bare address. Anyone with a link can still watch and share (a link preview
still shows its picture and title); only search results stay empty.

Then **Save and Deploy**. The first build takes a few minutes. It runs the same checks as on
this computer (`scripts/deploy-checks.mjs`): if one fails, the build stops with a line that
starts with `deploy-checks:` and **nothing is published** — the previous version stays
online.

## 4. Check the first deploy

Open each of these on your phone or computer (replace the address if yours is different):

1. `https://cliffies.pages.dev` — the first episode starts playing by itself, muted.
   Swipe up: the next one plays.
2. `https://cliffies.pages.dev/robots.txt` — the last two lines are `User-agent: *` and
   `Allow: /`, and there is no `Sitemap:` line. That is the closed beta (the `noindex` of
   point 7 is what keeps it out of search).
3. `https://cliffies.pages.dev/sitemap.xml` — it must **not** exist (a "Page not found"
   page). A sitemap is only for a public launch.
4. `https://cliffies.pages.dev/some-page-that-does-not-exist` — the Cliffies "This link has
   moved or expired." page with a story to tap.
5. On an Android phone with Chrome, watch two episodes to the end and stay a minute: a card
   at the top offers to install Cliffies. It appears once, ever. On an iPhone with Safari
   the card explains Share → "Add to Home Screen" instead.
6. Share an episode to yourself on WhatsApp or Telegram: the preview shows the episode's
   picture, "Signal Night · Ep. N…" and the Cliffies name. (Crawlers cache previews, so a
   first test can take a minute.)
7. Headers, on a computer with Chrome: open the site, press F12, choose **Network**, reload,
   click the first row (the page), and look under **Response Headers** for
   `content-security-policy`, `x-robots-tag: noindex, nofollow` and
   `cache-control: public, max-age=0, must-revalidate`. Then type `_next/static` in the
   **Filter** box, click any row that ends in `.js`, and look for
   `cache-control: public, max-age=31536000, immutable` (a year). If it says
   `max-age=0, must-revalidate` instead, every visit downloads the app again: write it down.

If a check fails, do not change settings at random: write down which one and what you saw.

## 5. Switches you may need later

Each switch is an environment variable. After changing one: **Deployments** → the latest
production deployment → **⋯** → **Retry deployment**. A variable only takes effect on a new
build.

| To …                                   | Set                                        | What happens                                                                                     |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| open the site to search engines        | `FLOW_PUBLIC` = `1`                        | Pages and files lose `noindex`, and `robots.txt` names `sitemap.xml`, which lists every episode page. Only the exact value `1` does it; delete the variable to close the site again |
| turn the offline service worker off    | `FLOW_SERVICE_WORKER` = `off`              | The next deploy ships a worker whose only job is to remove itself and its caches from every phone that had it. Delete the variable to bring it back |
| serve video from a media store         | `MEDIA_BASE_URL` = `https://media.…`       | The security policy allows video, posters, subtitles and playlists from that host, and the build refuses a catalog whose media is anywhere else. Setting it here does not move any file: what puts media there is the ingest workflow (docs/cloud-ingest.md) |
| measure (when the collector exists)    | `NEXT_PUBLIC_ANALYTICS_ENDPOINT` = `https://…`, and delete `FLOW_ALLOW_NO_ANALYTICS` | Events go to the collector; the security policy allows exactly that host |

## 6. Your own domain (when you buy it)

1. Pages project → **Custom domains** → **Set up a custom domain** → type the domain
   (for example `cliffies.app`). If the domain was bought on Cloudflare it is connected
   automatically; otherwise Cloudflare shows the one record to add where you bought it.
2. **Settings** → **Environment variables** → change `NEXT_PUBLIC_SITE_URL` to the new
   address, for example `https://cliffies.app` (https, no `/` at the end).
3. **Retry deployment** (section 5). From then on every share, preview card and canonical
   address points at the new domain, even when someone watches on the old `pages.dev`
   address.

## What only the owner can decide or do

- Create the Cloudflare account and connect GitHub (sections 1–3).
- Say when the beta opens to search engines (`FLOW_PUBLIC=1`).
- Buy the domain and point it (section 6).
- Change the product's name: it lives in one line, `apps/web/src/lib/brand.ts`
  (`BRAND_NAME`). A test proves that line reaches every title, preview, the installed
  app's name, the 404 and offline pages and share texts; the app icon has no letters, so
  it does not change.

## For whoever maintains this

- `npm run build:web` and `npm run export:web` end with `scripts/finish-export.mjs`, which
  writes `_headers`, `robots.txt`, `sitemap.xml` (public only), `sw.js`, the offline shell
  and a per-page script policy. The rules live in `scripts/lib/platform.mjs`; the export
  check in `scripts/lib/platform-checks.mjs` refuses an export whose headers, indexing,
  manifest, icons, service worker or brand are wrong.
- `npm run serve:web` serves `apps/web/out` with the headers Pages would send
  (`scripts/serve-static.mjs` reads `_headers` with the same parser), so `npm run e2e:web`
  proves caching, the security policy (zero violations) and the offline page the way Pages
  serves them. The parser reads the file the way Pages does: Pages keeps **one rule per
  URL pattern**, the last one written (workers-sdk, `constructHeaders` in
  `workers-shared/utils/configuration/constructConfiguration.ts`), so a pattern written
  twice loses its first rule on Pages. The export check refuses a file that does it, and
  `scripts/lib/platform.mjs` writes each pattern once. Pages' own behaviour (Brotli, HTTP/3, the `.html` redirect) is not
  reproduced locally.
- Cloudflare Pages limits one deploy to 20,000 files and 25 MiB per file; the export check
  refuses more. Video outgrows that at about 100 episodes, which is why a series published
  through the ingest workflow keeps its media on R2 and only its manifest in the build
  (`docs/cloud-ingest.md`). The stand-in pack still ships inside the export.
