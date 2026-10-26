#!/usr/bin/env bash
# Creates a disposable production-shaped fixture ONLY on an isolated GitHub runner.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && $EUID -eq 0 && $# -eq 5 ]] || { echo 'Run only in the isolated GitHub Actions deployment test'; exit 1; }
archive=$1
revision=$2
repository=$3
node_binary=$4
npm_binary=$5
[[ "$revision" =~ ^[0-9a-f]{40}$ && -x "$node_binary" && -f "$npm_binary" ]] || exit 1
[[ ! -e /opt/penguin-planner && ! -e /var/lib/planner-deploy ]] || { echo 'Refusing to overwrite an existing deployment'; exit 1; }
trap 'systemctl stop penguin-planner 2>/dev/null || true' EXIT
useradd --system --user-group --create-home planner
useradd --system --user-group --create-home planner-deploy
install -d -m 0750 -o root -g planner-deploy /var/lib/planner-deploy
install -d -m 0700 -o planner-deploy -g planner-deploy /var/lib/planner-deploy/incoming
# Reproduce the production boundary: planner cannot traverse the deploy user's state.
if runuser -u planner -- test -x /var/lib/planner-deploy; then
  echo 'Fixture does not reproduce restricted parent permissions'; exit 1
fi
install -d -m 0755 /opt/penguin-planner/server /usr/local/lib/planner-deploy
install -m 0755 "$repository/deploy/deploy-release.sh" /usr/local/sbin/planner-deploy
install -m 0644 "$repository/deploy/validate-release.py" /usr/local/lib/planner-deploy/validate-release.py
ln -sf "$node_binary" /usr/local/bin/node
ln -sf "$npm_binary" /usr/local/bin/npm
cat > /opt/penguin-planner/server/.env <<'ENV'
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=planner_ci_test
MYSQL_USER=root
MYSQL_PASSWORD=ci-only-password
COOKIE_SECURE=false
ENV
chmod 0600 /opt/penguin-planner/server/.env
chown -R planner:planner /opt/penguin-planner
configuration_before=$(sha256sum /opt/penguin-planner/server/.env)
printf '%s\n' '# CI backup job sentinel; deployment must preserve this file.' > /etc/cron.d/planner-ci-backup
cron_before=$(sha256sum /etc/cron.d/planner-ci-backup)
sed -e "s|^ExecStart=.*|ExecStart=$node_binary /opt/penguin-planner/server/server.js|" \
  -e '/^Wants=mysql.service$/d' -e 's/^After=.*/After=network.target/' \
  "$repository/deploy/penguin-planner.service" > /etc/systemd/system/penguin-planner.service
systemctl daemon-reload
install -m 0600 "$archive" "/var/lib/planner-deploy/incoming/$revision.tar.gz"
install -d -m 0700 /root/planner-private-cwd
# Also exercise invocation from a caller's home inaccessible to the app user.
(cd /root/planner-private-cwd && /usr/local/sbin/planner-deploy "$revision")
[[ "$(cat /var/lib/planner-deploy/current-commit)" == "$revision" ]]
[[ "$(sha256sum /opt/penguin-planner/server/.env)" == "$configuration_before" ]]
[[ "$(sha256sum /etc/cron.d/planner-ci-backup)" == "$cron_before" ]]
systemctl is-active --quiet penguin-planner
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
echo 'PASS: real unprivileged dependency installation, deployment, migration, startup and preserved configuration'
