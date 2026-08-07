#!/bin/zsh
set -u

repo='/Users/lansordenanoria/minecraft_catalog_app/DownloadScriptWork'
source_dir='/Users/lansordenanoria/Downloads/SKIN SCRIPT/Upgrade'
cd "$repo" || exit 1

while true; do
  remaining=$(gh api rate_limit --jq '.resources.core.remaining' 2>/dev/null || echo 0)
  if (( remaining < 250 )); then
    reset=$(gh api rate_limit --jq '.resources.core.reset' 2>/dev/null || echo 0)
    now=$(date +%s)
    delay=$(( reset - now + 20 ))
    (( delay < 300 )) && delay=300
    echo "[$(date -u +%FT%TZ)] GitHub rate limit low ($remaining); waiting ${delay}s"
    sleep "$delay"
  fi

  echo "[$(date -u +%FT%TZ)] Starting/resuming Upgrade releases"
  GH_PROMPT_DISABLED=1 node scripts/publish_upgrade_releases.mjs "$source_dir" --publish
  publisher_exit=$?
  if (( publisher_exit == 0 )); then
    break
  fi
  echo "[$(date -u +%FT%TZ)] Publisher stopped with status $publisher_exit; retrying after rate-limit window"
done

git add Skins/Upgrade scripts/publish_upgrade_releases.mjs scripts/run_upgrade_publish_until_complete.sh
if ! git diff --cached --quiet; then
  git commit -m 'Publish upgrade skin release catalogs'
fi

until git push origin main; do
  echo "[$(date -u +%FT%TZ)] Push failed; retrying in 300s"
  sleep 300
done

echo "[$(date -u +%FT%TZ)] DONE"
