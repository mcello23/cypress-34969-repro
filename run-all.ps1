param(
  [int]$TimeoutMinutes = 4,
  [string]$DebugNamespaces = 'cypress:*'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$variants = @(
  @{ Name = 'native, TLS + HTTP/2, 8 MB'; Expect = 'HUNG'; Http1 = $false; Env = @{} },
  @{ Name = 'forceHttp1, TLS + HTTP/2, 8 MB'; Expect = 'PASS'; Http1 = $true; Env = @{} },
  @{ Name = 'native, TLS + HTTP/2, 4 MB'; Expect = 'HUNG'; Http1 = $false; Env = @{ APP_BUNDLE_MB = '4' } },
  @{ Name = 'native, TLS + HTTP/2, 2 MB'; Expect = 'PASS'; Http1 = $false; Env = @{ APP_BUNDLE_MB = '2' } },
  @{ Name = 'native, TLS + HTTP/2, 1 MB'; Expect = 'PASS'; Http1 = $false; Env = @{ APP_BUNDLE_MB = '1' } },
  @{ Name = 'native, TLS + HTTP/1.1 only, 8 MB'; Expect = 'HUNG'; Http1 = $false; Env = @{ TLS_HTTP1 = '1' } },
  @{ Name = 'native, plain HTTP/1.1, 8 MB'; Expect = 'HUNG'; Http1 = $false; Env = @{ PLAIN_HTTP = '1' } },
  @{ Name = 'native, modifyObstructiveCode=false, 8 MB'; Expect = 'PASS'; Http1 = $false; Env = @{}; Extra = 'modifyObstructiveCode=false' },
  @{ Name = 'full flow (cy.session login, 15 specs), native'; Expect = 'HUNG'; Http1 = $false; Env = @{}; Full = $true },
  @{ Name = 'full flow (cy.session login, 15 specs), forceHttp1'; Expect = 'PASS'; Http1 = $true; Env = @{}; Full = $true }
)

$root = Join-Path $PSScriptRoot 'logs\run-all'
New-Item -ItemType Directory -Force -Path $root | Out-Null
npx.cmd cypress info | Out-File -Encoding utf8 (Join-Path $root 'cypress-info.txt')
Stop-LeftoverCypress

$rows = @()
$i = 0
foreach ($v in $variants) {
  $i++
  $dir = Join-Path $root ('{0:D2}' -f $i)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  foreach ($k in 'APP_BUNDLE_MB', 'TLS_HTTP1', 'PLAIN_HTTP') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
  foreach ($k in $v.Env.Keys) { Set-Item "Env:$k" $v.Env[$k] }
  $plain = $v.Env.ContainsKey('PLAIN_HTTP')
  $baseUrl = Get-ReproBaseUrl -PlainHttp:$plain
  $config = "forceHttp1=$(if ($v.Http1) { 'true' } else { 'false' }),baseUrl=$baseUrl"
  if ($v.Extra) { $config += ",$($v.Extra)" }
  $cypressArgs = if ($v.Full) { "run --browser chrome --config $config" } else { "run --config-file cypress.bisect.config.js --browser chrome --spec cypress/bisect/02-visit-app-bundle.cy.js --config $config" }

  Write-Host -NoNewline ("[{0,2}/{1}] {2,-52} " -f $i, $variants.Count, $v.Name)
  $server = Start-ReproServer -LogDir $dir -PlainHttp:$plain
  try {
    $result = Invoke-CypressRun -CypressArgs $cypressArgs -LogBase (Join-Path $dir 'run') -TimeoutMinutes $TimeoutMinutes -DebugNamespaces $DebugNamespaces
  } finally {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  $actual = ($result -split ' ')[0]
  $match = if ($actual -eq $v.Expect) { 'as expected' } else { 'UNEXPECTED' }
  Write-Host "$result  [$match]"
  $rows += [pscustomobject]@{ '#' = $i; Variant = $v.Name; Expected = $v.Expect; Result = $result; Check = $match; Logs = "logs\run-all\$('{0:D2}' -f $i)" }
}
foreach ($k in 'APP_BUNDLE_MB', 'TLS_HTTP1', 'PLAIN_HTTP') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }

$rows | Format-Table -AutoSize | Out-String -Width 200 | Tee-Object -FilePath (Join-Path $root 'summary.txt')
$unexpected = @($rows | Where-Object Check -eq 'UNEXPECTED').Count
Write-Host $(if ($unexpected) { "$unexpected variant(s) did not match the expected result" } else { 'All variants matched the expected result' })
