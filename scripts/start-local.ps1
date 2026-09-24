[CmdletBinding()]
param([switch]$NoApp)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$siteRoot = Join-Path $root 'site\emps-site-main'
$backend = Join-Path $siteRoot 'backend'

& (Join-Path $PSScriptRoot 'check-environment.ps1')

$lan = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Select-Object -First 1

Write-Host "LAN IPv4: $lan"
Write-Host 'Starting the existing MySQL container without deleting volumes...'
$dockerCandidates = @(
    (Get-Command docker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe')
) | Where-Object { $_ -and (Test-Path $_) }
$dockerCommand = $dockerCandidates | Select-Object -First 1
if (-not $dockerCommand) { throw 'Docker Desktop CLI was not found.' }
$containers = & $dockerCommand container ls -a --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Docker containers.' }
if ($containers -contains 'emps-mysql') {
    # Preserve the existing container, its credentials and its volume configuration.
    & $dockerCommand start emps-mysql
} else {
    & $dockerCommand compose -f (Join-Path $siteRoot 'docker-compose.yml') up -d mysql
}
if ($LASTEXITCODE -ne 0) { throw 'Unable to start MySQL.' }

Push-Location $backend
try {
    $arguments = @('scripts/start-ecosystem.cjs')
    $arguments += @('--repo-root', $root)
    if (-not $NoApp) { $arguments += '--with-app' }
    if ($lan) { $arguments += @('--lan-ip', $lan) }
    & node @arguments
} finally {
    Pop-Location
}
