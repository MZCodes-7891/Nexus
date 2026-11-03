const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WINDOWS_DND_SCRIPT = String.raw`param([ValidateSet('on','off','query','toggle')][string]$DesiredState = 'query')
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$keysLoaded = $false
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexusModeKeys {
  public delegate bool EnumWindowsCallback(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public static void Chord(byte key) { keybd_event(0x5B,0,0,UIntPtr.Zero); keybd_event(key,0,0,UIntPtr.Zero); keybd_event(key,0,2,UIntPtr.Zero); keybd_event(0x5B,0,2,UIntPtr.Zero); }
  public static void Escape() { keybd_event(0x1B,0,0,UIntPtr.Zero); keybd_event(0x1B,0,2,UIntPtr.Zero); }
  public static IntPtr[] FindVisibleWindows(uint wantedPid) {
    var result = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((hWnd, lParam) => { uint pid; GetWindowThreadProcessId(hWnd, out pid); if (pid == wantedPid && IsWindowVisible(hWnd)) result.Add(hWnd); return true; }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
  $keysLoaded = $true
  function Find-DndToggle {
    foreach ($processName in @('ShellExperienceHost','explorer','StartMenuExperienceHost')) {
      foreach ($process in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
        foreach ($handle in [NexusModeKeys]::FindVisibleWindows([uint32]$process.Id)) {
          try { $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle); $windowName = [string]$window.Current.Name } catch { continue }
          if ($processName -ne 'ShellExperienceHost' -and $windowName -notmatch '(?i)notification center|action center|quick settings') { continue }
          try { $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } catch { continue }
          foreach ($element in $elements) {
            try { $name = [string]$element.Current.Name } catch { continue }
            if ($name -match '(?i)do not disturb|focus assist') {
              $pattern = $null
              if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { return @{ Element = $element; Pattern = $pattern; Name = $name } }
            }
          }
        }
      }
    }
    return $null
  }
  $found = $null
  foreach ($shortcut in @(0x4E,0x41)) {
    [NexusModeKeys]::Chord([byte]$shortcut)
    for ($attempt = 0; $attempt -lt 8 -and $null -eq $found; $attempt++) {
      Start-Sleep -Milliseconds 125
      $found = Find-DndToggle
    }
    if ($null -ne $found) { break }
    [NexusModeKeys]::Escape()
    Start-Sleep -Milliseconds 100
  }
  if ($null -eq $found) { throw 'Windows opened its notification panel, but did not expose a Do not disturb switch.' }
  $enabled = [int]$found.Pattern.Current.ToggleState -eq 1
  $changed = $false
  if ($DesiredState -ne 'query') {
    $target = if ($DesiredState -eq 'toggle') { -not $enabled } else { $DesiredState -eq 'on' }
    if ($enabled -ne $target) { $found.Pattern.Toggle(); $changed = $true }
    Start-Sleep -Milliseconds 200
    $updatedPattern = $found.Element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $enabled = [int]$updatedPattern.Current.ToggleState -eq 1
    if ($enabled -ne $target) { throw 'Windows did not confirm the requested Do not disturb state.' }
  }
  @{ ok = $true; enabled = $enabled; changed = $changed } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($keysLoaded) { [NexusModeKeys]::Escape() }
}
`;

function createWindowsDnd({ dataDir }) {
async function setWindowsDoNotDisturb(desiredState) {
  if (process.platform !== 'win32') return { ok: false, message: 'One-click Do Not Disturb is available on Windows.' };
  const desired = desiredState === null ? 'query' : desiredState === 'toggle' ? 'toggle' : desiredState ? 'on' : 'off';
  const scriptPath = path.join(dataDir, `nexus-dnd-${crypto.randomUUID()}.ps1`);
  try {
    await fs.promises.writeFile(scriptPath, WINDOWS_DND_SCRIPT, { encoding: 'utf8', mode: 0o600 });
    const { error, stdout, stderr } = await new Promise(resolve => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, desired], { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
    let result;
    try { result = JSON.parse(line || '{}'); } catch {}
    if (error || !result?.ok) return { ok: false, message: String(result?.message || stderr || error?.message || 'Windows Do Not Disturb could not be changed.').trim().slice(0, 500) };
    return result;
  } catch (error) {
    return { ok: false, message: `Windows Do Not Disturb failed: ${String(error.message || error).slice(0, 350)}` };
  } finally { await fs.promises.unlink(scriptPath).catch(() => {}); }
}
  return setWindowsDoNotDisturb;
}

module.exports = { createWindowsDnd };
