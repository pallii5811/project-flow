# Putting a studio's delivery online, from your phone

Written for the owner, step by step. Nothing here downloads video to your computer,
and nothing asks you to type a password into a script: the video goes from the
studio's link to a machine GitHub lends us, is cut and packaged there, and lands in
Cloudflare R2 storage. Only small files come back to you: a page of pictures to check,
and one text file that puts the series online.

Why it works this way: **a 90-minute delivery is 3 to 5 GB**. On your connection that is
a day and a data plan. On a GitHub runner it is two minutes, and it costs nothing.

## What you do once, before the first series

### 1. Create the R2 bucket (five minutes)

1. Open <https://dash.cloudflare.com> and log in.
2. Left menu: **R2 object storage** → **Create bucket**.
3. Name it `cliffies-media`. Location: **Automatic**. **Create bucket**.
   R2 is free up to 10 GB stored, and **sending video to viewers costs nothing, ever**
   (that is why we use it: per-GB delivery pricing would break the free product —
   `docs/business-model.md`).
4. Open the bucket → **Settings** → **Public access**. Either:
   - **Custom domain** (what to do as soon as you own a domain): add `media.yourdomain.com`.
     Cloudflare creates the record for you. This is the one to use in the long run: it is
     cached at the edge, so the same episode is never fetched twice from storage; or
   - **r2.dev subdomain** (fine to start): switch it on and copy the address Cloudflare
     shows, something like `https://pub-1234….r2.dev`. Cloudflare limits how fast this
     address may be read and does not cache it, so move to a custom domain before you
     invite many testers.

### 2. Let the site read the bucket from the browser (the CORS rule)

Still in the bucket: **Settings** → **CORS Policy** → **Add CORS policy** → the **JSON**
tab, paste this, **Save**:

