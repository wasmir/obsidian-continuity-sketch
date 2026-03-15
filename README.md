# Continuity Sketch for Obsidian

Draw on a nearby iPad with Apple Pencil via Apple Continuity Sketch and insert the image into your note.

**macOS only.** Requires macOS 12.0+.

## Prerequisites

Install the helper binary ([boofa-sketch](https://github.com/wasmir/boofa-sketch)):

```bash
brew install wasmir/tap/boofa-sketch
```

## Usage

1. Open a note in Obsidian
2. `Cmd+P` → "Add Sketch from iPad"
3. Select your iPad from the Continuity menu
4. Draw with Apple Pencil, tap Done
5. The sketch is inserted at the cursor position

## Settings

- **Custom binary path**: Override the auto-detected path to `boofa-sketch`. Leave empty to auto-detect from PATH and Homebrew locations.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

To test locally, symlink or copy `main.js` and `manifest.json` into your vault:

```bash
VAULT="$HOME/path/to/vault"
mkdir -p "$VAULT/.obsidian/plugins/continuity-sketch"
ln -sf "$(pwd)/main.js" "$VAULT/.obsidian/plugins/continuity-sketch/main.js"
ln -sf "$(pwd)/manifest.json" "$VAULT/.obsidian/plugins/continuity-sketch/manifest.json"
```

Then enable "Continuity Sketch" in Obsidian Settings → Community Plugins.
