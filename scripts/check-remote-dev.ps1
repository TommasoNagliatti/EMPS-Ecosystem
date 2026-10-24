[CmdletBinding()]
param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'site/emps-site-main/backend'
Push-Location $backend
try {
    if (-not (Test-Path -LiteralPath 'dist/remote-development.js')) { throw 'Build the backend first. This checker never starts or changes production services.' }
    $arguments = @('scripts/remote-development.cjs', '--check')
    if ($ConfigPath) { $arguments += @('--config', (Resolve-Path -LiteralPath $ConfigPath).Path) }
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Read-only verification failed. No migration or seed was applied.' }
} finally { Pop-Location }
