[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$statePath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.emps-demo-visual-processes.json'
if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host 'Nenhum registro dos serviços visuais locais foi encontrado.'
    return
}
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$known = @{
    backend = @{ port=3001; name='node'; signature='dist[\\/]main\.js' }
    frontend = @{ port=3000; name='node'; signature='[\\/]next[\\/]dist[\\/].*(?:start-server\.js|bin[\\/]next)' }
    'gie-v3' = @{ port=8520; name='python'; signature='gie_multistation' }
    'gie-legado' = @{ port=8510; name='python'; signature='service\.api:create_app' }
}
$verified = @()
foreach ($entry in $known.GetEnumerator()) {
    $name = $entry.Key
    $expected = $entry.Value
    $saved = $state.services.PSObject.Properties[$name].Value
    if (-not $saved) { continue }
    if ([int]$saved.port -ne [int]$expected.port) {
        throw "Registro divergente para $name; nenhum serviço será encerrado."
    }
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $expected.port `
      -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { continue }
    if ([int]$listener.OwningProcess -ne [int]$saved.pid) {
        throw "A porta $($expected.port) mudou de processo; nenhum serviço será encerrado."
    }
    $process = Get-Process -Id $saved.pid -ErrorAction Stop
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)" -ErrorAction Stop
    $actualStart = $process.StartTime.ToUniversalTime().ToString('o')
    $savedStart = ([datetime]$saved.startedAtUtc).ToUniversalTime().ToString('o')
    if ($process.ProcessName -ne $expected.name -or $details.CommandLine -notmatch $expected.signature -or
        $actualStart -ne $savedStart) {
        throw "Identidade de $name diverge do registro local; nenhum serviço será encerrado."
    }
    $verified += [pscustomobject]@{ name=$name; pid=[int]$saved.pid }
}
foreach ($service in $verified) {
    if ($PSCmdlet.ShouldProcess("$($service.name) PID $($service.pid)", 'Encerrar serviço local')) {
        Stop-Process -Id $service.pid -ErrorAction Stop
        Write-Host "$($service.name) local encerrado."
    }
}
Write-Host 'O contêiner MySQL e seus dados locais foram preservados.'
