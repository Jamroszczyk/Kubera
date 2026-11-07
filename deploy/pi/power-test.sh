#!/bin/sh
# Power-supply test: under-voltage flags at idle, then 90 s full CPU load sampled every 5 s.
# get_throttled bits: 0x1 under-voltage now, 0x4 throttled now, 0x10000 under-voltage since boot, 0x40000 throttled since boot.
echo "idle:  $(vcgencmd get_throttled)  $(vcgencmd measure_volts core)  temp $(vcgencmd measure_temp)"
for i in 1 2 3 4; do timeout 90 sh -c 'while :; do :; done' & done
bad=0
for t in $(seq 5 5 90); do
  sleep 5; f=$(vcgencmd get_throttled | cut -d= -f2)
  [ $(( f & 0x1 )) -ne 0 ] && bad=$((bad + 1))
  echo "load ${t}s: throttled=$f  $(vcgencmd measure_temp)"
done
wait
f=$(vcgencmd get_throttled | cut -d= -f2)
echo "after: throttled=$f"
if [ $(( f & 0x10000 )) -eq 0 ]; then echo "RESULT: PASS - no under-voltage since boot"
else echo "RESULT: FAIL - under-voltage since boot (seen in $bad of 18 load samples)"; fi
