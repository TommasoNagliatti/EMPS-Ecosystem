[CmdletBinding(SupportsShouldProcess)]
param([switch]$InspectOnly)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts/stop-local.ps1') -WhatIf:($WhatIfPreference -or $InspectOnly)
