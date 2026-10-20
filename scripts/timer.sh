#!/bin/bash
# Hourly timer for a site script, using macOS launchd.
#   bash scripts/timer.sh install instahyre   runs every hour, 8am to 11pm
#   bash scripts/timer.sh remove instahyre    stops it
#   bash scripts/timer.sh status instahyre    shows if it is loaded and the last log lines
# If the Mac is asleep at run time, launchd runs it once when the Mac wakes.
# macOS stops background jobs from reading ~/Documents, so install copies the scripts
# (with .env and private answers) to ~/.jobbot/app and the timer runs from there.
# After changing any script, run install again to refresh that copy.
set -euo pipefail
ACTION=${1:-status}; SITE=${2:-instahyre}
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.sejal.jobbot.$SITE"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/.jobbot/logs"; mkdir -p "$LOGDIR"
NODE="$(command -v node)"

APP="$HOME/.jobbot/app"

case "$ACTION" in
  install)
    mkdir -p "$APP"
    rsync -a --delete --exclude .git --exclude '*/debug' "$REPO/" "$APP/"
    chmod 700 "$APP"
    MINUTE=$(python3 -c "import json;print(json.load(open('$REPO/shared/config.json'))['sites']['$SITE'].get('runMinute',0))")
    HOURS=""
    for h in $(seq 8 23); do HOURS+="<dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>$MINUTE</integer></dict>"; done
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/core/run.mjs</string><string>$SITE</string><string>--live</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>StartCalendarInterval</key><array>$HOURS</array>
  <key>StandardOutPath</key><string>$LOGDIR/$SITE.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/$SITE.log</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin</string></dict>
</dict></plist>
PL
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed: $SITE runs every hour at :$(printf %02d $MINUTE), 8am to 11pm, from $APP. Log: $LOGDIR/$SITE.log" ;;
  remove)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"; echo "Removed the $SITE timer." ;;
  run-now)
    launchctl kickstart "gui/$(id -u)/$LABEL"; echo "Started a $SITE run now. Log: $LOGDIR/$SITE.log" ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state =|runs =|last exit" || echo "Not installed."
    tail -n 8 "$LOGDIR/$SITE.log" 2>/dev/null || true ;;
esac
