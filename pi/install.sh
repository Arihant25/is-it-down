#!/bin/sh
# Installs the Is It Down? agent on the Pi. Run with sudo from the directory containing bakul_lan.py.
set -eu

STATE=/var/lib/bakul-lan
install -d -m 700 "$STATE"
install -m 755 bakul_lan.py /usr/local/bin/bakul_lan.py

# Ookla speedtest CLI
if ! command -v speedtest >/dev/null; then
  tmp=$(mktemp -d)
  curl -fsSL https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-aarch64.tgz | tar -xz -C "$tmp"
  install -m 755 "$tmp/speedtest" /usr/local/bin/speedtest
  rm -rf "$tmp"
fi

# Deploy key (its public half must be added to the GitHub repo with write access)
[ -f "$STATE/deploy_key" ] || ssh-keygen -q -t ed25519 -N "" -C bakul-lan-pi -f "$STATE/deploy_key"

# Persistent, size-capped journal so hotspot failures survive a reboot
install -d /var/log/journal /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=50M\n' > /etc/systemd/journald.conf.d/bakul-lan.conf
systemctl restart systemd-journald

# Hotspot: Wi-Fi power save is a known cause of AP dropouts on the Pi 3B's BCM43430
nmcli -t -f NAME,TYPE con show | while IFS= read -r line; do
  name=${line%:*}
  [ "${line##*:}" = 802-11-wireless ] && [ "$(nmcli -g 802-11-wireless.mode con show "$name")" = ap ] &&
    nmcli con modify "$name" 802-11-wireless.powersave 2
done || true
/usr/sbin/iw dev wlan0 set power_save off || true

unit() { # name, calendar, timeout, randomized delay
  cat > "/etc/systemd/system/bakul-lan-$1.service" <<EOF
[Unit]
Description=Is It Down? $1
Wants=network-online.target time-sync.target
After=network-online.target time-sync.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/bin/bakul_lan.py $1
TimeoutStartSec=$3
RuntimeDirectory=bakul-lan
RuntimeDirectoryPreserve=yes
EOF
  cat > "/etc/systemd/system/bakul-lan-$1.timer" <<EOF
[Unit]
Description=Is It Down? $1 timer

[Timer]
OnCalendar=$2
AccuracySec=1s
RandomizedDelaySec=${4:-0}
Persistent=false

[Install]
WantedBy=timers.target
EOF
}
unit probe   '*:*:00'          55
unit speed   '00/3:00:00'      240  2h55min  # random time in each 3-hour window
unit publish '*:0/5:30'        120
unit prune   '*-*-* 04:10:00'  600

systemctl daemon-reload
systemctl enable systemd-time-wait-sync.service 2>/dev/null || true
systemctl enable --now bakul-lan-probe.timer bakul-lan-speed.timer bakul-lan-publish.timer bakul-lan-prune.timer
echo "Installed. Deploy key:"
cat "$STATE/deploy_key.pub"
