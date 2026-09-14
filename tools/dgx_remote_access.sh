#!/bin/bash
# dgx_remote_access.sh — Mac-side bootstrap and cockpit for the DGX Spark.
#
# Implements CEOINBOX/CEO-PLANS/dgx-provisioning/DGX-REMOTE-ACCESS.md:
#   Part A  key material, sshd hardening, ssh config, tunnels, CEO attach
#   Part B  loopback-only remote desktop, brought up on demand and taken down
#
# Contract, matching bin/dgx_*.sh in the ceo repo:
#   - read-only by default; every mutating command requires --yes
#   - --dry-run prints the exact command instead of running it
#   - stores no password, weakens no host-key checking, writes no secret
#   - desktop-status is FAIL-CLOSED on a non-loopback bind (ruling R-g)
#   - safe to rerun
#
# Run from the Mac. Remote work goes over the ssh alias, never over a
# password. Companion to ceo/bin/spark_remote.sh; this script does the
# bring-up that wrapper assumes has already happened.
#
# Usage: bash tools/dgx_remote_access.sh <command> [options]
#        bash tools/dgx_remote_access.sh help

set -u

# ---------------------------------------------------------------- settings

SPARK_HOST="${SPARK_HOST:-office-spark}"          # ssh alias, see ssh-config
SPARK_KEY="${SPARK_KEY:-$HOME/.ssh/id_ed25519_spark}"
SPARK_SSHDIR="${SPARK_SSHDIR:-$HOME/.ssh}"

FLOOR_LOCAL_PORT="${FLOOR_LOCAL_PORT:-18788}"     # 8788 stays the Mac Office
FLOOR_REMOTE_PORT="${FLOOR_REMOTE_PORT:-8788}"
DASH_LOCAL_PORT="${DASH_LOCAL_PORT:-11000}"
OLLAMA_LOCAL_PORT="${OLLAMA_LOCAL_PORT:-21434}"   # avoids the Mac's own 11434
VLLM_LOCAL_PORT="${VLLM_LOCAL_PORT:-18000}"

DESKTOP_KIND="${DESKTOP_KIND:-rdp}"               # rdp | vnc
RDP_LOCAL_PORT="${RDP_LOCAL_PORT:-13389}"
RDP_REMOTE_PORT="${RDP_REMOTE_PORT:-3389}"
VNC_LOCAL_PORT="${VNC_LOCAL_PORT:-15901}"
VNC_REMOTE_PORT="${VNC_REMOTE_PORT:-5901}"
VNC_DISPLAY="${VNC_DISPLAY:-:1}"
VNC_GEOMETRY="${VNC_GEOMETRY:-2560x1440}"

# §13 memory emergency policy: keep 20-25% headroom. The desktop is a
# workload and refuses to start below this.
MIN_HEADROOM_PCT="${MIN_HEADROOM_PCT:-25}"

OFFICE_ROOT="${OFFICE_ROOT:-\$HOME/TheOffice}"    # expanded remotely, not here
CEO_INBOX="${CEO_INBOX:-$OFFICE_ROOT/ceo/CEOINBOX}"

DRY_RUN=0
ASSUME_YES=0

# ----------------------------------------------------------------- output

