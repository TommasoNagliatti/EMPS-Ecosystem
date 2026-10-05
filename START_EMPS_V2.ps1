[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scripts\emps-v2-processes.ps1')
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne $EmpsRoot) { throw 'Use C:\goodwill_ai\EMPS_GITHUB only.' }
$lan=Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -notlike '169.254.*' } | Select-Object -First 1
if (-not $lan) { throw 'No LAN IPv4 with a default gateway was found.' }
$node=(Get-Command node).Source
$docker=(Get-Command docker).Source
$container=& $docker inspect emps-mysql --format '{{.State.Running}}'
if ($LASTEXITCODE -ne 0) { throw 'Existing emps-mysql is required; no database will be created.' }
if ($container.Trim() -ne 'true') { & $docker start emps-mysql; if ($LASTEXITCODE -ne 0) { throw 'Unable to start existing MySQL.' } }
$health=& $docker inspect emps-mysql --format '{{.State.Health.Status}}'
if ($health.Trim() -ne 'healthy') { throw 'MySQL is not healthy; inspect it without recreating data.' }
# Build the working tree, never HEAD; no dependency installation or migration.
Push-Location $EmpsBackend
try { & $node 'node_modules/@nestjs/cli/bin/nest.js' build; if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' } } finally { Pop-Location }
$snapshot=Get-EmpsSnapshot
$records=@(Get-EmpsConflicts $snapshot)
$ports=@(3000,3001,3100,3101,8081,8083,8510)
$occupied=@(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports })
foreach ($port in $occupied) {
    if ($port.OwningProcess -notin @($records | ForEach-Object ProcessId)) { throw ('Port '+$port.LocalPort+' belongs to an unverified process; nothing was stopped.') }
}
$reportDir=Join-Path $EmpsBackend 'reports'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$records | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDir 'v2-stopped-processes.json')
Stop-EmpsRecords $records
for ($i=0;$i -lt 20;$i++) {
    $remaining=@(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports })
    if ($remaining.Count -eq 0) { break }; Start-Sleep -Milliseconds 500
}
if ($remaining.Count) { throw 'An EMPS port remains occupied; no duplicate services started.' }
$appEnv=Join-Path $EmpsRoot 'app\emps-charge\.env'
$text=[IO.File]::ReadAllText($appEnv)
if ($text -notmatch '(?m)^EXPO_PUBLIC_EMPS_API_URL=') { throw 'App local API variable is missing.' }
$text=[regex]::Replace($text,'(?m)^EXPO_PUBLIC_EMPS_API_URL=[^\r\n]*',('EXPO_PUBLIC_EMPS_API_URL=http://'+$lan+':3001'))
[IO.File]::WriteAllText($appEnv,$text,[Text.UTF8Encoding]::new($false))
$log=Join-Path $reportDir 'ecosystem-v2.log'; $err=Join-Path $reportDir 'ecosystem-v2.err.log'
$entry=Join-Path $EmpsBackend 'scripts\start-ecosystem.cjs'
$launchedAt=Get-Date
$supervisor=Start-Process -FilePath $node -ArgumentList @(('"'+$entry+'"'),'--with-app','--v2','--lan-ip',$lan) -WorkingDirectory $EmpsBackend -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
for ($i=0;$i -lt 240;$i++) {
    if ($supervisor.HasExited) { throw 'Launcher exited. Inspect backend/reports/ecosystem-v2.err.log (secrets are not printed).' }
    if (Test-Path -LiteralPath $EmpsState) {
        try { $state=Get-Content -LiteralPath $EmpsState -Raw | ConvertFrom-Json } catch { $state=$null }
        if ($state -and $state.supervisor.pid -eq $supervisor.Id -and $state.status -eq 'READY') { break }
    }
    Start-Sleep -Seconds 1
}
if (-not $state -or $state.supervisor.pid -ne $supervisor.Id -or $state.status -ne 'READY') { throw 'Startup did not finish. Use STOP_EMPS_V2.ps1 for only this launch.' }
Write-Host "Site V2: http://localhost:3000/stations"
Write-Host "Backend: http://localhost:3001/auth/health"
Write-Host "Backend LAN: http://${lan}:3001"
Write-Host "GIE: http://localhost:8510 (authenticated API)"
Write-Host "Expo: exp://${lan}:8081 | Web: http://localhost:8081"
Write-Host 'Services stay running. Use STOP_EMPS_V2.ps1 to stop only this launch; MySQL stays running.'
Write-Host "Logs: $reportDir"
if (-not $NoBrowser) { Start-Process 'http://localhost:3000/stations' }
