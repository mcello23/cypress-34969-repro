param(
  [switch]$Http1,
  [switch]$PlainHttp,
  [int]$SpecTimeoutMinutes = 4,
  [string]$DebugNamespaces = 'cypress:*',
  [string]$Only = '',
  [string]$ExtraConfig = '',
  [string]$Tag = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$mode = 'bisect-' + $(if ($Http1) { 'http1' } else { 'native' }) + $(if ($PlainHttp) { '-plain' } else { '' }) + $(if ($Tag) { "-$Tag" } else { '' })
$forceHttp1 = if ($Http1) { 'true' } else { 'false' }
$extra = if ($ExtraConfig) { ",$ExtraConfig" } else { '' }
$baseUrl = Get-ReproBaseUrl -PlainHttp:$PlainHttp
$logDir = Join-Path $PSScriptRoot "logs\$mode"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Stop-LeftoverCypress
$server = Start-ReproServer -LogDir $logDir -PlainHttp:$PlainHttp

$results = @()
try {
  foreach ($spec in Get-ChildItem (Join-Path $PSScriptRoot "cypress\bisect\$Only*.cy.js") | Sort-Object Name) {
    $rel = "cypress/bisect/$($spec.Name)"
    $r = Invoke-CypressRun -CypressArgs "run --config-file cypress.bisect.config.js --browser chrome --spec $rel --config forceHttp1=$forceHttp1,baseUrl=$baseUrl$extra" `
      -LogBase (Join-Path $logDir $spec.BaseName) -TimeoutMinutes $SpecTimeoutMinutes -DebugNamespaces $DebugNamespaces
    $results += "$($spec.Name) : $r"
    Write-Host $results[-1]
  }
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:PLAIN_HTTP -ErrorAction SilentlyContinue
}

$results | Out-File -Encoding utf8 (Join-Path $logDir 'summary.txt')
Write-Host "Logs in $logDir"