```json
[
  {
    "AllowedOrigins": ["https://cliffies.pages.dev"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

Replace the address with your site's, and add your own domain to the list the day you
have one (`["https://cliffies.pages.dev", "https://cliffies.app"]`). Without this rule the
video player cannot read the playlists and **no subtitle ever appears**: the browser
refuses to read text from another address unless that address says it may.

### 3. Create the key that lets the workflow write (three minutes)

1. R2 → **Manage R2 API Tokens** → **Create API token**.
2. Permissions: **Object Read & Write**. Scope it to the `cliffies-media` bucket only.
   TTL: whatever you like; if it expires, the workflow will say so in one line.
3. Cloudflare shows, once: **Access Key ID**, **Secret Access Key**, and your
   **Account ID**. Copy all three now — the secret is never shown again.

### 4. Paste them into GitHub yourself (nobody else sees them)

GitHub → your repository → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**, one per row:

| Name                   | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| `R2_ACCOUNT_ID`        | the Account ID from Cloudflare (32 characters)                   |
| `R2_ACCESS_KEY_ID`     | the Access Key ID                                                |
| `R2_SECRET_ACCESS_KEY` | the Secret Access Key                                            |
| `R2_BUCKET`            | `cliffies-media`                                                 |
| `MEDIA_BASE_URL`       | the public address from step 1, https, **no `/` at the end**     |

### 5. Tell the site where the video lives

Cloudflare Pages → your project → **Settings** → **Environment variables** → add
`MEDIA_BASE_URL` with the **same** address, then **Deployments** → the latest one →
**⋯** → **Retry deployment**.

This is what lets the site's security policy allow video from that address. If you forget
it, the build refuses to publish (`deploy-checks: … MEDIA_BASE_URL is not set for this
build`) instead of putting a site online where nothing plays.

## For each new series

### A. Before the video: the series file and the subtitles

In the repository, `content/series/<slug>/`:

- `series.json` — the rights, the producer of record, and **one entry per episode**
  (title, hook, the master file name, its subtitles). `docs/content-operations.md` has
  every field.
- `captions/` — one subtitle file per episode and language.

Those two are small; they are committed the normal way (Claude does this with you).
The video never is.

**If the studio sent the whole series as one long file**, `series.json` must also carry
the studio's permission to cut it:

```json
"splitAllowed": true,
"splitPermission": {
  "grantedOn": "2026-09-19",
  "source": "email from Zhang at Yuehua, 19 Sep 2026, 'you may split the compilation into episodes'"
}
```

Cutting a film into episodes changes the work, so it needs the licence to say so.
Without those two fields the cut is refused, and nothing is published.

### B. One long file: look at the cuts before anything is published

1. GitHub (the website works on a phone) → **Actions** → **ingest from link** → **Run workflow**.
2. Fill in: **slug** (the folder name, e.g. `night-shift`), **links** (paste the studio's
   link), **mode**: `propose-cuts`. **Run workflow**.
3. About one minute per five minutes of video later, open the run → **Artifacts** →
   `cuts-<slug>.zip`. Inside:
   - `report.txt` — one line per cut: its time, and how sure the machine is;
   - `contact/cut-01.jpg`, … — for each cut, **the last frame of one episode next to the
     first frame of the next**, with times and frame numbers;
   - `<slug>.cuts.json` — the cuts themselves.
4. Look at every sheet marked **LOW** or **NONE** first, then the rest. On each one, the
   left picture must be an ending and the right picture a beginning.
   - **HIGH** — there was black, or a pause in the sound, exactly there.
   - **LOW** — a picture cut, which is what every shot change looks like too. Check it.
   - **NONE** — nothing to see (episodes blended into each other); the cut was placed by
     length only, and almost certainly needs moving.
5. Send the zip to Claude, or fix the numbers yourself: in `<slug>.cuts.json`, `frame` is
   what counts (`at` is only its label and must match). Then set `"confirmed": true` and
   commit the file as `content/series/<slug>/cuts.json`.

Nothing is published in this mode. It only looks.

### C. Publish

**Actions** → **ingest from link** → **Run workflow** → same slug, same link(s),
**mode**: `publish`.

What happens, in order: the file is downloaded; it is checked to be the one the cuts were
made for; each episode is cut, measured against the quality gate
(`docs/content-operations.md` §3), packaged, uploaded, and its local copy deleted; when
every episode is on the store, one small file is committed to `master`, and Cloudflare
Pages rebuilds the site. **The series is online when that build finishes.**

If the series is too long for one job (about six hours), the run says so and **starts
itself again** where it stopped. You do not have to do anything.

### D. Delivery of one file per episode

Same thing, without step B: no `cuts.json`, and the delivered files must be named the way
`series.json` names them (`"master": "masters/EP01.mp4"` ← a file called `EP01.mp4`). A
Dropbox **folder** link gives a zip, which is unpacked on the runner.

## When something fails

The run stops at the first thing that is wrong, and nothing half-published stays behind.
The message says what to do; the usual ones:

| What it says                                                      | What to do                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `needs a login, or it has expired`                                | The link is not a "anyone with the link" link. Ask for a new one                |
| `a Google Drive FOLDER cannot be downloaded without a login`      | Ask for one link per file, or a zip                                            |
| `another file than the one the cuts were made for`                | The studio replaced the file behind the link: run `propose-cuts` again          |
| `series.json does not say the studio allows cutting this file`    | Get the written OK, then fill `splitAllowed` / `splitPermission` (section A)     |
| `nobody confirmed these cuts`                                     | Check the contact sheets, then set `"confirmed": true`                          |
| `the R2 token … is wrong, expired, or not allowed to write`       | Make a new token (step 3) and paste it into the secrets (step 4)                |
| `[black_opening]`, `[silent_opening]`, `[not_vertical]` …         | The quality gate refused an episode: `docs/content-operations.md` §4 says what each one means |
| `not one episode fits a budget of … minutes`                      | The episodes are very long: tell Claude, the budget is one number in the workflow |
| `not enough disk`                                                 | The delivery is bigger than a runner can hold: ask for it in two parts           |

## What this costs

Nothing in money, and some **runner minutes**: a private repository gets 2,000 free
minutes a month. Every run prints, at the end of its page, how many it used and how many
minutes of video that buys — and that printed number is the one to trust.

The estimate before the first real delivery: measured on the machine this was built on,
with two cores, packaging one minute of 1080×1920 video costs about **3.5 minutes**. A
GitHub runner's two processors are two threads of a single, slower core, so expect it to
be slower still — somewhere around **5 to 10 hours for a 90-minute series**, which means
roughly **one 90-minute series a month** inside the free minutes, and more when the
episodes are fewer or shorter. That is why a long series is published over several runs
that continue each other. When the free minutes run out GitHub simply stops starting runs;
it does not bill you unless you set a spending limit yourself.

Cheaper, later: a 4-core machine of your own registered as a "self-hosted runner" has no
minute limit at all. That is a decision to take when the catalogue grows, not now.

## What only you can do

1. Create the Cloudflare R2 bucket, its CORS rule and its API token (steps 1–3).
2. Paste the five secrets into GitHub yourself (step 4) — Claude never sees them, and
   they never appear in a log: a half-configured setup is refused by name, never by value.
3. Add `MEDIA_BASE_URL` to Cloudflare Pages and redeploy (step 5).
4. Get the studio's written OK before any long file is cut into episodes (section A).
5. Run the workflow, look at the contact sheets, and say which cuts are wrong (section B).

## For whoever maintains this

- `scripts/fetch-delivery.mjs` (link → file), `scripts/split-compilation.mjs`
  (propose / split / provenance), `scripts/cloud-ingest.mjs` (the whole run, episode by
  episode, inside a time budget), `scripts/ingest-series.mjs` (unchanged for media in the
  export; uploads to R2 when the five variables are set), `scripts/check-ffmpeg.mjs`.
- Proofs: `npm run proof:split` (a compilation with known boundaries), `npm run
  proof:cloud` (a link, a fake store, the whole path twice), `npm run proof:gate`
  (the quality gate, plus the R2 cases). All three run in CI.
- Every object on the media store is named by its content — renditions in their revision
  folder, posters, cards and subtitles with their hash in the name — so nothing on the
  store ever changes, everything is cached for a year, and an upload is skipped when the
  object is already there. The only thing that changes is the manifest inside the site
  build, which switches a whole series at once.
- Old objects are never deleted, on purpose: a Pages build takes minutes to go live, and
  deleting what the live manifest still names would break playback for whoever is
  watching. Storage of a retired encode is a few cents a month; a sweep can come later.
- The signer is `scripts/lib/sigv4.mjs`, proven against AWS's own test vectors
  (`test/sigv4.test.ts`). There is no SDK: two verbs (HEAD, PUT) did not justify one.
