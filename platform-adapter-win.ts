import { spawn } from 'node:child_process';
import type { PlatformAdapter } from './platform-adapter.js';
import { CoordinateError, TransientOSError } from './input-errors.js';
import type { WorkflowStep } from './types.js';

/** PowerShell uses SendInput for input and user32 queries for cursor/window state. */
const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class DroidNativeInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

  public static void Send(INPUT[] inputs) {
    if (inputs.Length == 0) return;
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows rejected one or more input events");
  }
  public static void Move(int x, int y) {
    int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
    int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
    if (width < 1 || height < 1) throw new InvalidOperationException("Windows returned invalid virtual screen dimensions");
    var mi = new MOUSEINPUT();
    mi.dx = width == 1 ? 0 : (int)Math.Round((x - left) * 65535.0 / (width - 1));
    mi.dy = height == 1 ? 0 : (int)Math.Round((y - top) * 65535.0 / (height - 1));
    mi.dwFlags = 0x0001 | 0x4000 | 0x8000;
    var union = new INPUTUNION();
    union.mi = mi;
    var input = new INPUT();
    input.type = 0;
    input.U = union;
    Send(new INPUT[] { input });
  }
  public static POINT Position() {
    POINT point;
    if (!GetCursorPos(out point)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetCursorPos failed");
    return point;
  }
  public static string ActiveWindow() {
    var text = new StringBuilder(1024);
    GetWindowText(GetForegroundWindow(), text, text.Capacity);
    return text.ToString();
  }
}
'@

function New-MouseInput([uint32]$flags, [uint32]$data = 0) {
  $mi = [DroidNativeInput+MOUSEINPUT]::new()
  $mi.mouseData = $data
  $mi.dwFlags = $flags
  $u = [DroidNativeInput+INPUTUNION]::new()
  $u.mi = $mi
  $i = [DroidNativeInput+INPUT]::new()
  $i.type = 0
  $i.U = $u
  return $i
}
function New-KeyInput([uint16]$vk, [uint16]$scan, [uint32]$flags) {
  $ki = [DroidNativeInput+KEYBDINPUT]::new()
  $ki.wVk = $vk
  $ki.wScan = $scan
  $ki.dwFlags = $flags
  $u = [DroidNativeInput+INPUTUNION]::new()
  $u.ki = $ki
  $i = [DroidNativeInput+INPUT]::new()
  $i.type = 1
  $i.U = $u
  return $i
}
function Move-Smooth([int]$x, [int]$y, [int]$durationMs) {
  if ($durationMs -le 0) { [DroidNativeInput]::Move($x, $y); return }
  $start = [DroidNativeInput]::Position()
  $steps = [Math]::Max(1, [Math]::Ceiling($durationMs / 16))
  for ($i = 1; $i -le $steps; $i++) {
    $ratio = $i / $steps
    [DroidNativeInput]::Move([int][Math]::Round($start.X + (($x - $start.X) * $ratio)), [int][Math]::Round($start.Y + (($y - $start.Y) * $ratio)))
    if ($i -lt $steps) { Start-Sleep -Milliseconds ([Math]::Max(1, [int]($durationMs / $steps))) }
  }
}
function Get-VirtualKey([string]$name) {
  $key = $name.Trim().ToLowerInvariant()
  $names = @{
    ctrl=0x11; control=0x11; shift=0x10; alt=0x12; win=0x5B; meta=0x5B; command=0x5B
    enter=0x0D; return=0x0D; tab=0x09; esc=0x1B; escape=0x1B; space=0x20
    backspace=0x08; delete=0x2E; del=0x2E; insert=0x2D; home=0x24; end=0x23
    pageup=0x21; pagedown=0x22; up=0x26; down=0x28; left=0x25; right=0x27
    capslock=0x14; printscreen=0x2C; pause=0x13; playpause=0xB3; nexttrack=0xB0; prevtrack=0xB1
    volumeup=0xAF; volumedown=0xAE; mute=0xAD
  }
  if ($names.ContainsKey($key)) { return [uint16]$names[$key] }
  if ($key.Length -eq 1 -and $key -match '[a-z0-9]') { return [uint16][char]$key.ToUpperInvariant() }
  if ($key -match '^f([1-9]|1[0-9]|2[0-4])$') { return [uint16](0x70 + [int]$Matches[1] - 1) }
  throw "Unsupported key name: $name"
}

