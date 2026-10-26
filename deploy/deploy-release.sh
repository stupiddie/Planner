#!/usr/bin/env bash
# Installed once, root-owned, at /usr/local/sbin/planner-deploy.
# This script never executes application or package code as root.
set -eEuo pipefail
export PATH=/usr/bin:/bin
[[ $EUID -eq 0 && $# -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || { echo 'Usage: sudo planner-deploy <commit SHA>'; exit 1; }
revision=$1
target=/opt/penguin-planner
state=/var/lib/planner-deploy
service=penguin-planner
[[ "$(realpath "$target")" == "$target" && -f "$target/server/.env" ]] || { echo 'Application path or configuration missing'; exit 1; }
app_user=$(systemctl show "$service" -p User --value)
[[ "$app_user" == planner ]] || { echo 'Expected service to run as the unprivileged planner user'; exit 1; }
exec 9>"$state/deploy.lock"
flock -w 600 9
work=$(mktemp -d "$state/work.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
backup="/var/backups/penguin-planner/code-$(date -u +%Y%m%dT%H%M%SZ)-$revision.tar.gz"
changed=false
rollback() {
  result=$?
  trap - ERR
  if [[ "$changed" == true ]]; then
    echo 'Deployment failed; restoring the previous application. Database tables are not rolled back.'
    systemctl stop "$service" || true
    if tar -xzf "$backup" -C "$target" && systemctl start "$service"; then
      echo 'Previous application restored; check service health and logs.'
    else
      echo "Automatic restore failed. Restore application backup: $backup"
    fi
  fi
  exit "$result"
}
trap rollback ERR
# Open the uploaded file without following links, then keep a private, stable copy.
python3 - "$state/incoming/$revision.tar.gz" "$work/release.tar.gz" <<'PY'
import os, shutil, sys
with os.fdopen(os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source, open(sys.argv[2], 'xb') as dest:
    shutil.copyfileobj(source, dest)
PY
mkdir "$work/source" "$work/npm-cache"
python3 /usr/local/lib/planner-deploy/validate-release.py "$work/release.tar.gz" "$work/source" "$revision"
chmod 0711 "$work"
chown -R planner:planner "$work/source" "$work/npm-cache"
runuser -u planner -- env "npm_config_cache=$work/npm-cache" npm ci --prefix "$work/source/server" --omit=dev --no-audit --no-fund
install -d -m 0700 /var/backups/penguin-planner
# Preserve source, installed dependencies and local files; the original .env stays in place.
tar --exclude='./.git' --exclude='./server/.env' -czf "$backup" -C "$target" .
chmod 0600 "$backup"
changed=true
systemctl stop "$service"
rsync -a --chown=planner:planner --exclude='.git/' --exclude='server/.env' "$work/source/" "$target/"
runuser -u planner -- node "$target/server/manage.js" migrate
systemctl start "$service"
ready=false
for _attempt in {1..30}; do
  if python3 - <<'PY'
import json, urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:3000/api/health', timeout=3) as response:
        health = json.load(response)
    assert health.get('ok') is True and health.get('database') is True
    with urllib.request.urlopen('http://127.0.0.1:3000/', timeout=3) as response:
        assert response.status == 200
except Exception:
    raise SystemExit(1)
PY
  then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
systemctl is-active --quiet "$service"
printf '%s\n' "$revision" > "$state/current-commit"
rm -f -- "$state/incoming/$revision.tar.gz"
echo "Deployed $revision successfully. Previous application backup: $backup"
