# BetterSnip Agent Capture API Skill

Use this local HTTP API when an external AI agent needs to capture screenshots or short screen recordings from BetterSnip.

## Base URL

```text
http://127.0.0.1:47831
```

If BetterSnip was started with `BETTERSNIP_AGENT_PORT`, use that port instead.

## Health Check

```http
GET /health
```

PowerShell:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:47831/health"
```

Expected response:

```json
{ "ok": true, "app": "BetterSnip" }
```

## Capture Endpoint

```http
POST /capture
Content-Type: application/json
```

### Coordinate System

`rect` uses Electron absolute screen coordinates, matching BetterSnip overlay coordinates:

```ts
{
  x: number,
  y: number,
  width: number,
  height: number
}
```

Do not send monitor-relative physical pixels. BetterSnip converts Electron screen coordinates to monitor-relative native crop pixels internally.

If `rect` is omitted, BetterSnip captures the primary display bounds.

## Screenshot

### Save screenshot and return path

Recommended for most agent use because it avoids large base64 output.

```powershell
$body = @{
  kind = "screenshot"
  rect = @{ x = 0; y = 0; width = 800; height = 600 }
  save = $true
  returnType = "path"
  format = "png"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:47831/capture" `
  -ContentType "application/json" `
  -Body $body
```

### Return screenshot as base64 without saving

Only use this for small crops. Large captures produce very large responses.

```json
{
  "kind": "screenshot",
  "rect": { "x": 100, "y": 100, "width": 400, "height": 300 },
  "save": false,
  "returnType": "base64",
  "format": "png"
}
```

## Video Recording

Video capture records for `durationMs`, then stops automatically.

### Save video and return path

```powershell
$body = @{
  kind = "video"
  rect = @{ x = 100; y = 100; width = 800; height = 600 }
  durationMs = 5000
  save = $true
  returnType = "path"
  fps = 30
  bitrate = 8000000
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:47831/capture" `
  -ContentType "application/json" `
  -Body $body
```

### Return video as base64 without saving

Avoid this unless absolutely necessary. Prefer `save: true` and `returnType: "path"`.

```json
{
  "kind": "video",
  "rect": { "x": 100, "y": 100, "width": 800, "height": 600 },
  "durationMs": 3000,
  "save": false,
  "returnType": "base64",
  "fps": 30,
  "bitrate": 8000000
}
```

## Request Fields

```ts
type AgentCaptureOptions = {
  kind: "screenshot" | "video";
  rect?: { x: number; y: number; width: number; height: number };
  save?: boolean;
  returnType?: "path" | "base64";
  durationMs?: number;
  fps?: number;
  bitrate?: number;
  format?: "png" | "jpg" | "mp4";
};
```

### Defaults

- `rect`: primary display bounds
- `save`: `true`
- `returnType`: omit unless needed
- screenshot `format`: `png` unless `jpg` is supplied
- video `durationMs`: `3000`
- video `fps`: `30`
- video `bitrate`: `8000000`

## Response Fields

```ts
type AgentCaptureResult = {
  kind: "screenshot" | "video";
  mimeType: string;
  path?: string;
  base64?: string;
  requestedRect: Rect;
  displayBounds: Rect;
  scaleFactor: number;
  nativeCrop: Rect;
  outputWidth: number;
  outputHeight: number;
  durationMs?: number;
};
```

Example response:

```json
{
  "kind": "screenshot",
  "mimeType": "image/png",
  "requestedRect": { "x": 0, "y": 0, "width": 300, "height": 200 },
  "displayBounds": { "x": 0, "y": 0, "width": 2560, "height": 1440 },
  "scaleFactor": 1,
  "nativeCrop": { "x": 0, "y": 0, "width": 300, "height": 200 },
  "outputWidth": 300,
  "outputHeight": 200,
  "path": "F:\\BetterSnip\\agent-screenshot-2026-05-09-03-43-12.png"
}
```

## Agent Rules

1. Prefer `save: true` and `returnType: "path"` to avoid huge base64 responses.
2. Use `base64` only for small screenshots or when the caller explicitly needs inline data.
3. Keep screenshots reasonably small when returning base64.
4. Keep video durations short, usually 1–10 seconds.
5. `durationMs` is clamped by BetterSnip to a safe maximum.
6. Do not call video capture while another recording is active.
7. Rect coordinates are Electron screen coordinates, not monitor-relative native pixels.
8. If the API is unavailable, ask the user to open BetterSnip or check the configured port.

## Minimal Test

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:47831/health"

$body = @{
  kind = "screenshot"
  rect = @{ x = 0; y = 0; width = 300; height = 200 }
  save = $true
  returnType = "path"
  format = "png"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:47831/capture" `
  -ContentType "application/json" `
  -Body $body
```
