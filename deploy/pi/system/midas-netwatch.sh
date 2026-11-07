#!/bin/sh
# Midas network watchdog (run every 2 min by midas-netwatch.timer).
# Router unreachable 2x in a row: restart Wi-Fi. 5x (10 min): reboot, but only after 30 min uptime (no boot loops).
STATE=/run/midas-netwatch.fails
GW=$(ip route | awk '/^default/ {print $3; exit}')
if ping -c 3 -W 3 "${GW:-192.168.2.1}" >/dev/null 2>&1; then rm -f "$STATE"; exit 0; fi
n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STATE"
logger -t midas-netwatch "router ${GW:-192.168.2.1} unreachable ($n)"
up=$(cut -d. -f1 /proc/uptime)
if [ "$n" -ge 5 ] && [ "$up" -gt 1800 ]; then
  logger -t midas-netwatch "rebooting"; systemctl reboot
elif [ "$n" -ge 2 ]; then
  nmcli radio wifi off; sleep 3; nmcli radio wifi on
fi
