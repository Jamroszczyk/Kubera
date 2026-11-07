#!/bin/sh
# One-off root install of the Pi robustness fixes (run with sudo). Refuses to overwrite existing files.
set -e
D=$(dirname "$0")
for p in /etc/NetworkManager/conf.d/midas-wifi-powersave.conf /usr/local/sbin/midas-netwatch.sh \
         /etc/systemd/system/midas-netwatch.service /etc/systemd/system/midas-netwatch.timer; do
  [ -e "$p" ] && { echo "exists, not touching: $p"; exit 1; }
done
install -m 644 "$D/midas-wifi-powersave.conf" /etc/NetworkManager/conf.d/
install -m 755 "$D/midas-netwatch.sh" /usr/local/sbin/
install -m 644 "$D/midas-netwatch.service" "$D/midas-netwatch.timer" /etc/systemd/system/
/sbin/iwconfig wlan0 power off
systemctl daemon-reload
systemctl enable --now midas-netwatch.timer
echo installed
