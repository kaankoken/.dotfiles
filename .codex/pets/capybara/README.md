# Capybara Pet Bundle

Portable animation package for the custom ChatGPT Work pet **Capybara**.

## Contents

- `manifest.json` — animation names, timing, loop behavior, atlas coordinates, and frame paths
- `assets/spritesheet.png` — canonical 1536×1872 RGBA sprite sheet
- `animations/` — every required animation exported as individual 192×208 transparent PNG frames
- `previews/` — state GIFs, full GIF/MP4, stills, and the labeled contact sheet
- `validation.json` — validation results for the canonical atlas
- `checksums.sha256` — SHA-256 integrity hashes for all package files

## Sprite-sheet layout

The atlas uses 8 columns × 9 rows. Each cell is 192×208 pixels. Rows are:

1. idle — 6 frames
2. run-right — 8 frames
3. run-left — 8 frames
4. wave — 4 frames
5. jump — 5 frames
6. failure-reaction — 8 frames
7. waiting — 6 frames
8. active-work — 6 frames
9. review-inspect — 6 frames

Unused atlas cells are fully transparent. Applications may load either the atlas coordinates or the pre-extracted frame files described in `manifest.json`.
