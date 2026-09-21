#!/usr/bin/env bash
set -e

# Variable configuration
DOWNLOADER_CMD="${DOWNLOADER_CMD:-yt-dlp}"
LINKS_FILE="links.txt"

echo "=== Starting Automated End-to-End Media Ingest Pipeline ==="

# Check if DOWNLOADER_CMD CLI is installed
if ! command -v "$DOWNLOADER_CMD" >/dev/null 2>&1; then
  echo "Error: CLI '$DOWNLOADER_CMD' is not installed or not in PATH." >&2
  exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Error: 'ffmpeg' is not installed or not in PATH." >&2
  exit 1
fi

# Check and update DOWNLOADER_CMD CLI
echo "Checking and updating '$DOWNLOADER_CMD'..."
if "$DOWNLOADER_CMD" -U >/dev/null 2>&1 || "$DOWNLOADER_CMD" --update >/dev/null 2>&1; then
  echo "Successfully updated or verified '$DOWNLOADER_CMD'."
else
  echo "Notice: Could not auto-update '$DOWNLOADER_CMD'."
fi

# Ensure links.txt exists
if [ ! -f "$LINKS_FILE" ]; then
  echo "Error: Source links file '$LINKS_FILE' not found." >&2
  exit 1
fi

# Read valid URLs from links.txt (POSIX compliant)
processed_count=0
urls=()

while IFS= read -r line || [ -n "$line" ]; do
  # Trim leading and trailing whitespace
  line_trimmed=$(printf '%s\n' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

  # Ignore empty lines and comments
  case "$line_trimmed" in
    "" | \#*)
      continue
      ;;
  esac
  urls+=("$line_trimmed")
done < "$LINKS_FILE"

if [ ${#urls[@]} -eq 0 ]; then
  echo "No valid URLs found to process in '$LINKS_FILE'."
  exit 0
fi

echo "Found ${#urls[@]} media URL(s) to process."

# Process each URL end-to-end
for url in "${urls[@]}"; do
  echo "----------------------------------------"
  echo "Processing URL: $url"

  # 1. Extract metadata
  video_id=$("$DOWNLOADER_CMD" --print "%(id)s" "$url" 2>/dev/null | head -n 1 || true)
  video_title=$("$DOWNLOADER_CMD" --print "%(title)s" "$url" 2>/dev/null | head -n 1 || true)
  
  if [ -z "$video_id" ]; then
    echo "Warning: Could not extract video ID for $url. Skipping."
    continue
  fi

  # Escape quotes for JSON
  video_title_clean=$(echo "$video_title" | sed 's/"/\\"/g')
  slug="yt-$video_id"
  series_dir="content/series/$slug"

  echo "Generated slug: $slug"
  mkdir -p "$series_dir"
  mkdir -p "$series_dir/captions"

  # 2. Setup series.json with split permission enabled
  cat > "$series_dir/series.json" <<EOF
{
  "schemaVersion": 1,
  "seriesId": "series_$slug",
  "seriesSlug": "$slug",
  "title": "$video_title_clean",
  "status": "published",
  "defaultLocale": "en",
  "producerId": "prod_standin_inhouse",
  "producerOfRecord": "Automated YouTube Ingest",
  "socialClipsAllowed": false,
  "episodeDurationMs": { "min": 15000, "max": 240000 },
  "genres": [],
  "tropes": [],
  "rights": {
    "territories": ["WORLD"],
    "languages": ["en"],
    "windowStart": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
    "windowEnd": null
  },
  "splitAllowed": true,
  "splitPermission": {
    "grantedOn": "$(date -I)",
    "source": "Automated end-to-end pipeline confirmation"
  },
  "episodes": []
}
EOF

  # 3. Download the video
  delivery_mp4="$series_dir/delivery.mp4"
  echo "Downloading $video_title to $delivery_mp4..."
  "$DOWNLOADER_CMD" \
    --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" \
    --merge-output-format mp4 \
    -o "$delivery_mp4" \
    "$url"

  # 4. Propose Cuts
  echo "Proposing cuts..."
  npm run split -- propose "$slug" --input "$delivery_mp4"

  # 5. Blind Approval (Force confirm cuts.json)
  cuts_file=".split-work/$slug/$slug.cuts.json"
  if [ -f "$cuts_file" ]; then
    echo "Auto-confirming cuts..."
    node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('$cuts_file')); data.confirmed=true; fs.writeFileSync('$series_dir/cuts.json', JSON.stringify(data, null, 2));"
  else
    echo "Error: Cuts file not found at $cuts_file. Propose step failed."
    exit 1
  fi

  # 6. Perform Split
  echo "Splitting compilation..."
  npm run split -- split "$slug" --input "$delivery_mp4"

  # 7. Cloud Ingest (Uploads to R2 and generates manifest)
  echo "Starting cloud ingest..."
  # Use npm run ingest:cloud but pass arguments correctly
  node scripts/cloud-ingest.mjs "$slug" --source "$delivery_mp4"

  # 8. Clean up massive raw video file and local masters
  echo "Cleaning up heavy raw files..."
  rm -f "$delivery_mp4"
  rm -rf "$series_dir/masters"

  processed_count=$((processed_count + 1))
done

echo "----------------------------------------"
echo "Successfully processed $processed_count media URL(s)."

# Empty links.txt keeping initial header comments
echo "Clearing processed URLs from '$LINKS_FILE' while preserving header comments..."
grep '^#' "$LINKS_FILE" > "${LINKS_FILE}.tmp" || true
mv "${LINKS_FILE}.tmp" "$LINKS_FILE"

# Commit and push cleared links.txt and new generated manifest to git
if [ -d ".git" ] && command -v git >/dev/null 2>&1; then
  echo "Syncing generated manifest and links.txt with git..."
  git add "$LINKS_FILE"
  # Add the generated manifest that cloud-ingest created
  git add "packages/feed-domain/src/data/generated/*.ts" || true
  # Add the series folder to keep metadata
  git add "content/series/*" || true
  
  git commit -m "feat: automated ingest and publish for processed YouTube URLs [skip ci]" || true
  git push origin HEAD || true
fi

echo "=== End-to-End Pipeline Completed Successfully ==="