try {
  [Console]::InputEncoding = [System.Text.Encoding]::UTF8
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  switch ($payload.action) {
    'move' { Move-Smooth ([int]$payload.x) ([int]$payload.y) ([int]$payload.durationMs) }
    'click' {
      [DroidNativeInput]::Move([int]$payload.x, [int]$payload.y)
      $flags = switch ($payload.button) { right { @(0x0008,0x0010) } middle { @(0x0020,0x0040) } default { @(0x0002,0x0004) } }
      [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput $flags[0]), (New-MouseInput $flags[1])))
    }
    'doubleClick' {
      [DroidNativeInput]::Move([int]$payload.x, [int]$payload.y)
      [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput 0x0002),(New-MouseInput 0x0004),(New-MouseInput 0x0002),(New-MouseInput 0x0004)))
    }
    'drag' {
      [DroidNativeInput]::Move([int]$payload.x, [int]$payload.y)
      [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput 0x0002)))
      try { Move-Smooth ([int]$payload.endX) ([int]$payload.endY) ([int]$payload.durationMs) }
      finally { [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput 0x0004))) }
    }
    'pressMouse' { [DroidNativeInput]::Move([int]$payload.x, [int]$payload.y); [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput 0x0002))) }
    'scroll' {
      [DroidNativeInput]::Move([int]$payload.x, [int]$payload.y)
      $delta = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$payload.deltaY * 120), 0)
      [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput 0x0800 $delta)))
    }
    'releaseMouse' {
      $flag = switch ($payload.button) { right { 0x0010 } middle { 0x0040 } default { 0x0004 } }
      [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@((New-MouseInput $flag)))
    }
    'keyPress' {
      $parts = @($payload.combo -split '\+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
      if ($parts.Count -eq 0) { throw 'Key combination is empty' }
      $events = [System.Collections.Generic.List[DroidNativeInput+INPUT]]::new()
      if ($parts.Count -gt 1) { for ($i = 0; $i -lt ($parts.Count - 1); $i++) { $events.Add((New-KeyInput (Get-VirtualKey $parts[$i]) 0 0)) } }
      $vk = Get-VirtualKey $parts[-1]
      $events.Add((New-KeyInput $vk 0 0)); $events.Add((New-KeyInput $vk 0 2))
      if ($parts.Count -gt 1) { for ($i = $parts.Count - 2; $i -ge 0; $i--) { $events.Add((New-KeyInput (Get-VirtualKey $parts[$i]) 0 2)) } }
      [DroidNativeInput]::Send($events.ToArray())
    }
    'keyRelease' {
      $events = foreach ($key in ($payload.combo -split '\+')) { New-KeyInput (Get-VirtualKey $key) 0 2 }
      [DroidNativeInput]::Send([DroidNativeInput+INPUT[]]@($events))
    }
    'type' {
      $events = [System.Collections.Generic.List[DroidNativeInput+INPUT]]::new()
      foreach ($character in ([string]$payload.text).ToCharArray()) {
        $events.Add((New-KeyInput 0 ([uint16][char]$character) 4))
        $events.Add((New-KeyInput 0 ([uint16][char]$character) 6))
      }
      [DroidNativeInput]::Send($events.ToArray())
    }
    'position' {
      $point = [DroidNativeInput]::Position()
      ConvertTo-Json -Compress @{ x=$point.X; y=$point.Y }
    }
    'activeWindow' { ConvertTo-Json -Compress ([DroidNativeInput]::ActiveWindow()) }
    default { throw "Unsupported native input action: $($payload.action)" }
  }
} catch {
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  [Console]::Error.WriteLine($failure.Message)
  exit 1
}
`;

const POWERSHELL_COMMAND = Buffer.from(POWERSHELL, 'utf16le').toString('base64');

/** Sends a JSON payload over stdin so typed text never appears in the PowerShell command line. */
function nativeCall(action: string, values: Record<string, unknown> = {}): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows native input is available only on Windows'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', POWERSHELL_COMMAND], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout.trim());
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Windows input command timed out'));
    }, 15_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => finish(new Error(`Could not start Windows input helper: ${error.message}`)));
    child.once('close', (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `Windows input helper exited with code ${code}`)));
    child.stdin.end(JSON.stringify({ action, ...values }));
  });
}

/** Windows desktop input through user32.SendInput; uses physical virtual-desktop coordinates. */
export class WindowsPlatformAdapter implements PlatformAdapter {
  private availability?: Promise<boolean>;

  constructor(private readonly invokeNative: (action: string, values?: Record<string, unknown>) => Promise<string> = nativeCall) {}

  async mouseMove(x: number, y: number, durationMs = 0): Promise<void> {
    this.validateCoordinates(x, y);
    try { await this.invokeNative('move', { x, y, durationMs }); }
    catch (error) { throw new TransientOSError(`Failed to move the mouse: ${errorText(error)}`, this.createWorkflowStep('move')); }
  }

  async mouseClick(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    this.validateCoordinates(x, y);
    try {
      await this.invokeNative('click', { x, y, button });
    } catch (error) {
      if (error instanceof RangeError) throw new CoordinateError('Invalid click position', this.createWorkflowStep('click'), x, y);
      throw new TransientOSError(`Failed to click: ${errorText(error)}`, this.createWorkflowStep('click'));
    }
  }

  async mouseDoubleClick(x: number, y: number): Promise<void> {
    this.validateCoordinates(x, y);
    try { await this.invokeNative('doubleClick', { x, y }); }
    catch (error) { throw new TransientOSError(`Failed to double-click: ${errorText(error)}`, this.createWorkflowStep('double_click')); }
  }

  async mouseDrag(startX: number, startY: number, endX: number, endY: number, durationMs = 0): Promise<void> {
    this.validateCoordinates(startX, startY);
    this.validateCoordinates(endX, endY);
    try { await this.invokeNative('drag', { x: startX, y: startY, endX, endY, durationMs }); }
    catch (error) { throw new TransientOSError(`Failed to drag: ${errorText(error)}`, this.createWorkflowStep('drag')); }
  }

  async mouseScroll(x: number, y: number, deltaY: number): Promise<void> {
    this.validateCoordinates(x, y);
    if (!Number.isFinite(deltaY)) throw new RangeError(`Invalid scroll amount: ${deltaY}`);
    try { await this.invokeNative('scroll', { x, y, deltaY }); }
    catch (error) { throw new TransientOSError(`Failed to scroll: ${errorText(error)}`, this.createWorkflowStep('scroll')); }
  }

  async mouseRelease(button?: 'left' | 'right' | 'middle'): Promise<void> {
    const buttons = button ? [button] : ['left', 'right', 'middle'] as const;
    for (const held of buttons) {
      await this.invokeNative('releaseMouse', { button: held });
    }
  }

  async mouseDown(x: number, y: number): Promise<void> {
    this.validateCoordinates(x, y);
    try { await this.invokeNative('pressMouse', { x, y }); }
    catch (error) { throw new TransientOSError(`Failed to press the mouse button: ${errorText(error)}`, this.createWorkflowStep('mouse_down')); }
  }

  async keyPress(keyCombo: string): Promise<void> {
    try { await this.invokeNative('keyPress', { combo: keyCombo }); }
    catch (error) { throw new TransientOSError(`Failed to send key combination "${keyCombo}": ${errorText(error)}`, this.createWorkflowStep('key')); }
  }

  async keyRelease(keyCombo: string): Promise<void> {
    try { await this.invokeNative('keyRelease', { combo: keyCombo }); }
    catch (error) { throw new TransientOSError(`Failed to release key combination "${keyCombo}": ${errorText(error)}`, this.createWorkflowStep('key')); }
  }

  async typeText(text: string): Promise<void> {
    try { await this.invokeNative('type', { text }); }
    catch (error) { throw new TransientOSError(`Failed to type text: ${errorText(error)}`, this.createWorkflowStep('type')); }
  }

  async getMousePosition(): Promise<{ x: number; y: number }> {
    try { return JSON.parse(await this.invokeNative('position')) as { x: number; y: number }; }
    catch (error) { throw new TransientOSError(`Failed to get mouse position: ${errorText(error)}`, this.createWorkflowStep('measure')); }
  }

  async getActiveWindow(): Promise<string> {
    try { return JSON.parse(await this.invokeNative('activeWindow')) as string; }
    catch (error) { throw new TransientOSError(`Failed to get active window: ${errorText(error)}`, this.createWorkflowStep('active-window')); }
  }

  async isAvailable(): Promise<boolean> {
    this.availability ??= this.invokeNative('position').then(() => true, () => false);
    return this.availability;
  }

  private validateCoordinates(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`Invalid coordinates: (${x}, ${y})`);
    if (x < -1000 || y < -1000 || x > 10000 || y > 10000) throw new RangeError(`Coordinates out of bounds: (${x}, ${y})`);
  }

  private createWorkflowStep(action: string): WorkflowStep {
    return { id: 'temp', name: action, action: action as WorkflowStep['action'], x: 0, y: 0, status: 'pending' };
  }
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function getWindowsAdapter(): WindowsPlatformAdapter {
  return new WindowsPlatformAdapter();
}
