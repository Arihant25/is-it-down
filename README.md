# Is It Down?

Live status, speed and outage history of the IIIT Hyderabad LAN: https://arihant25.github.io/is-it-down/

## What gets measured

A Raspberry Pi in Bakul Nivas, plugged into the LAN, takes all the measurements.

- **Up or down**: checked every minute. The LAN counts as up if the Pi can ping 1.1.1.1 or 8.8.8.8, or reach https://github.com. If all three fail, it counts as down.
- **Ping**: the average round-trip time to 1.1.1.1, measured with every one-minute check. The ping tile shows 15-minute averages over the last 24 hours.
- **Speed**: an [Ookla speedtest](https://www.speedtest.net/apps/cli) every 3 hours. It uses whichever server Ookla picks, usually Powergrid Corporation of India Ltd in Bengaluru. Download and upload show the last 7 days of tests.
- **Monitor offline**: gaps where the Pi itself was off, from a power cut or reboot. They're recorded separately and left out of the uptime figures.

## How it works

Every 5 minutes the Pi (`pi/`) force-pushes `status.json`, `outages.json` and `speed.json` as a single commit to the `data` branch. The page reads those files from raw.githubusercontent.com, so the data never builds up git history and never triggers a Pages build.

If no update arrives for 20 minutes, the page shows the LAN as probably down. When the network comes back, the Pi uploads the exact times of the outage.

## Setup on the Pi

Run `sudo sh install.sh` from inside `pi/`. Then add `/var/lib/bakul-lan/deploy_key.pub` to the repo as a deploy key with write access.
