# Clips — the daily half hour that brings people in

Cliffies has no advertising budget, and it is not going to get one. Every app in
this format grew the same way: somebody posted short vertical clips every single
day, on four platforms, each one ending on a link to a free episode. Fifteen to
forty a day, for months. That is the whole channel.

This is the machine that makes them. It finds the moments, cuts them, burns the
subtitles in, writes what goes under each one, builds the link that tells you
where a viewer came from, and remembers what it already made so tomorrow is new.
It does not post. Pressing Post is yours, and it is the only part that is.

---

## 1. The one rule that comes before everything

**A clip may only be made from a series whose licence says clips may be posted.**

In `content/series/<slug>/series.json`:

```json
"socialClipsAllowed": true,
"socialClipsPermission": {
  "grantedOn": "2026-09-24",
  "source": "email from the studio, 24 Sep 2026: 'you may post clips of up to 60 seconds'"
}
```

Both, or nothing is cut. `grantedOn` is the day they said yes; `source` is where
to find them saying it. Those two lines are what an argument gets settled with a
year from now, when nobody remembers the call.

Cutting a piece out of somebody's film and publishing it under our name on
TikTok is a use of their work. Guessing that it is fine is the one mistake in
this whole pipeline that cannot be fixed by running it again.

If a studio has not answered yet, leave `socialClipsAllowed` at `false`. The
command refuses by name and costs nothing:

```
make-clips: REFUSED moonlight-wife — no clip may be made from this series
  - [clips_not_allowed] the licence does not say clips may be posted: …
```

---

## 2. The daily routine

```bash
NEXT_PUBLIC_SITE_URL=https://cliffies.pages.dev npm run clips -- signal-night
```

That makes **ten clips** — one day's worth — and writes everything to
`clips/signal-night/`. In PowerShell the address is set on its own line first:

```powershell
$env:NEXT_PUBLIC_SITE_URL = "https://cliffies.pages.dev"
npm run clips -- signal-night
```

Useful variations:

| What you want | What to type |
| --- | --- |
| A whole week in one go | `npm run clips -- signal-night --days 7` |
| More or fewer a day | `npm run clips -- signal-night --per-day 15` |
| Only cliffhangers | `npm run clips -- signal-night --kind cliffhanger` |
| See what it would cut, cut nothing | `npm run clips -- signal-night --plan-only` |
| One platform only | `npm run clips -- signal-night --platforms tiktok` |

Then open **`clips/signal-night/da-pubblicare.md`**. That is the list. One block
per clip, with the file to upload, the words to paste, the link, and the day it
is meant for. Posting is reading and pasting.

Run it again tomorrow and it **continues**: the clips it already made are in
`clips/<slug>/clips.json`, it skips them, and the new ones are scheduled for the
next day. The output folder is the memory — so if you delete a series' folder,
you are asking for those clips again, which is exactly what you want after a
re-cut.

Nothing here needs a password, a token or an account. It reads files and writes
files.

---

## 3. What a clip is made of

Every clip is **1080×1920, H.264 and AAC, normalised to −14 LUFS** (the level
the platforms level everything to anyway), and is a moment plus a **1.5-second
end card** with the series title, "Free. No coins, no unlocks." and the site
address.

Three kinds of moment, and the machine says which one it used:

- **cliffhanger** — the last stretch before the episode resolves, stopped a beat
  early on purpose. For short drama this is the strongest unit there is: the
  whole episode exists to make you open the next one.
- **cold open** — the first seconds of episode 1. The only moment that explains
  the series to somebody who has never heard of it.
- **dialogue peak** — a stretch from inside an episode where people are talking,
  the sound moves and the picture cuts often.

Each one is scored, and the score is in `clips.json` and in
`da-pubblicare.md` with the numbers it came from: how much of the window is
speech, how far the loudness moves, how often the picture cuts, how far into the
episode it sits, how dense the dialogue is. When a clip does badly you can read
what the machine thought it had.

**Subtitles are burned in.** Most people watch these muted. The text sits on an
opaque plate, which is why it is readable over a white wall and a night street
alike, and the contrast is measured on the finished frames, not assumed.

**The hook line in the first seconds is never invented.** It is the first thing
somebody says inside the clip, or the episode's own hook from `series.json`.

---

## 4. What each platform wants

All four take the same file. That is not laziness — their specifications really
do coincide today, so one render serves them all and only the words change. The
cap is still kept per platform, so the day TikTok moves to 90 seconds or Reels
drops to 30, a clip is dropped from that platform by name instead of being
uploaded and rejected.

| Platform | Cap | Where the link goes |
| --- | --- | --- |
| TikTok | 60 s | in the caption |
| Instagram Reels | 60 s | **in your bio** — Instagram does not make a caption link clickable |
| Facebook Reels | 60 s | in the caption |
| YouTube Shorts | 60 s | in the description; the list also gives you a **title** |

For Instagram the description says "link in bio" instead of printing a link
nobody can tap. Put the day's link in the bio and change it when the day
changes, or use one link for the series.

