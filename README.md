# BetterSnip

Lightweight Windows-first Electron snipping app.

## Features

- Tray-first app
- Global hotkey, default `Alt+Shift+S`
- Fullscreen overlay drag selection
- Saves crop as PNG/JPG
- Copies crop to clipboard
- Filename includes foreground app/window title when available:
  - `chrome-chatgpt-2026-05-04-14-30-22.png`
  - fallback: `screenshot-2026-05-04-14-30-22.png`
- macOS/Linux foreground detection stubs in `src/platform/foreground.js`

## Run

```bash
pnpm install
pnpm start
```

On first launch, choose the save folder. Change settings from the tray menu.
