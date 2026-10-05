[CmdletBinding()]
param([switch]$InspectOnly)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scripts\emps-v2-processes.ps1')
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne $EmpsRoot) { throw 'Use the current EMPS monorepo only.' }
$records=@(Get-EmpsManaged (Get-EmpsSnapshot))
if ($InspectOnly) { $records | Select-Object ProcessId,Name,ParentProcessId; return }
Stop-EmpsRecords $records
Write-Host 'Only this launcher services were stopped. MySQL and data were preserved.'
