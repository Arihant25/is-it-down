#!/usr/bin/env python3
"""Is It Down? agent for the IIITH LAN monitor Pi.

Subcommands (each run by its own systemd timer):
  probe    every minute: check connectivity, record state, watch the hotspot
  speed    every 30 min: run an Ookla speedtest
  publish  every 5 min:  build JSON and force-push it as a single commit to the `data` branch
  prune    daily:        drop old raw probes
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request

STATE_DIR = "/var/lib/bakul-lan"
DB_PATH = f"{STATE_DIR}/db.sqlite"
DEPLOY_KEY = f"{STATE_DIR}/deploy_key"
WORK_DIR = "/run/bakul-lan/publish"  # tmpfs: no git history ever touches the SD card
REPO = "git@github.com:Arihant25/is-it-down.git"
BRANCH = "data"

PING_TARGETS = ["1.1.1.1", "8.8.8.8"]
HTTP_TARGET = "https://github.com"
OFFLINE_GAP = 180  # seconds without a probe => the Pi itself was offline
PROBE_RETENTION_DAYS = 30
RAW_SPEED_DAYS = 7

HOTSPOT_RESTART_COOLDOWN = 600


def log(msg):
    print(msg, flush=True)


def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS probes (ts INTEGER PRIMARY KEY, up INTEGER, latency_ms REAL, loss REAL);
        CREATE TABLE IF NOT EXISTS outages (
            id INTEGER PRIMARY KEY, kind TEXT, start INTEGER, end INTEGER);
        CREATE TABLE IF NOT EXISTS speeds (
            ts INTEGER PRIMARY KEY, down_mbps REAL, up_mbps REAL, ping_ms REAL, server TEXT);
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS hotspot_events (ts INTEGER, reason TEXT, action TEXT, ok INTEGER);
    """)
    return con


def meta_get(con, k, default=None):
    row = con.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return row[0] if row else default


def meta_set(con, k, v):
    con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, str(v)))


def run(cmd, timeout=30):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


# ---------- probe ----------

def ping(host):
    """Return (avg_latency_ms or None, loss fraction)."""
    r = run(["ping", "-n", "-q", "-c", "3", "-W", "2", host], timeout=15)
    if r is None:
        return None, 1.0
    loss = re.search(r"([\d.]+)% packet loss", r.stdout)
    rtt = re.search(r"= [\d.]+/([\d.]+)/", r.stdout)
    return (float(rtt.group(1)) if rtt else None), (float(loss.group(1)) / 100 if loss else 1.0)


def http_ok():
    try:
        req = urllib.request.Request(HTTP_TARGET, method="HEAD")
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status < 500
    except Exception:
        return False


def check_connectivity():
    latency, loss = None, 1.0
    up = False
    for i, host in enumerate(PING_TARGETS):
        lat, l = ping(host)
        if i == 0:
            latency, loss = lat, l
        if lat is not None:
            up = True
            break
    if not up:
        up = http_ok()
    return up, latency, loss


def cmd_probe():
    now = int(time.time())
    up, latency, loss = check_connectivity()
    con = db()
    with con:
        last = con.execute("SELECT ts, up FROM probes ORDER BY ts DESC LIMIT 1").fetchone()
        open_outage = con.execute(
            "SELECT id, kind FROM outages WHERE end IS NULL ORDER BY start DESC LIMIT 1").fetchone()

        # The Pi was off (power cut, reboot) and nothing was open: record a "no data" gap.
        if last and now - last[0] > OFFLINE_GAP and not open_outage:
            con.execute("INSERT INTO outages (kind, start, end) VALUES ('offline', ?, ?)", (last[0] + 60, now))

        if up and open_outage:
            con.execute("UPDATE outages SET end=? WHERE id=?", (now, open_outage[0]))
        elif not up and not open_outage:
            con.execute("INSERT INTO outages (kind, start) VALUES ('down', ?)", (now,))

        con.execute("INSERT OR REPLACE INTO probes VALUES (?,?,?,?)", (now, int(up), latency, loss))
    log(f"probe up={up} latency={latency} loss={loss}")
    try:
        hotspot_watchdog(con)
    except Exception as e:  # never let the watchdog break probing
        log(f"hotspot watchdog error: {e}")


# ---------- hotspot watchdog ----------

def hotspot_connection():
    """Name of the NetworkManager Wi-Fi connection configured as an access point, if any."""
    r = run(["nmcli", "-t", "-f", "NAME,TYPE", "con", "show"])
    for line in (r.stdout.splitlines() if r else []):
        name, _, typ = line.rpartition(":")
        name = name.replace("\\:", ":")
        if typ == "802-11-wireless":
            mode = run(["nmcli", "-g", "802-11-wireless.mode", "con", "show", name])
            if mode and mode.stdout.strip() == "ap":
                return name
    return None


