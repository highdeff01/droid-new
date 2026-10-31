$ErrorActionPreference = 'Stop'

$BridgeDir = $PSScriptRoot
$EnvironmentDir = Join-Path $env:LOCALAPPDATA 'Droid Assist\bridge-env'
$PythonExe = Join-Path $EnvironmentDir 'Scripts\python.exe'

if (-not (Test-Path $PythonExe)) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($PyLauncher) {
    & $PyLauncher.Source -3 -m venv $EnvironmentDir
  } else {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) {
      throw 'Python 3 is required. Install Python for Windows, then run this script again.'
    }
    & $Python.Source -m venv $EnvironmentDir
  }
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not create the Python virtual environment.'
  }
}

& $PythonExe -m pip install --disable-pip-version-check -r (Join-Path $BridgeDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) {
  throw 'Could not install the desktop bridge dependency.'
}
if (-not $env:DROID_BRIDGE_TOKEN) {
  $SecureToken = Read-Host 'Enter the bridge auth token from Droid Assist Settings' -AsSecureString
  $TokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
  try {
    $env:DROID_BRIDGE_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPointer)
  }
}

$env:DROID_BRIDGE_HOST = '127.0.0.1'
$env:DROID_BRIDGE_PORT = '3000'
& $PythonExe (Join-Path $BridgeDir 'droid_bridge.py')