RED=''; YLW=''; GRN=''; DIM=''; OFF=''
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[31m'; YLW=$'\033[33m'; GRN=$'\033[32m'; DIM=$'\033[2m'; OFF=$'\033[0m'
fi

say()   { printf '%s\n' "$*"; }
step()  { printf '\n== %s ==\n' "$*"; }
ok()    { printf '%s  OK%s    %s\n' "$GRN" "$OFF" "$*"; }
warn()  { printf '%s  WARN%s  %s\n' "$YLW" "$OFF" "$*"; }
fail()  { printf '%s  FAIL%s  %s\n' "$RED" "$OFF" "$*"; }
die()   { fail "$*"; exit 1; }
note()  { printf '%s        %s%s\n' "$DIM" "$*" "$OFF"; }

# Run a command, or print it under --dry-run. Every mutation goes through here.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s  would run:%s %s\n' "$DIM" "$OFF" "$*"
    return 0
  fi
  "$@"
}

# Run a remote shell snippet. Read-only helpers call this directly; mutating
# ones go through run() so --dry-run shows the whole ssh invocation.
remote() { ssh -o BatchMode=yes "$SPARK_HOST" "$@"; }
remote_tty() { ssh -t "$SPARK_HOST" "$@"; }

require_yes() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ "$DRY_RUN" -eq 1 ] && return 0
  fail "$1 mutates the Spark and needs --yes (or --dry-run to preview)."
  exit 1
}

require_link() {
  remote true 2>/dev/null && return 0
  die "cannot reach '$SPARK_HOST' with key auth. Run: $0 check"
}

# ------------------------------------------------------------- part A: keys

cmd_keygen() {
  step "Purpose-built key for the Spark"
  if [ -f "$SPARK_KEY" ]; then
    ok "key already exists: $SPARK_KEY"
    note "refusing to overwrite; delete it yourself if you really mean to"
    return 0
  fi
  require_yes "keygen"
  run mkdir -p "$SPARK_SSHDIR"
  run chmod 700 "$SPARK_SSHDIR"
  run ssh-keygen -t ed25519 -a 100 -C "founder-mac -> $SPARK_HOST" -f "$SPARK_KEY"
  run ssh-add --apple-use-keychain "$SPARK_KEY"
  ok "created $SPARK_KEY and loaded it into the keychain"
  note "this key is for the Spark only — do not reuse the GitHub key here"
}

cmd_install_key() {
  local target="${1:-}"
  [ -n "$target" ] || die "usage: $0 install-key <spark-user>@<spark-ip>"
  step "Installing the public key on $target"
  [ -f "$SPARK_KEY.pub" ] || die "no public key at $SPARK_KEY.pub — run: $0 keygen --yes"
  require_yes "install-key"
  say "The password prompt below is the last time a password is accepted."
  run ssh-copy-id -i "$SPARK_KEY.pub" "$target"
  ok "key installed; now run: $0 ssh-config --write"
}

cmd_ssh_config() {
  local write=0
  [ "${1:-}" = "--write" ] && write=1

  local block
  block=$(cat <<EOF

Host $SPARK_HOST
    HostName ${SPARK_IP:-<spark-reserved-ip>}
    User ${SPARK_USER:-<spark-user>}
    IdentityFile $SPARK_KEY
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
    ControlMaster auto
    ControlPersist 10m
    ControlPath ~/.ssh/cm-%C
EOF
)

  if [ "$write" -eq 0 ]; then
    step "SSH host block (copy into ~/.ssh/config, or rerun with --write)"
    say "$block"
    note "no -L forwards belong in this block: spark_remote.sh tunnel supplies its own"
    note "set SPARK_IP and SPARK_USER in the environment to fill the placeholders"
    return 0
  fi

  step "Writing host block to $SPARK_SSHDIR/config"
  if [ -f "$SPARK_SSHDIR/config" ] && grep -qE "^Host[[:space:]]+$SPARK_HOST\$" "$SPARK_SSHDIR/config"; then
    ok "Host $SPARK_HOST already present; leaving it alone"
    return 0
  fi
  require_yes "ssh-config --write"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s  would append to %s:%s\n%s\n' "$DIM" "$SPARK_SSHDIR/config" "$OFF" "$block"
    return 0
  fi
  mkdir -p "$SPARK_SSHDIR"; chmod 700 "$SPARK_SSHDIR"
  printf '%s\n' "$block" >> "$SPARK_SSHDIR/config"
  chmod 600 "$SPARK_SSHDIR/config"
  ok "appended Host $SPARK_HOST"
  note "fill in HostName/User if they are still placeholders"
}

cmd_harden_sshd() {
  step "Hardening sshd on the Spark (key-only, no root, no X11)"
  # --yes is checked before the link probe: a refused mutation should not
  # even open a connection.
  require_yes "harden-sshd"
  require_link

  local user
  user=$(remote 'echo "$USER"' 2>/dev/null) || die "could not read remote user"

  warn "keep THIS session open and test a new one before trusting the change"
  note "a bad sshd drop-in on a headless box costs a physical trip"

  local conf
  conf=$(cat <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers $user
X11Forwarding no
ClientAliveInterval 30
ClientAliveCountMax 6
EOF
)
  # Write, validate, and only then reload. sshd -t failing leaves the running
  # daemon untouched, which is the whole point of doing it in this order.
  run ssh "$SPARK_HOST" "sudo tee /etc/ssh/sshd_config.d/10-office.conf >/dev/null <<'OFFICE_EOF'
$conf
OFFICE_EOF
sudo sshd -t && sudo systemctl reload ssh" || die "sshd validation failed; nothing was reloaded"

  ok "sshd hardened for user '$user'"
  note "verify from a SECOND terminal now: ssh -o BatchMode=yes $SPARK_HOST true"
}

# ------------------------------------------------------------ part A: checks

cmd_check() {
  local rc=0
  step "Link"
  if ssh -o BatchMode=yes -o ConnectTimeout=10 "$SPARK_HOST" true 2>/dev/null; then
    ok "key auth to '$SPARK_HOST'"
  else
    fail "no key auth to '$SPARK_HOST'"
    note "try: $0 keygen --yes && $0 install-key <user>@<ip> --yes && $0 ssh-config --write --yes"
    return 1
  fi

  step "Appliance"
  local host arch
  host=$(remote 'hostname' 2>/dev/null); ok "hostname: ${host:-unknown}"
  arch=$(remote 'uname -m' 2>/dev/null)
  case "$arch" in
    aarch64|arm64) ok "arch: $arch" ;;
    "")            warn "arch: unreadable" ;;
    *)             warn "arch: $arch (expected aarch64 — is this really the Spark?)" ;;
  esac
  if remote 'command -v nvidia-smi >/dev/null' 2>/dev/null; then
    ok "GPU: $(remote 'nvidia-smi --query-gpu=name --format=csv,noheader' 2>/dev/null | head -1)"
  else
    warn "nvidia-smi not found"
    rc=1
  fi

  step "Password auth is refused"
  # A server that still accepts passwords answers this with a prompt method.
  if remote 'grep -rqs "^PasswordAuthentication no" /etc/ssh/sshd_config.d/ /etc/ssh/sshd_config' 2>/dev/null; then
    ok "PasswordAuthentication no is configured"
  else
    warn "password auth may still be enabled — run: $0 harden-sshd --yes"
    rc=1
  fi

  step "Office"
  if remote 'command -v tmux >/dev/null' 2>/dev/null; then
    local n
    n=$(remote 'tmux ls 2>/dev/null | wc -l' 2>/dev/null | tr -d ' ')
    ok "tmux present; ${n:-0} session(s)"
  else
    fail "tmux missing — the lane backend is mandatory on Linux"
    rc=1
  fi
  if remote "curl -fsS -o /dev/null -m 5 http://127.0.0.1:$FLOOR_REMOTE_PORT/" 2>/dev/null; then
    ok "floor answers on the Spark's 127.0.0.1:$FLOOR_REMOTE_PORT"
  else
    warn "floor not answering on 127.0.0.1:$FLOOR_REMOTE_PORT (not started?)"
  fi

  step "Exposure"
  check_no_public_listener "$FLOOR_REMOTE_PORT" "floor"   || rc=1
  check_no_public_listener 11434 "ollama"                 || rc=1
  check_no_public_listener "$RDP_REMOTE_PORT" "rdp"       || rc=1
  check_no_public_listener "$VNC_REMOTE_PORT" "vnc"       || rc=1

  [ "$rc" -eq 0 ] && ok "check passed" || warn "check completed with findings"
  return "$rc"
}