def hotspot_problem(con, name):
    r = run(["nmcli", "-t", "-f", "GENERAL.STATE", "con", "show", name])
    if r is None or "activated" not in r.stdout:
        return "connection not active"
    r = run(["ip", "-4", "-o", "addr", "show", "wlan0"])
    if r is None or " inet " not in f" {r.stdout}":
        return "wlan0 lost its address"
    r = run(["/usr/sbin/iw", "dev", "wlan0", "info"])
    if r is not None and r.returncode == 0 and "type AP" not in r.stdout:
        return "wlan0 not in AP mode"
    since = meta_get(con, "kmsg_checked", str(int(time.time()) - 120))
    r = run(["journalctl", "-k", "-q", "--no-pager", "-o", "cat", "--since", f"@{since}"])
    meta_set(con, "kmsg_checked", int(time.time()))
    con.commit()
    if r is not None:
        bad = [l for l in r.stdout.splitlines()
               if "brcmf" in l and re.search(r"error|fail|timeout|firmware has halted", l, re.I)
               and "txcap_blob" not in l]
        if bad:
            return "driver error: " + bad[-1][:200]
    return None


def hotspot_watchdog(con):
    name = hotspot_connection()
    if not name:
        return
    problem = hotspot_problem(con, name)
    if not problem:
        return
    last = int(meta_get(con, "hotspot_restart", 0))
    if time.time() - last < HOTSPOT_RESTART_COOLDOWN:
        log(f"hotspot problem ({problem}), in cooldown")
        return
    log(f"hotspot problem: {problem}; restarting the hotspot")
    run(["/usr/sbin/iw", "dev", "wlan0", "set", "power_save", "off"])
    r = run(["nmcli", "con", "up", name], timeout=60)
    action = "nmcli up"
    time.sleep(5)
    if hotspot_problem(con, name) and not (r and r.returncode == 0):
        log("nmcli up failed; reloading brcmfmac")
        run(["modprobe", "-r", "brcmfmac"], timeout=30)
        time.sleep(2)
        run(["modprobe", "brcmfmac"], timeout=30)
        time.sleep(10)
        run(["nmcli", "con", "up", name], timeout=60)
        action = "driver reload"
    ok = hotspot_problem(con, name) is None
    with con:
        meta_set(con, "hotspot_restart", int(time.time()))
        con.execute("INSERT INTO hotspot_events VALUES (?,?,?,?)", (int(time.time()), problem, action, int(ok)))
    log(f"hotspot {action}: {'recovered' if ok else 'still broken'}")


# ---------- speed ----------

def cmd_speed():
    con = db()
    last = con.execute("SELECT up FROM probes ORDER BY ts DESC LIMIT 1").fetchone()
    if last and not last[0]:
        log("network down, skipping speedtest")
        return
    r = run(["speedtest", "--accept-license", "--accept-gdpr", "-f", "json"], timeout=180)
    if r is None or r.returncode != 0:
        log(f"speedtest failed: {r.stderr if r else 'timeout'}")
        return
    d = json.loads(r.stdout)
    row = (int(time.time()),
           round(d["download"]["bandwidth"] * 8 / 1e6, 2),
           round(d["upload"]["bandwidth"] * 8 / 1e6, 2),
           round(d["ping"]["latency"], 1),
           f'{d["server"]["name"]} ({d["server"]["location"]})')
    with con:
        con.execute("INSERT OR REPLACE INTO speeds VALUES (?,?,?,?,?)", row)
    log(f"speed down={row[1]} up={row[2]} ping={row[3]}")


# ---------- publish ----------

def overlap(a0, a1, b0, b1):
    return max(0, min(a1, b1) - max(a0, b0))


