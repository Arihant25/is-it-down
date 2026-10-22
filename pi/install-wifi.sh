#!/bin/sh
# Installs the Wi-Fi monitor for the current user, from cron, with no root needed.
# Run from the directory containing bakul_lan.py on a machine whose traffic goes over campus Wi-Fi.
set -eu

STATE="$HOME/.local/share/bakul-lan"
BIN="$HOME/.local/bin"
mkdir -p "$STATE" "$BIN"
chmod 700 "$STATE"
install -m 755 bakul_lan.py "$STATE/bakul_lan.py"

# Ookla speedtest CLI
if [ ! -x "$BIN/speedtest" ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-$(uname -m).tgz" | tar -xz -C "$tmp"
  install -m 755 "$tmp/speedtest" "$BIN/speedtest"
  rm -rf "$tmp"
fi

# Deploy key (its public half must be added to the GitHub repo with write access)
[ -f "$STATE/deploy_key" ] || ssh-keygen -q -t ed25519 -N "" -C bakul-lan-wifi -f "$STATE/deploy_key"

# Wrapper for cron: sets the Wi-Fi monitor's settings and runs one copy of each command at a time.
cat > "$STATE/run.sh" <<EOF
#!/bin/sh
export BAKUL_MANAGED=0 BAKUL_NETWORK=wifi BAKUL_BRANCH=data-wifi BAKUL_STATE_DIR="$STATE"
export BAKUL_WORK_DIR="/dev/shm/bakul-lan-\$(id -u)/publish" PATH="$BIN:/usr/local/bin:/usr/bin:/bin"
case "\$1" in
  publish) sleep 30 ;;                         # stay clear of the probe at the top of the minute
  speed) sleep "\$(shuf -i 0-10500 -n 1)" ;;   # random time in each 3-hour window
esac
exec flock -n "/dev/shm/bakul-lan-\$(id -u)-\$1.lock" \\
  sh -c 'python3 "$STATE/bakul_lan.py" "\$0" 2>&1 | logger -t bakul-lan-wifi' "\$1"
EOF
chmod 755 "$STATE/run.sh"

# Cron entries, tagged so a re-run replaces them instead of adding duplicates
tag="# bakul-lan-wifi"
{
  crontab -l 2>/dev/null | grep -v "$tag\$" || true
  echo "* * * * * $STATE/run.sh probe $tag"
  echo "*/5 * * * * $STATE/run.sh publish $tag"
  echo "0 */3 * * * $STATE/run.sh speed $tag"
  echo "10 4 * * * $STATE/run.sh prune $tag"
} | crontab -

echo "Installed. Deploy key:"
cat "$STATE/deploy_key.pub"
