#!/usr/bin/env bash

# Get list of public key files in ~/.ssh directory
ssh_dir="$HOME/.ssh"
public_keys=("$ssh_dir"/*.pub)

available_profiles=()

# Check each public key file
for pub_key in "${public_keys[@]}"; do
  # Check if the corresponding private key file exists
  private_key="${pub_key%.pub}"
  if [ -f "$private_key" ]; then
    available_profiles+=("$(basename "$private_key")")
  fi
done

# Print the private key files found
if [ ${#available_profiles[@]} -eq 0 ]; then
  echo "No private keys found in $ssh_dir"
fi

is_available=1

# Start the ssh-agent in the background
eval "$(ssh-agent -s)" > /dev/null 2>&1

# Check for SSH_PROFILE environment variable and add the corresponding key
if [ -n "$SSH_PROFILE" ]; then
  profiles="${available_profiles[*]}"

  if echo "$profiles" | grep -q "\b$SSH_PROFILE\b"; then
    ssh-add --apple-use-keychain ~/.ssh/$SSH_PROFILE
  else
    is_available=0
  fi
else
  is_available=0
fi

if [ $is_available = 0 ]; then
  echo "please select the correct ssh profile"
  echo
  echo "-----available profiles-----"
  echo

  for element in "${available_profiles[@]}"; do
    echo "   ---> $element"
  done
  
  exit 1
fi

git config gpg.format ssh
git config commit.gpgsign true
git config pull.rebase true
git config user.name "Kaan Taha Köken"

if [ "$SSH_PROFILE" = "personal" ]; then
  git config user.email "kaan_taha_koken@hotmail.com"
  git config user.username "kaankoken"
else
  git config user.email "kaankoken@gain.com.tr"
  git config user.username "kkoken"
fi

git config user.signingkey "~/.ssh/$SSH_PROFILE"