def build_payload(con):
    now = int(time.time())
    last = con.execute("SELECT ts, up, latency_ms, loss FROM probes ORDER BY ts DESC LIMIT 1").fetchone()
    outages = [dict(kind=k, start=s, end=e) for k, s, e in
               con.execute("SELECT kind, start, end FROM outages ORDER BY start")]
    first_ts = con.execute("SELECT v FROM meta WHERE k='first_probe'").fetchone()
    if not first_ts:
        first = con.execute("SELECT MIN(ts) FROM probes").fetchone()[0] or now
        meta_set(con, "first_probe", first)
        con.commit()
        first_ts = (str(first),)
    monitoring_since = int(first_ts[0])

    def uptime(window):
        w0 = max(now - window, monitoring_since)
        span = now - w0
        down = sum(overlap(o["start"], o["end"] or now, w0, now) for o in outages if o["kind"] == "down")
        off = sum(overlap(o["start"], o["end"] or now, w0, now) for o in outages if o["kind"] == "offline")
        known = span - off
        return round(100 * (known - down) / known, 3) if known > 0 else None

    up = bool(last[1]) if last else None
    if up:
        prev = [o for o in outages if o["end"]]
        since = prev[-1]["end"] if prev else monitoring_since
    else:
        open_o = [o for o in outages if o["end"] is None]
        since = open_o[-1]["start"] if open_o else now

    latest_speed = con.execute(
        "SELECT ts, down_mbps, up_mbps, ping_ms, server FROM speeds ORDER BY ts DESC LIMIT 1").fetchone()

    status = {
        "updated": now,
        "last_probe": last[0] if last else None,
        "up": up,
        "since": since,
        "latency_ms": last[2] if last else None,
        "loss": last[3] if last else None,
        "speed": dict(zip(["ts", "down", "up", "ping", "server"], latest_speed)) if latest_speed else None,
        "uptime": {"24h": uptime(86400), "7d": uptime(7 * 86400), "30d": uptime(30 * 86400),
                   "all": uptime(now - monitoring_since)},
        "monitoring_since": monitoring_since,
        "probe_interval": 60,
        "publish_interval": 300,
    }

    raw = [dict(ts=t, down=d, up=u, ping=p) for t, d, u, p in con.execute(
        "SELECT ts, down_mbps, up_mbps, ping_ms FROM speeds WHERE ts > ? ORDER BY ts",
        (now - RAW_SPEED_DAYS * 86400,))]
    daily = [dict(day=day, down=round(d, 1), up=round(u, 1), down_min=round(dmin, 1), n=n) for day, d, u, dmin, n in
             con.execute("""SELECT date(ts, 'unixepoch', 'localtime') AS day, AVG(down_mbps), AVG(up_mbps),
                            MIN(down_mbps), COUNT(*) FROM speeds GROUP BY day ORDER BY day""")]
    return status, outages, {"recent": raw, "daily": daily}


def git(*args, check=True):
    env = dict(os.environ,
               GIT_SSH_COMMAND=f"ssh -i {DEPLOY_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "
                               f"-o UserKnownHostsFile={STATE_DIR}/known_hosts -o ConnectTimeout=15",
               GIT_AUTHOR_NAME="bakul-lan-pi", GIT_AUTHOR_EMAIL="bakul-lan-pi@users.noreply.github.com",
               GIT_COMMITTER_NAME="bakul-lan-pi", GIT_COMMITTER_EMAIL="bakul-lan-pi@users.noreply.github.com")
    return subprocess.run(["git", "-C", WORK_DIR, *args], check=check, env=env,
                          capture_output=True, text=True, timeout=90)


def cmd_publish():
    con = db()
    status, outages, speed = build_payload(con)
    subprocess.run(["rm", "-rf", WORK_DIR], check=True)
    os.makedirs(WORK_DIR)
    for name, obj in [("status.json", status), ("outages.json", outages), ("speed.json", speed)]:
        with open(f"{WORK_DIR}/{name}", "w") as f:
            json.dump(obj, f, separators=(",", ":"))
    git("init", "-q", "-b", BRANCH)
    git("add", "-A")
    git("commit", "-q", "-m", f"status {time.strftime('%Y-%m-%d %H:%M:%S')}")
    r = git("push", "-q", "--force", REPO, f"{BRANCH}:{BRANCH}", check=False)
    subprocess.run(["rm", "-rf", WORK_DIR])
    if r.returncode != 0:
        log(f"push failed: {r.stderr.strip()}")
        sys.exit(1)
    log(f"published up={status['up']} outages={len(outages)}")


# ---------- prune ----------

def cmd_prune():
    con = db()
    cutoff = int(time.time()) - PROBE_RETENTION_DAYS * 86400
    with con:
        n = con.execute("DELETE FROM probes WHERE ts < ?", (cutoff,)).rowcount
        con.execute("DELETE FROM hotspot_events WHERE ts < ?", (cutoff,))
    con.execute("VACUUM")
    log(f"pruned {n} probes")


if __name__ == "__main__":
    cmds = {"probe": cmd_probe, "speed": cmd_speed, "publish": cmd_publish, "prune": cmd_prune}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        sys.exit(f"usage: {sys.argv[0]} {{{'|'.join(cmds)}}}")
    os.makedirs(STATE_DIR, exist_ok=True)
    os.environ.setdefault("HOME", STATE_DIR)  # the Ookla CLI crashes when HOME is unset (as under systemd)
    cmds[sys.argv[1]]()