Hashtags come from a maintained list per platform plus the series' own genres
and tropes (`GENRE_HASHTAGS` in `scripts/lib/clip-rules.mjs`). An unknown genre
adds no tag rather than a tag nobody searches. If a tag is doing nothing, delete
it from that list; if a tag is working, add it there so every future clip gets
it.

---

## 5. Reading the numbers

Every link carries three things:

```
https://cliffies.pages.dev/watch/signal-night/episode-3
  ?utm_source=tiktok        ← which platform
  &utm_medium=clip          ← it came from a clip, not a share
  &utm_campaign=clip-4f2a91c8   ← WHICH clip
  &t=16                     ← open the episode at this second
```

`clip-4f2a91c8` is the code printed above every block in
`da-pubblicare.md`. So in analytics you can go from "this campaign brought 40
people" straight back to the file, the episode, the seconds, and the score the
machine gave it.

Two honest limits:

- **`t` is dropped when the app would ignore it.** The player refuses a start
  inside the last two seconds of an episode, and a cliffhanger sometimes starts
  there. When that happens the link opens the episode at the beginning and the
  list says so under that clip. It is not a bug, and it is not silent.
- Nothing here measures views. The platforms count those; this counts arrivals.

---

## 6. When a clip does badly

In order, cheapest first:

1. **Look at it.** `clips/<slug>/frames/<code>-open.jpg`, `-mid.jpg`,
   `-endcard.jpg` are three frames of the finished file. Most bad clips are
   obvious in the first one.
2. **Read its score.** It is in the block in `da-pubblicare.md`. A cliffhanger
   that scored badly on speech density is a quiet moment; it was the best the
   episode had, which is worth knowing about the episode.
3. **Change the words, not the cut.** The description and the hashtags are the
   cheapest thing to vary. Post the same clip again in a fortnight with a
   different first line.
4. **Ask for a different kind.** `--kind coldOpen` posts premises instead of
   endings. If cliffhangers are not landing for a series, its endings may not be
   its strength.
5. **Change the weights.** `CLIP_WEIGHTS` in `scripts/lib/clip-rules.mjs` is six
   numbers with names. Raising `positionInEpisode` pushes the machine later into
   episodes; raising `speechDensity` makes it prefer talkier moments. Change one
   at a time, delete the series' folder, and run it again — the same series will
   give different moments, and you can compare.

What **not** to do: do not write a claim into a description because it sounds
better. Everything the machine writes comes from the series' own metadata or a
fixed sentence, on purpose. The moment a description says something that is not
true, every other description stops being worth trusting — including the ones
that were fine.

---

## 7. What this cannot do

Declared, because the next person will otherwise find out the hard way.

- **It cannot judge whether a moment is any good.** It measures speech, loudness,
  cuts and position. It has no idea whether the line is a good line, whether the
  acting lands, or whether the scene spoils the episode it is advertising. The
  scores rank moments against each other inside one episode; they do not say a
  clip is worth posting.
- **It cannot see a spoiler.** A cliffhanger cut a beat before the resolution is
  a rule about timing, not about story. If the resolution happens earlier than
  the end, the clip may give it away.
- **It cannot post.** Nothing here touches a platform. That is partly a choice
  and partly the rules: TikTok, Instagram and YouTube all restrict automated
  posting, and an API that allows it needs an approved app and an account with
  standing. If that is ever wanted it is a separate piece of work with a real
  risk of the accounts being limited — which is the whole channel, so it should
  not be risked to save twenty minutes.
- **The clips are not drawn with the app's own type.** Manrope and Syne are in
  the repository as `woff2`, which the FreeType inside ffmpeg cannot open, so the
  text is drawn with a grotesque from the machine — whichever of
  `Inter, Manrope, Segoe UI, Helvetica Neue, Arial, DejaVu Sans, Liberation Sans, Noto Sans`
  is there first. Which one it really got is read back from libass and recorded
  on every clip, so a clip never silently comes out in a serif. Putting a `.ttf`
  of Manrope in the repository would make clips identical on every machine; it
  is the one thing that would fix this.
- **Only the default subtitle track is used.** A clip is in the language of the
  episode's default captions, and `--platforms` does not yet vary by language.
- **No clip has been posted yet.** Everything above is measured on files. Nothing
  in it is a claim about what performs.

---

## 8. Proving it still works

```bash
npm run proof:clips
```

Builds four one-minute episodes whose every feature is placed on purpose — a
picture cut every four seconds, a line of dialogue every five, a still end card
for the last three — and then, through the real command:

- the cliffhanger of the clean episode must land on the exact millisecond the
  rules say, and the first frame of the rendered file must **be** the master's
  frame at the cut;
- the episode with black inside its cliffhanger, the one that goes silent, and
  the one whose line of dialogue runs through the cut must each be refused, by
  their own name;
- a series with no licence, one that claims a licence without recording it, and
  one with no subtitles must each be refused;
- and on every clip actually rendered: the burned-in text inside the area the
  platforms' own interface leaves free, its contrast over the real frames, the
  loudness read back, the duration under every cap.

It also prints what a clip costs in machine time, which is the number that says
whether ten a day is half a minute or half an hour.
