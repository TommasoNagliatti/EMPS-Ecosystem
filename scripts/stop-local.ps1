[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$root = (Split-Path -Parent $PSScriptRoot).ToLowerInvariant()
$processes = Get-CimInstance Win32_Process
$launchers = $processes | Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -match 'scripts[\\/]start-ecosystem\.cjs' -and
    ($_.ExecutablePath -or $_.CommandLine)
}

if (-not $launchers) {
    Write-Host 'No EMPS launcher is running.'
    return
}

foreach ($launcher in $launchers) {
    $parent = $processes | Where-Object { $_.ProcessId -eq $launcher.ParentProcessId }
    $context = [string]$launcher.CommandLine + ' ' + [string]$parent.CommandLine
    $context = $context.ToLowerInvariant()
    if ($context -notlike "*$root*") {
        Write-Warning "Skipped launcher PID $($launcher.ProcessId): checkout path could not be verified."
        continue
    }
    if ($PSCmdlet.ShouldProcess("EMPS launcher PID $($launcher.ProcessId)", 'Stop process tree')) {
        & taskkill.exe /PID $launcher.ProcessId /T /F | Out-Host
    }
}

Write-Host 'EMPS application services stopped. MySQL and its volume were preserved.'
