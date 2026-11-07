#!/bin/sh
# Push the trading app from this PC to the Pi and restart it. Research files and .env stay where they are.
#   sh deploy/pi/deploy.sh          deploy code
#   sh deploy/pi/deploy.sh pull     copy the Pi's ledger + tape back into research/pi/ for analysis
set -e
cd "$(dirname "$0")/../.."
if [ "$1" = "pull" ]; then
  mkdir -p research/pi
  ssh midas "cd ~/midas && tar -czf - research/qdesk.json research/live data/tape" | tar -xzf - -C research/pi
  echo "pulled into research/pi/"
  exit 0
fi
tar -czf - server.js alpaca.js index.html package.json css js screen | ssh midas "tar -xzf - -C ~/midas"
# stop our own node process; systemd (Restart=always) starts the new code within 10 s, no sudo needed
ssh midas "pkill -u midas -x node; sleep 15; systemctl is-active midas && curl -s localhost:3000/api/status"
