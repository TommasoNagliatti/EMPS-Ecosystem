[CmdletBinding()]
param()

# One-time, repeatable data preparation for the audited local clone only.
# It never applies SQL patches or writes to the MySQLs on ports 3306/3307.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo 'site\emps-site-main\backend'
$privateRoot = Join-Path (Split-Path -Parent $repo) 'EMPS_BACKUPS'
$dbEnvPath = Join-Path $privateRoot 'emps-legacy-integration.mysql.env'
$runtimePath = Join-Path $privateRoot 'emps-legacy-integration.runtime.json'
$container = 'emps-legacy-integration-mysql'
$volume = 'emps_legacy_integration_20261017'
$image = 'sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b'

function Assert-Exit([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step falhou (código $LASTEXITCODE)." }
}

if (-not (Test-Path -LiteralPath $dbEnvPath) -or -not (Test-Path -LiteralPath $runtimePath)) {
    throw 'Credenciais privadas da cópia e runtime local não encontrados. Inicie a prévia primeiro.'
}
$branch = (& git -C $repo branch --show-current).Trim()
Assert-Exit 'Identificação da branch'
if ($branch -notin @('feat/legacy-mysql-local-integration',
                    'feat/predio-comercial-local-integration')) {
    throw 'Branch de integração local inesperada.'
}
& git -C $repo merge-base --is-ancestor 79e000f HEAD
if ($LASTEXITCODE -ne 0) { throw 'A branch deve derivar da PR #6 (79e000f).' }

$dbEnv = @{}
foreach ($line in Get-Content -LiteralPath $dbEnvPath) {
    if ($line -notmatch '^([A-Z_]+)=(.*)$' -or $dbEnv.ContainsKey($Matches[1])) {
        throw 'Arquivo privado de credenciais da cópia inválido.'
    }
    $dbEnv[$Matches[1]] = $Matches[2]
}
if ($dbEnv.MYSQL_DATABASE -ne 'emps_integration_test' -or
    $dbEnv.MYSQL_USER -ne 'emps_integration_app' -or
    [string]::IsNullOrWhiteSpace($dbEnv.MYSQL_PASSWORD)) {
    throw 'Credenciais não correspondem ao banco de integração auditado.'
}
$runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
if ($runtime.adminEmail -ne 'integration.local@emps.invalid' -or
    $runtime.adminPassword.Length -lt 24 -or $runtime.gieV3Token.Length -lt 24) {
    throw 'Runtime privado da integração inválido.'
}

$docker = (Get-Command docker.exe -ErrorAction Stop).Source
$inspected = @(& $docker inspect $container 2>$null | ConvertFrom-Json)
Assert-Exit 'Inspeção do contêiner isolado'
if ($inspected.Count -ne 1) { throw 'Contêiner da cópia não identificado.' }
$db = $inspected[0]
$binding = @($db.HostConfig.PortBindings.'3306/tcp')[0]
$mounts = @($db.Mounts)
if (-not $db.State.Running -or $db.Name -ne "/$container" -or
    $db.Config.Image -ne $image -or $db.Image -ne $image -or
    $mounts.Count -ne 1 -or $mounts[0].Name -ne $volume -or
    $mounts[0].Destination -ne '/var/lib/mysql' -or
    $binding.HostIp -ne '127.0.0.1' -or [int]$binding.HostPort -ne 3308 -or
    $db.Config.Env -notcontains 'MYSQL_DATABASE=emps_integration_test' -or
    $db.Config.Env -notcontains 'MYSQL_USER=emps_integration_app' -or
    $db.Config.Env -notcontains "MYSQL_PASSWORD=$($dbEnv.MYSQL_PASSWORD)") {
    throw 'Identidade da cópia MySQL divergente; nenhuma preparação foi iniciada.'
}

$env:DATABASE_URL = 'mysql://emps_integration_app:' +
    [uri]::EscapeDataString($dbEnv.MYSQL_PASSWORD) + '@127.0.0.1:3308/emps_integration_test'
$env:DEMO_HISTORY_TEST_DATABASE = 'emps_integration_test'
$env:NODE_ENV = 'development'
$env:EMPS_REMOTE_DEVELOPMENT = 'false'
$env:EMPS_LOCAL_LEGACY_INTEGRATION = 'true'
$env:EMPS_PHYSICAL_COMMANDS_ENABLED = 'false'
$env:EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED = 'false'
$env:PAYMENT_PROVIDER = 'sandbox'
$env:OCPP_GATEWAY_URL = ''
$env:OCPP_GATEWAY_TOKEN = ''
$env:STRIPE_SECRET_KEY = ''
$env:STRIPE_WEBHOOK_SECRET = ''
$env:STRIPE_PUBLISHABLE_KEY = ''
$env:HOST = '127.0.0.1'
$env:EMPS_LEGACY_LOCAL_OWNER_ID = '105'
$env:GIE_STATION_ID = '39'
$env:GIE_COMMERCIAL_STATION_ID = '39'
$env:GIE_PREDIO_STATION_ID = '13'
$env:GIE_V3_SERVICE_URL = 'http://127.0.0.1:8540'
$env:GIE_V3_SERVICE_TOKEN = $runtime.gieV3Token
$env:EMPS_INTEGRATION_ADMIN_EMAIL = $runtime.adminEmail
$env:EMPS_INTEGRATION_ADMIN_PASSWORD = $runtime.adminPassword

$tsx = Join-Path $backend 'node_modules\.bin\tsx.cmd'
if (-not (Test-Path -LiteralPath $tsx)) { throw 'Dependências do Backend ausentes.' }
$dataRoot = Join-Path $repo 'gie\GIE\data'
if (-not (Test-Path -LiteralPath $dataRoot)) { throw 'Datasets GIE não encontrados.' }
Invoke-RestMethod -Uri 'http://127.0.0.1:8540/v1/health' `
    -Headers @{Authorization='Bearer ' + $runtime.gieV3Token} -TimeoutSec 10 | Out-Null

Push-Location $backend
try {
    $installations = (& $tsx 'scripts/legacy-local-installations.ts' | Select-Object -Last 1) | ConvertFrom-Json
    Assert-Exit 'Vínculo idempotente das instalações GIE'
    $posto = @($installations.installations | Where-Object gieStationId -eq 'DEMO_POSTO_24H_001')[0]
    $casa = @($installations.installations | Where-Object gieStationId -eq 'DEMO_CASA_001')[0]
    if (-not $posto -or -not $casa -or $installations.commercialStationId -ne 39 -or
        $installations.ownerId -ne 105) { throw 'Instalações não correspondem ao inventário auditado.' }
    Write-Host "Shopping 39 preservada; Posto $($posto.stationId); Residência $($casa.stationId)."

    & $tsx 'scripts/demo-history-import.ts' '--apply' '--owner-id' '105' `
        '--commercial-id' '39' '--posto-id' ([string]$posto.stationId) `
        '--casa-id' ([string]$casa.stationId) '--data-root' $dataRoot
    Assert-Exit 'Importação idempotente dos históricos demonstrativos'

    & $tsx 'scripts/legacy-local-review-admin.ts'
    Assert-Exit 'Conta de revisão apenas na cópia'

    if ($branch -eq 'feat/predio-comercial-local-integration') {
        & $tsx 'scripts/legacy-local-building-access.ts'
        Assert-Exit 'Pré-verificação da renomeação e acesso do Prédio'
        & $tsx 'scripts/legacy-local-building-access.ts' '--apply'
        Assert-Exit 'Renomeação e acesso idempotentes do Prédio'

        & $tsx 'scripts/legacy-local-building-gie.ts'
        Assert-Exit 'Vínculo GIE comercial independente do Prédio'

        & $tsx 'scripts/demo-history-building-import.ts' '--plan' '--data-root' $dataRoot
        Assert-Exit 'Pré-verificação do histórico demonstrativo do Prédio'
        & $tsx 'scripts/demo-history-building-import.ts' '--apply' '--data-root' $dataRoot
        Assert-Exit 'Importação idempotente do Prédio'
    }
} finally {
    Pop-Location
}
Write-Host 'Preparação local concluída na cópia 3308; bancos 3306/3307 preservados.'
