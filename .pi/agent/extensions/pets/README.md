# Input-edge pets

Local Pi extension for Codex V1/V2 sprite packages. Pet occupies a small rail beside the input editor, not a widget below it or a desktop window.

## Setup

```sh
npm --prefix ~/.pi/agent/extensions/pets ci
```

Reload Pi after enabling the extension. No pet is selected by default.

```text
/pet import /absolute/path/to/my-pet
/pet list
/pet choose my-pet
/pet status
```

Import validates and copies only `pet.json` and its PNG/WebP asset into `~/.pi/agent/pets/<id>/`. Existing IDs are never overwritten. Selection and display settings persist in `~/.pi/agent/pets/config.json`.

## Controls

- `/pet`: choose an installed pet.
- `/pet hide` / `/pet show`: hide or show selected pet.
- `/pet renderer auto|ansi`: Kitty/Ghostty native images or ANSI half-block pixels. Other terminals and tmux use ANSI.
- `/pet animate on|off`: animation or reduced-motion first frames.
- `/pet preview <state>`: preview a standard animation briefly.
- `/pet look <degrees>`: preview a V2 pose; clockwise from up.
- `/pet status`: selected pet, version, renderer, and activity.

Standard states: `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`.

Idle V2 pets look toward pointer movement within the editor region in fullscreen mode. Click the pet to jump. Commands provide keyboard alternatives. Narrow terminals hide the rail.

## Asset contract

| Version | Dimensions | Grid |
| --- | --- | --- |
| V1 (version omitted or 1) | 1536 × 1872 | 8 × 9 |
| V2 (`spriteVersionNumber: 2`) | 1536 × 2288 | 8 × 11 |

Cells are 192 × 208. Standard rows 0–8 use 6, 8, 8, 4, 5, 8, 6, 6, 6 frames. V2 rows 9–10 contain 16 fixed clockwise look poses in 22.5° steps, starting at up. Required frames must contain visible pixels; unused cells are ignored.

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "My coding companion.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

Importer rejects unknown versions, wrong dimensions, paths or symlinks escaping the package, unsupported image formats, oversized files, and empty required cells. Only image data and metadata are imported; no package scripts or executable actions.

## Behavior

Thinking → review; text streaming → waving; active tools → running; blocking UI prompts → waiting; tool/model failures → failed; successful settled run → brief jump. Concurrent/nested tools are tracked separately. Failed or aborted runs never celebrate. Activity animations loop while their state remains active; reactions are brief.

Existing editor instances are decorated rather than replaced with a different implementation. Text editing, hardware cursor markers, history, autocomplete, and application shortcuts remain owned by Pi/current editor. Timers start only in interactive sessions and stop on shutdown/reload. No model calls or network requests.

## Verification

```sh
cd ~/.pi/agent
bun test ./tests/pets.test.ts
bun test ./tests/*.test.ts
```

After reload: import a real pet; preview each standard state and `look 0|90|180|270`; type multi-line and wide-character text; exercise autocomplete, Escape, resize, hide/show, and ANSI/reduced-motion modes.

Format sources: [V2 contract](https://github.com/MakerCore/hatch-pet/blob/main/references/codex-pet-contract.md), [animation rows](https://github.com/MakerCore/hatch-pet/blob/main/references/animation-rows.md).
