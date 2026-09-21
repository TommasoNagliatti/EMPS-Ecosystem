[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$missing = @()

foreach ($command in @('node', 'npm', 'py')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        $missing += $command
    }
}

$dockerCandidates = @(
    (Get-Command docker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe')
) | Where-Object { $_ -and (Test-Path $_) }
$dockerCommand = $dockerCandidates | Select-Object -First 1
if (-not $dockerCommand) { throw 'Docker Desktop CLI was not found.' }

if ($missing.Count -gt 0) {
    throw "Missing required commands: $($missing -join ', ')"
}

$pythonVersion = & py -3.12 --version 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required.' }

& $dockerCommand info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is installed but not running.' }

$lan = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Select-Object -First 1

Write-Host "Node: $(node --version)"
Write-Host "npm: $(npm --version)"
Write-Host "Python: $pythonVersion"
Write-Host 'Docker: ready'
$lanDisplay = if ($lan) { $lan } else { 'not detected' }
Write-Host "LAN IPv4: $lanDisplay"
