const { execFile } = require('child_process');
const os = require('os');

function sanitizePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function getWindowsForegroundApp() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$pidNum = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pidNum)
$sb = New-Object System.Text.StringBuilder 1024
[void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
try { $p = Get-Process -Id $pidNum -ErrorAction Stop; $name = $p.ProcessName } catch { $name = "" }
[PSCustomObject]@{ app=$name; title=$sb.ToString() } | ConvertTo-Json -Compress
`;

  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 2500 }, (err, stdout) => {
      if (err) return resolve({ app: '', title: '' });
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve({ app: parsed.app || '', title: parsed.title || '' });
      } catch {
        resolve({ app: '', title: '' });
      }
    });
  });
}

async function getForegroundApp() {
  if (process.platform === 'win32') return getWindowsForegroundApp();
  // TODO: implement macOS via AppleScript/NSWorkspace.
  // TODO: implement Linux via xdotool/wmctrl/portal where available.
  return { app: '', title: '' };
}

function buildForegroundSlug(info) {
  const app = sanitizePart(info?.app);
  const title = sanitizePart(info?.title);
  const parts = [];
  if (app) parts.push(app);
  if (title && title !== app) parts.push(title);
  return parts.join('-');
}

module.exports = { getForegroundApp, buildForegroundSlug, sanitizePart };
