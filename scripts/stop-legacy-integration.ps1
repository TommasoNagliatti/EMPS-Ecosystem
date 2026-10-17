[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$privateRoot = Join-Path (Split-Path -Parent $repo) 'EMPS_BACKUPS'
$statePath = Join-Path $privateRoot 'emps-legacy-integration.processes.json'
$runtimePath = Join-Path $privateRoot 'emps-legacy-integration.runtime.json'
if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host 'Nenhum registro de processos da integração local foi encontrado.'
    return
}
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$backend = Join-Path $repo 'site\emps-site-main\backend'
$known = @{
    frontend = @{port=3010; name='node'; signature='[\\/]next[\\/]dist[\\/].*(?:start-server\.js|bin[\\/]next)'}
    backend = @{port=3011; name='node'; signature=[regex]::Escape((Join-Path $backend 'dist\main.js'))}
    'gie-v3' = @{port=8540; name='python'; signature='gie_multistation.*--port\s+8540'}
    'gie-legado' = @{port=8530; name='python'; signature='service\.api:create_app.*--port\s+8530'}
}
function Confirm-Registered([string]$name, $expected, $saved) {
    if ([int]$saved.port -ne [int]$expected.port) {
        throw "Registro divergente para $name; nenhum serviço será encerrado."
    }
    try {
        $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $expected.port `
          -State Listen -ErrorAction Stop | Select-Object -First 1
    } catch {
        if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { return $null }
        throw "Não foi possível verificar a porta $($expected.port): $($_.Exception.Message)"
    }
    if (-not $listener) { return $null }
    if ([int]$listener.OwningProcess -ne [int]$saved.pid) {
        throw "A porta $($expected.port) mudou de processo; nenhum serviço será encerrado."
    }
    $process = Get-Process -Id $saved.pid -ErrorAction Stop
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)" -ErrorAction Stop
    $actualTime = $process.StartTime.ToUniversalTime().ToString('o')
    $savedTime = ([datetime]$saved.startedAtUtc).ToUniversalTime().ToString('o')
    if ($process.ProcessName -ne $expected.name -or
        $details.CommandLine -notmatch $expected.signature -or $actualTime -ne $savedTime) {
        throw "Identidade de $name diverge do registro; nenhum serviço será encerrado."
    }
    [pscustomobject]@{name=$name; pid=[int]$saved.pid}
}
$verified = @()
foreach ($name in @('frontend','backend','gie-legado','gie-v3')) {
    $saved = $state.services.PSObject.Properties[$name].Value
    if (-not $saved) { continue }
    $match = Confirm-Registered $name $known[$name] $saved
    if ($match) { $verified += $match }
}
foreach ($service in $verified) {
    $match = Confirm-Registered $service.name $known[$service.name] `
      $state.services.PSObject.Properties[$service.name].Value
    if (-not $match) { continue }
    if ($PSCmdlet.ShouldProcess("$($service.name) PID $($service.pid)", 'Encerrar serviço local')) {
        if ($service.name -eq 'gie-v3' -and (Test-Path -LiteralPath $runtimePath)) {
            # These routes only stop simulated GIE workers before their local API exits.
            $runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
            $headers = @{Authorization = 'Bearer ' + $runtime.gieV3Token}
            foreach ($sid in @('Commercial_HighAutonomy_V2','DEMO_POSTO_24H_001','DEMO_CASA_001')) {
                try {
                    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8540/v1/stations/$sid/stop" `
                      -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20 | Out-Null
                } catch {
                    Write-Warning "Worker GIE simulado $sid não confirmou parada; confira o log local."
                }
            }
        }
        Stop-Process -Id $service.pid -ErrorAction Stop
        Write-Host "$($service.name) local encerrado."
    }
}
Write-Host 'Os contêineres MySQL, os volumes e todos os dados foram preservados.'
