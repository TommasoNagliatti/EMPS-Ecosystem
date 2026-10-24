#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Local','HostingerPreview')][string]$Source)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$privateRoot=Join-Path (Split-Path -Parent $repo) 'EMPS_BACKUPS'
$runtime=Get-Content -Raw (Join-Path $privateRoot 'emps-legacy-integration.runtime.json')|ConvertFrom-Json
$device=Get-Content -Raw (Join-Path $privateRoot 'emps-maquete-lab.runtime.json')|ConvertFrom-Json
$settings=Get-Content -Raw (Join-Path $privateRoot 'emps-maquete-bridge.settings.json')|ConvertFrom-Json
$statePath=Join-Path $privateRoot 'emps-legacy-integration.processes.json'
$sourcePath=Join-Path $privateRoot 'emps-maquete-source.json'
$current=if(Test-Path -LiteralPath $sourcePath){(Get-Content -Raw $sourcePath|ConvertFrom-Json).source}else{'Local'}
if($current -notin @('Local','HostingerPreview')){throw 'Origem atual desconhecida; preservar ponte'}
if($device.deviceId -ne 'maquete-01' -or $device.energyStationId -ne 13){throw 'Vinculo inesperado da maquete'}
$parsed=[Net.IPAddress]::None
foreach($address in @($settings.bindIp,$settings.deviceIp)){
 if(-not [Net.IPAddress]::TryParse($address,[ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $address -notmatch '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)'){throw 'Enderecos privados explicitos exigidos'}
}
if(-not (Get-NetIPAddress -IPAddress $settings.bindIp -ErrorAction SilentlyContinue)){throw 'Computador mudou de IP; atualizar configuracao privada'}
$neighbor=Get-NetNeighbor -IPAddress $settings.deviceIp -ErrorAction Stop|Select-Object -First 1
if($neighbor.LinkLayerAddress -ne $settings.deviceMac){throw 'MAC da placa difere do registro privado'}
$cloud=$null
if($Source -eq 'HostingerPreview' -or $current -eq 'HostingerPreview'){
 $cloud=Get-Content -Raw (Join-Path $privateRoot 'maquete-hostinger-preview.runtime.json')|ConvertFrom-Json
 if($cloud.apiUrl -ne 'https://preview.emps-charge.tech/api' -or $cloud.token.Length -lt 32 -or $cloud.token -eq $device.token){throw 'Origem HTTPS ou credencial remota invalida'}
}
function Assert-Idle([string]$name){
 $base=if($name -eq 'Local'){'http://127.0.0.1:3011'}else{$cloud.apiUrl}
 $email=if($name -eq 'Local'){$runtime.adminEmail}else{$cloud.email}
 $password=if($name -eq 'Local'){$runtime.adminPassword}else{$cloud.password}
 $login=Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{email=$email;password=$password}|ConvertTo-Json) -TimeoutSec 10
 $token=if($login.accessToken){$login.accessToken}elseif($login.access_token){$login.access_token}else{$login.token}
 if(-not $token){throw 'Login de verificacao falhou'}
 $headers=@{Authorization='Bearer '+$token}
 $sandbox=Invoke-RestMethod -Uri "$base/v2/stations/13/charging-sandbox" -Headers $headers -TimeoutSec 10
 if(@($sandbox.chargers|Where-Object {$_.sandboxStatus -in @('STARTING','CHARGING','FINISHING')}).Count){throw 'Encerre as recargas antes de trocar a origem da maquete'}
 $gie=Invoke-RestMethod -Uri "$base/stations/13/gie/state" -Headers $headers -TimeoutSec 10
 if($gie.online -ne $true -or [string]$gie.station_id -ne '13' -or $gie.gie_station_id -ne 'Commercial_HighAutonomy_V2'){throw 'GIE de destino indisponivel ou divergente'}
}
# Check both authorities while reachable. Never move an active charging session.
# If the cloud is unreachable, local rollback waits for the existing watchdog;
# the destination still must have no active sessions and a valid station binding.
if($current -ne $Source){
 try{Assert-Idle $current}catch{
  if($Source -ne 'Local' -or $_.Exception.Message -like '*Encerre as recargas*'){throw}
  Write-Warning 'Origem remota indisponivel; retorno local aguardara watchdog, sem transferir sessoes.'
 }
}
Assert-Idle $Source
$envVars=@{
 EMPS_MAQUETE_DEVICE_TOKEN=$device.token;EMPS_MAQUETE_GIE_STATION_ID='13';
 EMPS_MAQUETE_BRIDGE_BIND_IP=$settings.bindIp;EMPS_MAQUETE_DEVICE_IP=$settings.deviceIp;EMPS_MAQUETE_BRIDGE_PORT='3012';
 EMPS_MAQUETE_UPSTREAM_URL='';EMPS_MAQUETE_UPSTREAM_TOKEN='';EMPS_MAQUETE_REMOTE_PREVIEW_ENABLED='false'
}
if($Source -eq 'HostingerPreview'){
 $envVars.EMPS_MAQUETE_UPSTREAM_URL=$cloud.apiUrl
 $envVars.EMPS_MAQUETE_UPSTREAM_TOKEN=$cloud.token
 $envVars.EMPS_MAQUETE_REMOTE_PREVIEW_ENABLED='true'
}
& (Join-Path $PSScriptRoot 'stop-legacy-integration.ps1') -Services @('maquete-bridge')
$deadline=(Get-Date).AddSeconds(6)
while((Get-Date) -lt $deadline){
 if(-not (Get-NetTCPConnection -LocalAddress $settings.bindIp -LocalPort 3012 -State Listen -ErrorAction SilentlyContinue)){break}
 Start-Sleep -Milliseconds 200
}
if(Get-NetTCPConnection -LocalAddress $settings.bindIp -LocalPort 3012 -State Listen -ErrorAction SilentlyContinue){throw 'Porta da ponte ocupada; nenhum novo processo iniciado'}
# Allow the firmware's existing four-second lease to expire before a new origin.
Start-Sleep -Seconds 5
$tag=Get-Date -Format yyyyMMdd-HHmmss
$logs=Join-Path $privateRoot 'legacy-integration-logs'
$server=Start-Process -FilePath (Get-Command node).Source -ArgumentList (Join-Path $repo 'scripts\maquete-lan-bridge.mjs') -WorkingDirectory $repo -Environment $envVars -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\maquete-$Source.$tag.stdout.log" -RedirectStandardError "$logs\maquete-$Source.$tag.stderr.log"
$deadline=(Get-Date).AddSeconds(20);$listener=$null
while((Get-Date) -lt $deadline){$listener=Get-NetTCPConnection -LocalAddress $settings.bindIp -LocalPort 3012 -State Listen -ErrorAction SilentlyContinue;if($listener){break};Start-Sleep -Milliseconds 200}
if(-not $listener -or $listener.OwningProcess -ne $server.Id){throw 'Ponte nao confirmou identidade; consultar logs privados'}
$state=Get-Content -Raw $statePath|ConvertFrom-Json
$state.services.'maquete-bridge'=[pscustomobject]@{pid=$server.Id;port=3012;localAddress=$settings.bindIp;startedAtUtc=(Get-Process -Id $server.Id).StartTime.ToUniversalTime().ToString('o')}
[IO.File]::WriteAllText($statePath,($state|ConvertTo-Json -Depth 8))
[IO.File]::WriteAllText($sourcePath,([pscustomobject]@{source=$Source;updatedAt=[datetime]::UtcNow.ToString('o')}|ConvertTo-Json))
Write-Output "Origem da maquete: $Source. Site, APIs, GIEs, Expo e bancos locais preservados."
