const { execFile } = require('child_process');

function run(file, args, options = {}) {
  return new Promise(resolve => execFile(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}
function validImageName(name) {
  const value = String(name || '').trim();
  if (!/^[\w .()+-]{1,80}$/.test(value)) throw new Error('That is not a valid program name.');
  return /\.exe$/i.test(value) ? value : `${value}.exe`;
}
const PROTECTED = new Set(['csrss.exe', 'wininit.exe', 'winlogon.exe', 'lsass.exe', 'services.exe', 'smss.exe', 'svchost.exe', 'explorer.exe', 'dwm.exe', 'system', 'registry']);

// Lists apps that have a visible window, which is what "running apps" means to a person.
async function listRunningApps() {
  const { error, stdout, stderr } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,Id,MainWindowTitle | ConvertTo-Json -Compress"]);
  if (error) throw new Error(stderr.trim() || error.message);
  const parsed = JSON.parse(stdout.trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({ name: item.ProcessName, pid: item.Id, title: item.MainWindowTitle }));
}
// Graceful close only (no /F): the app gets to prompt about unsaved work.
async function closeApp(name) {
  const image = validImageName(name);
  if (PROTECTED.has(image.toLowerCase())) throw new Error(`${image} is a Windows system process and cannot be closed by Nexus.`);
  const { error, stdout, stderr } = await run('taskkill.exe', ['/IM', image]);
  if (error) return { ok: false, error: (stderr || stdout || error.message).trim().slice(0, 300) };
  return { ok: true, message: `Asked ${image} to close. It may prompt about unsaved work.` };
}
// Scripts run only if the user added them in Settings. The agent picks one by id and cannot supply a path or arguments.
async function runApprovedScript(script) {
  const file = String(script.path || '');
  const isPowerShell = /\.ps1$/i.test(file);
  const { error, stdout, stderr } = isPowerShell
    ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file], { timeout: 120000 })
    : /\.py$/i.test(file) ? await run(require('../core/python').resolvePython(), [file], { timeout: 120000 })
    : /\.(bat|cmd)$/i.test(file) ? await run('cmd.exe', ['/d', '/c', file], { timeout: 120000 })
    : { error: new Error('Approved scripts must be .ps1, .py, .bat, or .cmd files.'), stdout: '', stderr: '' };
  if (error) return { ok: false, error: (stderr || error.message).trim().slice(0, 800), output: stdout.slice(0, 2000) };
  return { ok: true, message: `Ran ${script.name}.`, output: stdout.slice(0, 4000) };
}

