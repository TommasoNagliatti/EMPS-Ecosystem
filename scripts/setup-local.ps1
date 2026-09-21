[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot 'check-environment.ps1')

function Install-NodeProject([string]$path) {
    Write-Host "Installing npm dependencies in $path"
    Push-Location $path
    try { npm ci } finally { Pop-Location }
}

function Copy-ExampleIfMissing([string]$directory) {
    $example = Join-Path $directory '.env.example'
    $target = Join-Path $directory '.env'
    if ((Test-Path $example) -and -not (Test-Path $target)) {
        Copy-Item -LiteralPath $example -Destination $target
        Write-Host "Created local configuration: $target"
    } elseif (Test-Path $target) {
        Write-Host "Preserved existing local configuration: $target"
    }
}

$backend = Join-Path $root 'site\emps-site-main\backend'
$frontend = Join-Path $root 'site\emps-site-main\frontend'
$app = Join-Path $root 'app\emps-charge'
$gie = Join-Path $root 'gie\GIE'

Install-NodeProject $backend
Install-NodeProject $frontend
Install-NodeProject $app

Copy-ExampleIfMissing $backend
Copy-ExampleIfMissing $frontend
Copy-ExampleIfMissing $app

$python = Join-Path $gie '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    & py -3.12 -m venv (Join-Path $gie '.venv')
}
& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $gie 'requirements-test.txt')

Write-Host 'Setup complete. Review local .env files, then run .\scripts\start-local.ps1.'
