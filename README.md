# Is It Down?

Live status, speed and outage history of the IIIT Hyderabad LAN: https://arihant25.github.io/is-it-down/

A Raspberry Pi on the LAN (`pi/`) checks connectivity every minute, runs a speed test every 30 minutes, and every 5 minutes force-pushes `status.json`, `outages.json` and `speed.json` as a single commit to the `data` branch. The page reads those files from raw.githubusercontent.com, so the data never builds up git history and never triggers a Pages build. If no update arrives for 20 minutes, the page shows the LAN as probably down.

Setup on the Pi: `sudo sh pi/install.sh` (from inside `pi/`), then add `/var/lib/bakul-lan/deploy_key.pub` to the repo as a deploy key with write access.
