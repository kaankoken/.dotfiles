#!/bin/bash
sleep 2

# Workspace 1: Safari (Personal profile) & Spotify
echo "Launching Safari (Personal profile) and Spotify on workspace 1..."
open -a Safari --args --profile-directory="Profile 1"  # Adjust profile name as needed
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

# Workspace 4: Safari (Morfeu profile)
echo "Launching Safari (Morfeu profile) on workspace 4..."
# For different Safari profiles, you might need to use Safari's profile switching
# This approach depends on how you've set up your Safari profiles
open -a Safari --args --profile-directory="Morfeu"  # Adjust profile name as needed
sleep 1

# Workspace 5: Slack & Microsoft Outlook
echo "Launching Slack and Microsoft Outlook on workspace 5..."
open -a Slack
sleep 1
open -a "Microsoft Outlook"
sleep 1

echo "All applications launched!"

# Optional: Focus on workspace 1 after launching
sleep 2
aerospace workspace 1
