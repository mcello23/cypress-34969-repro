function Get-ReproBaseUrl {
  param([switch]$PlainHttp)
  if ($PlainHttp) { 'http://localhost:3000' } else { 'https://localhost:3000' }
}

function Stop-LeftoverCypress {
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'Cypress.exe' -or ($_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*\Cypress\cy\*') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-ReproServer {
  param([string]$LogDir, [switch]$PlainHttp)
  foreach ($conn in @(Get-NetTCPConnection -State Listen -LocalPort 3000, 4000 -ErrorAction SilentlyContinue)) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
    if ($owner -and $owner.CommandLine -like '*node*server.js*' -and -not (Get-Process -Id $owner.ParentProcessId -ErrorAction SilentlyContinue)) {
      Write-Host "Stopping orphaned repro server $($owner.ProcessId)"
      Stop-Process -Id $owner.ProcessId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }
  }
  $busy = Get-NetTCPConnection -State Listen -LocalPort 3000, 4000 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($busy) {
    $name = (Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    if ($name -eq 'wslrelay') {
      throw "Port $($busy.LocalPort) is forwarded to WSL (wslrelay.exe): a server inside WSL is listening on it. Stop that server in WSL, or wait a minute for the forward to close, then retry."
    }
    throw "Port $($busy.LocalPort) is already used by $name (process $($busy.OwningProcess)). Is another repro.ps1/bisect.ps1/run-all.ps1 still running? Let it finish or stop that process first."
  }
  if ($PlainHttp) { $env:PLAIN_HTTP = '1' } else { Remove-Item Env:PLAIN_HTTP -ErrorAction SilentlyContinue }
  $env:REPRO_PARENT_PID = "$PID"
  $out = Join-Path $LogDir 'server.out.log'
  $server = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError (Join-Path $LogDir 'server.err.log')
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if ((Test-Path $out) -and ((Get-Content $out -Raw) -match 'idp ')) { return $server }
  }
  throw "server.js did not start, see $LogDir"
}

function Test-LogContains {
  param([string]$Path, [string]$Text)
  if (-not (Test-Path $Path)) { return $false }
  try {
    $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try { return (New-Object System.IO.StreamReader($fs)).ReadToEnd().Contains($Text) } finally { $fs.Dispose() }
  } catch {
    return $false
  }
}

function Invoke-CypressRun {
  param([string]$CypressArgs, [string]$LogBase, [int]$TimeoutMinutes, [string]$DebugNamespaces)
  $cmdLine = "set DEBUG=$DebugNamespaces&& npx cypress $CypressArgs 1> `"$LogBase.log`" 2> `"$LogBase.debug.txt`""
  $started = Get-Date
  $deadline = $started.AddMinutes($TimeoutMinutes)
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/d /s /c `"$cmdLine`"" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden
  $null = $p.Handle
  $disconnectedAt = $null
  while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
    if (-not $disconnectedAt -and (Test-LogContains "$LogBase.debug.txt" 'terminal disconnect for target')) {
      $disconnectedAt = Get-Date
    }
    if ($disconnectedAt -and ((Get-Date) - $disconnectedAt).TotalSeconds -ge 10) { break }
    Start-Sleep -Seconds 2
  }
  if ($p.HasExited) {
    $status = if ($p.ExitCode -eq 0) { 'PASS' } else { "FAIL (exit $($p.ExitCode))" }
  } else {
    taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null
    Stop-LeftoverCypress
    $status = if ($disconnectedAt) { 'HUNG (CDP target disconnected)' } else { "HUNG (no exit after $TimeoutMinutes min)" }
  }
  "$status after $([int]((Get-Date) - $started).TotalSeconds)s"
}
