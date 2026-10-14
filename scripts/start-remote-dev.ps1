[CmdletBinding()]
param([string]$ConfigPath, [switch]$Optimized)
$ErrorActionPreference = 'Stop'
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'site/emps-site-main/backend'
$resolvedConfig = if ($ConfigPath) { (Resolve-Path -LiteralPath $ConfigPath).Path } else { $null }
Push-Location $backend
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed; no remote service was started.' }
    $arguments = @((Join-Path $backend 'scripts/remote-development.cjs'))
    if ($Optimized) { $arguments += '--preview' }
    if ($resolvedConfig) { $arguments += @('--config', $resolvedConfig) }
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Remote startup failed; check the private configuration and verified SSH access.' }
} finally { Pop-Location }