# Fail-closed: a listener on this port that is not loopback is a finding.
# Absent is fine. Non-loopback is not (ruling R-g, §B6).
check_no_public_listener() {
  local port="$1" label="$2" lines
  lines=$(remote "ss -tlnH 2>/dev/null | awk '{print \$4}' | grep -E '[:.]$port\$'" 2>/dev/null)
  if [ -z "$lines" ]; then
    note "$label: no listener on $port"
    return 0
  fi
  local bad=0 addr
  for addr in $lines; do
    case "$addr" in
      127.0.0.1:*|\[::1\]:*) : ;;
      *) bad=1 ;;
    esac
  done
  if [ "$bad" -eq 1 ]; then
    fail "$label is listening off-loopback on $port: $(echo "$lines" | tr '\n' ' ')"
    note "§4 doctrine violation — close it before reconnecting"
    return 1
  fi
  ok "$label bound loopback-only on $port"
  return 0
}

cmd_tunnel() {
  step "Tunnel (foreground — leave this terminal open)"
  say "  http://127.0.0.1:$FLOOR_LOCAL_PORT   DGX Office floor"
  say "  http://127.0.0.1:$DASH_LOCAL_PORT   NVIDIA DGX Dashboard"
  say "  http://127.0.0.1:$OLLAMA_LOCAL_PORT   Ollama API"
  say "  http://127.0.0.1:$VLLM_LOCAL_PORT   vLLM API (when it exists)"
  say ""
  run ssh -N \
    -L "$FLOOR_LOCAL_PORT:127.0.0.1:$FLOOR_REMOTE_PORT" \
    -L "$DASH_LOCAL_PORT:127.0.0.1:11000" \
    -L "$OLLAMA_LOCAL_PORT:127.0.0.1:11434" \
    -L "$VLLM_LOCAL_PORT:127.0.0.1:8000" \
    "$SPARK_HOST"
}

