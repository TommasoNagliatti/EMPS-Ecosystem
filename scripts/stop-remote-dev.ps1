[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$statePath = Join-Path $root 'remote-dev.private.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No managed remote launch is recorded.'; return }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$expectedScript = Join-Path $root 'site/emps-site-main/backend/scripts/remote-development.cjs'
if ([IO.Path]::GetFullPath($state.script) -ne [IO.Path]::GetFullPath($expectedScript)) { throw 'Unexpected launcher identity; no process was stopped.' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$state.pid)"
if ($process) {
    if (-not $process.CommandLine.Contains($expectedScript.Replace('\', '/')) -and
        -not $process.CommandLine.Contains($expectedScript.Replace('/', '\'))) { throw 'Process does not match this workspace; no process was stopped.' }
    # PowerShell 7 may deserialize ISO dates directly; parsing that object again loses its UTC kind.
    $startedUtc = if ($state.startedAt -is [DateTime]) { $state.startedAt.ToUniversalTime() }
        elseif ($state.startedAt -is [DateTimeOffset]) { $state.startedAt.UtcDateTime }
        else { [DateTimeOffset]::Parse([string]$state.startedAt).UtcDateTime }
    $age = [Math]::Abs(($process.CreationDate.ToUniversalTime() - $startedUtc).TotalSeconds)
    if ($age -gt 30) { throw 'Recorded process ID was reused; no process was stopped.' }
    & taskkill.exe /PID ([string]$state.pid) /T /F
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the managed launcher tree.' }
}
Remove-Item -LiteralPath $statePath
Write-Output 'Only this workspace remote launch and its tunnel were stopped. Production services were not stopped.'
