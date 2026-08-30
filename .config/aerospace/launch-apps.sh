#!/bin/bash

# Safari has no Chrome --profile-directory flag. Profile windows are
# File > New Window > "New <Name> Window". Reuse if already open.

safari_profile_menu_item() {
  printf 'New %s Window' "$1"
}

open_safari_profile() {
  local profile="$1"
  local menu
  menu="$(safari_profile_menu_item "$profile")"
  osascript - "$profile" "$menu" <<'APPLESCRIPT'
on run argv
  set profileName to item 1 of argv
  set menuName to item 2 of argv
  tell application "Safari"
    activate
    repeat with w in windows
      try
        if name of w starts with profileName then return
      end try
    end repeat
  end tell
  tell application "System Events"
    tell process "Safari"
      set frontmost to true
      click menu item menuName of menu "New Window" of menu item "New Window" of menu "File" of menu bar 1
    end tell
  end tell
end run
APPLESCRIPT
}

if [ "${1:-}" = --self-test ]; then
  [ "$(safari_profile_menu_item Personal)" = "New Personal Window" ]
  [ "$(safari_profile_menu_item Capybara)" = "New Capybara Window" ]
  [ "$(safari_profile_menu_item Inspace)" = "New Inspace Window" ]
  echo OK
  exit 0
fi

sleep 2

open -a Safari
for _ in 1 2 3 4 5 6 7 8 9 10; do
  osascript -e 'tell application "Safari" to get name of window 1' >/dev/null 2>&1 && break
  sleep 0.3
done

# Workspace 1: Safari (Personal profile) & Spotify
echo "Launching Safari (Personal profile) and Spotify on workspace 1..."
open_safari_profile "Personal"
sleep 1
open -a Spotify
sleep 1

# Workspace 2: Ghostty
echo "Launching Ghostty on workspace 2..."
open -a Ghostty
sleep 1

# Workspace 3: WhatsApp & Signal
echo "Launching WhatsApp and Signal on workspace 3..."
open -a WhatsApp
sleep 1
open -a Signal
sleep 1

# Workspace 4: Safari (Capybara profile)
echo "Launching Safari (Capybara profile) on workspace 4..."
open_safari_profile "Capybara"
sleep 1

# Workspace 5: Slack & Microsoft Outlook
echo "Launching Slack and Microsoft Outlook on workspace 5..."
open -a Slack
sleep 1
open -a "Microsoft Outlook"
sleep 1

# Workspace 6: Safari (Inspace profile)
echo "Launching Safari (Inspace profile) on workspace 6..."
open_safari_profile "Inspace"
sleep 1

echo "All applications launched!"

# Optional: Focus on workspace 1 after launching
sleep 2
aerospace workspace 1