# ---------------------------------------------------------- part A: the CEO

cmd_sessions() {
  require_link
  step "tmux sessions on the Spark"
  remote 'tmux ls 2>/dev/null' || warn "no sessions (or tmux server not running)"
}

# Grouped session: shares the lane's windows but keeps its own size, so
# attaching does not reflow the CEO's live pane (§A5.1).
cmd_attach() {
  local target="${1:-}"
  [ -n "$target" ] || die "usage: $0 attach <tmux-session>   (see: $0 sessions)"
  require_link
  remote "tmux has-session -t '=$target'" 2>/dev/null \
    || die "no exact session named '$target' — run: $0 sessions"
  step "Attaching to '$target' via a grouped view (Ctrl-b d to detach)"
  note "detach with Ctrl-b d — Ctrl-b & KILLS the window and the lane with it"
  run ssh -t "$SPARK_HOST" "tmux new-session -t '=$target' -s 'founder-view-$$'"
}

# Same, but read-only: keystrokes go nowhere (§A5.2).
cmd_watch() {
  local target="${1:-}"
  [ -n "$target" ] || die "usage: $0 watch <tmux-session>"
  require_link
  remote "tmux has-session -t '=$target'" 2>/dev/null \
    || die "no exact session named '$target' — run: $0 sessions"
  step "Watching '$target' read-only (Ctrl-b d to detach)"
  run ssh -t "$SPARK_HOST" "tmux new-session -r -t '=$target' -s 'founder-watch-$$'"
}

cmd_clients() {
  local target="${1:-}"
  [ -n "$target" ] || die "usage: $0 clients <tmux-session>"
  require_link
  step "Clients attached to '$target'"
  remote "tmux list-clients -t '=$target' 2>/dev/null" \
    || note "nobody attached"
}

# The written channel — survives a dropped tunnel, interrupts no turn,
# leaves the audit trail every other dispatch leaves (§A5.3).
cmd_ask() {
  local file="${1:-}"
  [ -n "$file" ] || die "usage: $0 ask <file.md>"
  [ -f "$file" ] || die "no such file: $file"
  require_yes "ask"
  require_link
  step "Delivering $(basename "$file") to the DGX CEO inbox"
  run ssh "$SPARK_HOST" "mkdir -p $CEO_INBOX"
  run scp "$file" "$SPARK_HOST:$CEO_INBOX/"
  ok "delivered to $CEO_INBOX/$(basename "$file")"
}

# ------------------------------------------------------------ part B: desktop

# The desktop competes for the same unified memory the overnight envelope
# aborts on (§13). Refuse to start below the headroom floor.
headroom_ok() {
  local total avail pct
  total=$(remote "awk '/MemTotal/{print \$2}' /proc/meminfo" 2>/dev/null)
  avail=$(remote "awk '/MemAvailable/{print \$2}' /proc/meminfo" 2>/dev/null)
  case "$total$avail" in ''|*[!0-9]*) warn "could not read memory; skipping headroom gate"; return 0 ;; esac
  [ "$total" -gt 0 ] || return 0
  pct=$(( avail * 100 / total ))
  if [ "$pct" -lt "$MIN_HEADROOM_PCT" ]; then
    fail "only ${pct}% memory available; floor is ${MIN_HEADROOM_PCT}%"
    note "stop a workload or lower generation slots before starting a desktop"
    return 1
  fi
  ok "memory headroom ${pct}% (floor ${MIN_HEADROOM_PCT}%)"
  return 0
}

cmd_desktop_install() {
  require_yes "desktop-install"
  require_link
  case "$DESKTOP_KIND" in
    rdp) desktop_install_rdp ;;
    vnc) desktop_install_vnc ;;
    *)   die "DESKTOP_KIND must be rdp or vnc (got '$DESKTOP_KIND')" ;;
  esac
}

desktop_install_rdp() {
  step "Installing headless GNOME Remote Desktop (RDP)"
  note "you will be prompted on the Spark for the desktop password;"
  note "this script neither reads nor stores it"
  run ssh -t "$SPARK_HOST" '
    set -e
    command -v grdctl >/dev/null || { sudo apt-get update && sudo apt-get install -y gnome-remote-desktop; }
    sudo grdctl --system rdp enable
    sudo grdctl --system rdp disable-view-only
    printf "Desktop username for RDP: "; read -r RDPUSER
    sudo grdctl --system rdp set-credentials "$RDPUSER"
    sudo systemctl enable --now gnome-remote-desktop.service
  ' || die "RDP install failed"
  ok "gnome-remote-desktop installed"
  say ""
  cmd_desktop_status || warn "fix the bind before connecting"
}

