# Is It Down?

Live status, speed and outage history of the IIIT Hyderabad LAN and Wi-Fi: https://arihant25.github.io/is-it-down/

## What gets measured

Two monitors take the measurements, one per network:

- **LAN**: a Raspberry Pi in Bakul Nivas, plugged into the wired LAN.
- **Wi-Fi**: a test machine whose only connection is `wifi@iiith`, through a 2.4 GHz USB adapter. Its speed reflects that one link, so it shows when campus Wi-Fi is down or slow, not the best speed Wi-Fi can deliver.

Each monitor measures the same things:

- **Up or down**: checked every minute. A network counts as up if the monitor can ping 1.1.1.1 or 8.8.8.8, or reach https://github.com. If all three fail, it counts as down.
- **Ping**: the average round-trip time to 1.1.1.1, measured with every one-minute check. The ping tile shows 15-minute averages over the last 24 hours.
- **Speed**: an [Ookla speedtest](https://www.speedtest.net/apps/cli) every 3 hours, at a random time in each 3-hour window so every hour of the day gets tests. It uses whichever server Ookla picks. Download and upload show the last 7 days of tests; "Speed through the day" averages every test by hour.
- **Monitor offline**: gaps where the monitor itself was off, from a power cut, reboot or the machine being switched off. They're recorded separately and left out of the uptime figures.

## How it works

Every 5 minutes each monitor force-pushes `status.json`, `outages.json` and `speed.json` as a single commit to its own branch: `data` for the LAN, `data-wifi` for Wi-Fi. The page reads those files from raw.githubusercontent.com, so the data never builds up git history and never triggers a Pages build.

If no update arrives from a monitor for 20 minutes, the page shows that network as probably down. When the network comes back, the monitor uploads the exact times of the outage.

The Pi also looks after itself: it reconnects the wired LAN if 802.1X authentication gives up, restarts its Wi-Fi hotspot if it fails, and repairs its clock if time sync gets stuck after a reboot.

## Setup

Both monitors run `pi/bakul_lan.py`. After installing, add the printed deploy key to the repo with write access.

- **LAN (the Pi)**: `sudo sh install.sh` from inside `pi/`. It runs as root from systemd timers.
- **Wi-Fi (any Linux machine on campus Wi-Fi)**: `sh install-wifi.sh` from inside `pi/`, as a normal user. It runs from that user's crontab and needs no root.