// Windows UI Automation for apps with no API. The window and control names travel in environment variables, so they cannot inject into the script.
const UIA_PRELUDE = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::RootElement
$windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
# The program's own name is the best match; any window can have a word in its title.
$window=$null
foreach($w in $windows){ try{ if((Get-Process -Id $w.Current.ProcessId -ErrorAction Stop).ProcessName -eq $env:NEXUS_UIA_WINDOW){ $window=$w; break } }catch{} }
if(-not $window){ foreach($w in $windows){ if($w.Current.Name -like ($env:NEXUS_UIA_WINDOW+'*')){ $window=$w; break } } }
if(-not $window){ foreach($w in $windows){ if($w.Current.Name -like ('*'+$env:NEXUS_UIA_WINDOW+'*')){ $window=$w; break } } }
if(-not $window){ throw ('No open window matches: '+$env:NEXUS_UIA_WINDOW) }
$all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
# Older Windows programs show almost nothing to UI Automation, so their controls are also reached the classic way.
Add-Type -TypeDefinition 'using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;public static class NexusWin32{public delegate bool Cb(IntPtr h,IntPtr l);[DllImport("user32.dll")]public static extern bool EnumChildWindows(IntPtr p,Cb c,IntPtr l);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,StringBuilder l);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);public static List<IntPtr> Kids(IntPtr p){var r=new List<IntPtr>();EnumChildWindows(p,(h,l)=>{r.Add(h);return true;},IntPtr.Zero);return r;}public static string Cls(IntPtr h){var c=new StringBuilder(128);GetClassName(h,c,128);return c.ToString();}public static string Txt(IntPtr h){var t=new StringBuilder(4096);SendMessage(h,13,(IntPtr)4096,t);return t.ToString();}}'
$native=[IntPtr]$window.Current.NativeWindowHandle
$kids=@(); if($native -ne [IntPtr]::Zero){ $kids=[NexusWin32]::Kids($native) }
`;
const UIA_LIST = `${UIA_PRELUDE}
$out=@(); $n=0
foreach($e in $all){ if($n -ge 150){break}; try{ $name=$e.Current.Name; $type=$e.Current.ControlType.ProgrammaticName -replace 'ControlType\\.',''; if($name -and $e.Current.IsEnabled){ $out+=@{name=$name;type=$type}; $n++ } }catch{} }
foreach($k in $kids){ if($n -ge 150){break}; $c=[NexusWin32]::Cls($k); if($c -match 'Edit|Button|ComboBox|Static'){ $t=[NexusWin32]::Txt($k); $out+=@{name=$(if($t.Length -gt 200){$t.Substring(0,200)}else{$t}); type=$c}; $n++ } }
@{ ok=$true; window=$window.Current.Name; controls=$out } | ConvertTo-Json -Compress -Depth 4`;
const UIA_ACT = `${UIA_PRELUDE}
$target=$null
if($env:NEXUS_UIA_CONTROL){ foreach($e in $all){ try{ if($e.Current.Name -eq $env:NEXUS_UIA_CONTROL){ $target=$e; break } }catch{} } }
if(-not $target -and $env:NEXUS_UIA_ACTION -eq 'set'){ foreach($e in $all){ try{ if($e.Current.ControlType.ProgrammaticName -match 'Edit|Document'){ $target=$e; break } }catch{} } }
if(-not $target){
  # The classic way, for older programs.
  if($env:NEXUS_UIA_ACTION -eq 'set'){
    $edit=$kids|Where-Object{[NexusWin32]::Cls($_) -match 'Edit'}|Select-Object -First 1
    if($edit){ [void][NexusWin32]::SendMessage($edit,12,[IntPtr]::Zero,[string]$env:NEXUS_UIA_VALUE); if([NexusWin32]::Txt($edit) -eq $env:NEXUS_UIA_VALUE){ @{ ok=$true; message='Text entered.' }|ConvertTo-Json -Compress; exit } }
  } else {
    $button=$kids|Where-Object{[NexusWin32]::Cls($_) -match 'Button' -and ([NexusWin32]::Txt($_) -replace '&','') -eq $env:NEXUS_UIA_CONTROL}|Select-Object -First 1
    if($button){ [void][NexusWin32]::SendMessage($button,245,[IntPtr]::Zero,[string]$null); @{ ok=$true; message=('Clicked '+$env:NEXUS_UIA_CONTROL) }|ConvertTo-Json -Compress; exit }
    if($env:NEXUS_UIA_CONTROL -eq 'Close' -and $native -ne [IntPtr]::Zero){ [void][NexusWin32]::PostMessage($native,16,[IntPtr]::Zero,[IntPtr]::Zero); @{ ok=$true; message='Asked the window to close.' }|ConvertTo-Json -Compress; exit }
  }
  throw ('No control named: '+$env:NEXUS_UIA_CONTROL)
}
$p=$null
if($env:NEXUS_UIA_ACTION -eq 'set'){
  if($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){ $p.SetValue($env:NEXUS_UIA_VALUE) } else { throw 'That control does not accept text.' }
} else {
  if($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)){ $p.Invoke() }
  elseif($target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)){ $p.Toggle() }
  elseif($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)){ $p.Select() }
  else { throw 'That control cannot be clicked through UI Automation.' }
}
@{ ok=$true; message=('Done: '+$env:NEXUS_UIA_ACTION+' on '+$target.Current.Name) } | ConvertTo-Json -Compress`;
async function uia(script, env) {
  const { stdout, stderr, error } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { env: { ...process.env, ...env }, timeout: 30000 });
  const line = stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(line); }
  catch { return { ok: false, error: (stderr || error?.message || 'UI Automation failed.').split(/\r?\n/)[0].slice(0, 300) }; }
}
const uiListControls = window => uia(UIA_LIST, { NEXUS_UIA_WINDOW: String(window) });
const uiClick = (window, control) => uia(UIA_ACT, { NEXUS_UIA_WINDOW: String(window), NEXUS_UIA_CONTROL: String(control), NEXUS_UIA_ACTION: 'click' });
const uiSetText = (window, control, value) => uia(UIA_ACT, { NEXUS_UIA_WINDOW: String(window), NEXUS_UIA_CONTROL: String(control || ''), NEXUS_UIA_ACTION: 'set', NEXUS_UIA_VALUE: String(value) });

module.exports = { listRunningApps, closeApp, runApprovedScript, uiListControls, uiClick, uiSetText, validImageName };