desktop_install_vnc() {
  step "Installing TigerVNC + XFCE virtual desktop"
  run ssh -t "$SPARK_HOST" '
    set -e
    sudo apt-get update
    sudo apt-get install -y tigervnc-standalone-server tigervnc-common xfce4 xfce4-goodies dbus-x11
    mkdir -p "$HOME/.vnc"
    cat > "$HOME/.vnc/xstartup" <<"XEOF"
#!/bin/sh
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
exec dbus-launch --exit-with-session startxfce4
XEOF
    chmod +x "$HOME/.vnc/xstartup"
    test -f "$HOME/.vnc/passwd" || vncpasswd
  ' || die "VNC install failed"
  ok "tigervnc + xfce installed"
  note "a password is set even though the listener is loopback-only — on purpose"
}

cmd_desktop_up() {
  require_yes "desktop-up"
  require_link
  headroom_ok || exit 1
  step "Starting the desktop ($DESKTOP_KIND)"
  case "$DESKTOP_KIND" in
    rdp) run ssh "$SPARK_HOST" 'sudo systemctl start gnome-remote-desktop.service' ;;
    vnc) run ssh "$SPARK_HOST" "vncserver $VNC_DISPLAY -localhost yes -geometry $VNC_GEOMETRY -depth 24" ;;
    *)   die "DESKTOP_KIND must be rdp or vnc" ;;
  esac
  say ""
  cmd_desktop_status || { fail "refusing to hand you a connection to an exposed desktop"; exit 2; }
  note "connect with: $0 desktop        stop with: $0 desktop-down --yes"
}

cmd_desktop_down() {
  require_yes "desktop-down"
  require_link
  step "Stopping the desktop ($DESKTOP_KIND)"
  case "$DESKTOP_KIND" in
    rdp) run ssh "$SPARK_HOST" 'sudo systemctl stop gnome-remote-desktop.service' ;;
    vnc) run ssh "$SPARK_HOST" "vncserver -kill $VNC_DISPLAY" ;;
  esac
  ok "stopped — an idle desktop is attack surface and memory"
}

# FAIL-CLOSED. Exit 2 on a non-loopback bind; that is a §4 violation, not a note.
cmd_desktop_status() {
  require_link
  local port label
  case "$DESKTOP_KIND" in
    rdp) port="$RDP_REMOTE_PORT"; label="rdp" ;;
    vnc) port="$VNC_REMOTE_PORT"; label="vnc" ;;
    *)   die "DESKTOP_KIND must be rdp or vnc" ;;
  esac
  step "Desktop status ($label, remote port $port)"
  if ! check_no_public_listener "$port" "$label"; then
    return 2
  fi
  local lines
  lines=$(remote "ss -tlnH 2>/dev/null | awk '{print \$4}' | grep -E '[:.]$port\$'" 2>/dev/null)
  [ -n "$lines" ] && ok "desktop is up" || note "desktop is down"
  return 0
}

cmd_desktop() {
  local lport rport
  case "$DESKTOP_KIND" in
    rdp) lport="$RDP_LOCAL_PORT"; rport="$RDP_REMOTE_PORT" ;;
    vnc) lport="$VNC_LOCAL_PORT"; rport="$VNC_REMOTE_PORT" ;;
    *)   die "DESKTOP_KIND must be rdp or vnc" ;;
  esac
  cmd_desktop_status || { fail "not connecting to an exposed or absent desktop"; exit 2; }

  step "Forwarding 127.0.0.1:$lport -> Spark 127.0.0.1:$rport"
  if [ "$DESKTOP_KIND" = "vnc" ]; then
    say "Connect to: vnc://127.0.0.1:$lport"
    note "macOS Screen Sharing is picky about VNC auth; RealVNC/TigerVNC Viewer is more reliable"
  else
    say "Connect Windows App (Microsoft Remote Desktop) to: 127.0.0.1:$lport"
    note "self-signed certificate: accept once. A NEW warning later is a reason to stop"
  fi
  say "Ctrl-C closes the forward. The desktop session itself keeps running."
  say ""
  run ssh -N -L "$lport:127.0.0.1:$rport" "$SPARK_HOST"
}

