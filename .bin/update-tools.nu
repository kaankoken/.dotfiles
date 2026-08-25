#!/usr/bin/env nu

def main [] {
  print "==> Updating shell-installed tools"

  # --- Atuin ---
  if (which atuin | is-not-empty) {
    print "-> Atuin"
    try {
      ^atuin update
      print "   atuin update OK"
    } catch {
    }
  } else {
    print "-> Atuin not found, skipping"
  }

  # --- Rust (rustup) ---
  if (which rustup | is-not-empty) {
    print "-> Rust (rustup)"
    ^rustup update
  } else {
    print "-> Rustup not found, skipping"
  }

  # --- uv ---
  if (which uv | is-not-empty) {
    print "-> uv"
    try {
      ^uv self update
      print "   uv self update OK"
    } catch {
    }
  } else {
    print "-> uv not found, skipping"
  }

  # --- tokensave ---
  if (which tokensave | is-not-empty) {
    print "-> tokensave"
    try {
      ^tokensave upgrade
      print "   tokensave upgrade OK"
    } catch {
    }
  } else {
    print "-> tokensave not found, skipping"
  }
  
  # --- bun ---
  if (which bun | is-not-empty) {
    print "-> bun"
    try {
      ^bun upgrade
      print "   bun upgrade OK"
    } catch {
    }
  } else {
    print "-> bun not found, skipping"
  }

  print "==> Done"
}
