param(
  [int]$Runs = 10,
  [switch]$Http1,
  [switch]$PlainHttp,
  [int]$RunTimeoutMinutes = 15,
  [string]$DebugNamespaces = 'cypress:*'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$mode = $(if ($Http1) { 'http1' } else { 'native' }) + $(if ($PlainHttp) { '-plain' } else { '' })
$forceHttp1 = if ($Http1) { 'true' } else { 'false' }
$baseUrl = Get-ReproBaseUrl -PlainHttp:$PlainHttp
$logDir = Join-Path $PSScriptRoot "logs\$mode"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

npx.cmd cypress info | Out-File -Encoding utf8 (Join-Path $logDir 'cypress-info.txt')
Stop-LeftoverCypress
$server = Start-ReproServer -LogDir $logDir -PlainHttp:$PlainHttp

$results = @()
try {
  for ($i = 1; $i -le $Runs; $i++) {
    $r = Invoke-CypressRun -CypressArgs "run --browser chrome --config forceHttp1=$forceHttp1,baseUrl=$baseUrl" `
      -LogBase (Join-Path $logDir "run-$i") -TimeoutMinutes $RunTimeoutMinutes -DebugNamespaces $DebugNamespaces
    $results += "run $i : $r"
    Write-Host $results[-1]
  }
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:PLAIN_HTTP -ErrorAction SilentlyContinue
}

$results | Out-File -Encoding utf8 (Join-Path $logDir 'summary.txt')
Write-Host "Logs in $logDir"