# --------------------------------------------------------------------- meta

cmd_doctor() {
  step "Doctor — read-only, mutates nothing"
  cmd_check
  local rc=$?
  say ""
  cmd_desktop_status
  local drc=$?
  say ""
  if [ "$rc" -eq 0 ] && [ "$drc" -eq 0 ]; then
    ok "cockpit healthy"
  else
    warn "see findings above"
  fi
  [ "$drc" -eq 2 ] && return 2
  return "$rc"
}

cmd_help() {
  cat <<EOF
dgx_remote_access.sh — Mac-side bootstrap and cockpit for the DGX Spark

Part A — SSH and the CEO
  keygen                    create the Spark-only ed25519 key            [--yes]
  install-key <user@ip>     ssh-copy-id it to the Spark                  [--yes]
  ssh-config [--write]      print (or append) the office-spark block     [--yes]
  harden-sshd               key-only, no root, no X11 on the Spark       [--yes]
  check                     read-only readiness + exposure check
  tunnel                    foreground: floor, dashboard, ollama, vllm
  sessions                  list tmux sessions
  attach <session>          grouped attach — does not reflow the lane
  watch <session>           read-only attach — keystrokes go nowhere
  clients <session>         who else is attached
  ask <file.md>             deliver a written request to the CEO inbox   [--yes]

Part B — desktop (loopback only, on demand)
  desktop-install           install GNOME RDP (default) or TigerVNC      [--yes]
  desktop-up                start it, after a memory-headroom gate       [--yes]
  desktop                   forward the port and print connection info
  desktop-status            FAIL-CLOSED bind check; exit 2 if exposed
  desktop-down              stop it                                      [--yes]

  doctor                    check + desktop-status
  help                      this

Options
  --yes                     perform mutations (required for [--yes] commands)
  --dry-run                 print commands instead of running them
  --rdp | --vnc             pick the desktop backend for this invocation

Environment
  SPARK_HOST=$SPARK_HOST   SPARK_KEY=$SPARK_KEY
  SPARK_IP, SPARK_USER      fill the ssh-config placeholders
  FLOOR_LOCAL_PORT=$FLOOR_LOCAL_PORT       DESKTOP_KIND=$DESKTOP_KIND
  MIN_HEADROOM_PCT=$MIN_HEADROOM_PCT       VNC_GEOMETRY=$VNC_GEOMETRY

First run, in order:
  $0 keygen --yes
  $0 install-key <spark-user>@<spark-ip> --yes
  SPARK_IP=<ip> SPARK_USER=<user> $0 ssh-config --write --yes
  $0 check
  $0 harden-sshd --yes          # then verify from a SECOND terminal

Plan: CEOINBOX/CEO-PLANS/dgx-provisioning/DGX-REMOTE-ACCESS.md
EOF
}

# --------------------------------------------------------------------- main

CMD=""
ARGS=""
for arg in "$@"; do
  case "$arg" in
    --yes)     ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --rdp)     DESKTOP_KIND="rdp" ;;
    --vnc)     DESKTOP_KIND="vnc" ;;
    --write)   ARGS="$ARGS --write" ;;
    -h|--help) CMD="help" ;;
    -*)        die "unknown option: $arg" ;;
    *)         if [ -z "$CMD" ]; then CMD="$arg"; else ARGS="$ARGS $arg"; fi ;;
  esac
done

# shellcheck disable=SC2086  # ARGS is a deliberate word-split of simple tokens
set -- $ARGS

case "${CMD:-help}" in
  keygen)          cmd_keygen ;;
  install-key)     cmd_install_key "$@" ;;
  ssh-config)      cmd_ssh_config "$@" ;;
  harden-sshd)     cmd_harden_sshd ;;
  check)           cmd_check ;;
  tunnel)          cmd_tunnel ;;
  sessions)        cmd_sessions ;;
  attach)          cmd_attach "$@" ;;
  watch)           cmd_watch "$@" ;;
  clients)         cmd_clients "$@" ;;
  ask)             cmd_ask "$@" ;;
  desktop-install) cmd_desktop_install ;;
  desktop-up)      cmd_desktop_up ;;
  desktop-down)    cmd_desktop_down ;;
  desktop-status)  cmd_desktop_status ;;
  desktop)         cmd_desktop ;;
  doctor)          cmd_doctor ;;
  help)            cmd_help ;;
  *)               fail "unknown command: $CMD"; say ""; cmd_help; exit 1 ;;
esac
