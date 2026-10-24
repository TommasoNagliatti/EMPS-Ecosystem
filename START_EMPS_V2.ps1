[CmdletBinding()]
param([switch]$NoApp, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts/start-local.ps1') -NoApp:$NoApp
