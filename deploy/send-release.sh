#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Expected a commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
for name in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS; do
  [[ -n "${!name:-}" ]] || { echo "Configure $name in the production environment before deploying."; exit 1; }
done
port=${DEPLOY_PORT:-22}
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || exit 1
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1 && 10#$port <= 65535)) || exit 1
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$work/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$work/known_hosts"
git archive --format=tar.gz --output="$work/$revision.tar.gz" "$revision"
options=(-F /dev/null -i "$work/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote="$DEPLOY_USER@$DEPLOY_HOST"
scp "${options[@]}" -P "$port" "$work/$revision.tar.gz" "$remote:/var/lib/planner-deploy/incoming/$revision.tar.gz"
ssh "${options[@]}" -p "$port" "$remote" "sudo -n /usr/local/sbin/planner-deploy $revision"
