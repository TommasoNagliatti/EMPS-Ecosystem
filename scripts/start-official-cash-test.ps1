[CmdletBinding()]
param([Parameter(Mandatory=$true)][DateTimeOffset]$SandboxVerifiedUntil)
$ErrorActionPreference = 'Stop'
$remaining = $SandboxVerifiedUntil - [DateTimeOffset]::UtcNow
if ($remaining.TotalSeconds -le 0 -or $remaining.TotalHours -gt 24) { throw 'Recheck that the official gateway is in sandbox before enabling this temporary test.' }
$frontend = Join-Path (Split-Path -Parent $PSScriptRoot) 'site/emps-site-main/frontend'
if (Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3010 is in use. Stop only the managed local preview before starting this profile.' }
$names = @('EMPS_OFFICIAL_TEST_BRIDGE','NEXT_PUBLIC_EMPS_OFFICIAL_TEST_BRIDGE','EMPS_SANDBOX_VERIFIED_UNTIL','NEXT_PUBLIC_EMPS_DEMO_MODE','NEXT_PUBLIC_EMPS_READ_ONLY','EMPS_LOCAL_PREVIEW')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
Push-Location $frontend
try {
    $env:EMPS_OFFICIAL_TEST_BRIDGE = 'true'
    $env:NEXT_PUBLIC_EMPS_OFFICIAL_TEST_BRIDGE = 'true'
    $env:EMPS_SANDBOX_VERIFIED_UNTIL = $SandboxVerifiedUntil.ToUniversalTime().ToString('o')
    $env:NEXT_PUBLIC_EMPS_DEMO_MODE = 'false'
    $env:NEXT_PUBLIC_EMPS_READ_ONLY = 'true'
    $env:EMPS_LOCAL_PREVIEW = 'true'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; no test profile was started.' }
    Write-Host ('Official cash test: station 13 only; sandbox verification expires ' + $env:EMPS_SANDBOX_VERIFIED_UNTIL)
    & npm run start -- --hostname 127.0.0.1 --port 3010
    if ($LASTEXITCODE -ne 0) { throw 'Local test site stopped with an error.' }
} finally {
    Pop-Location
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
}
