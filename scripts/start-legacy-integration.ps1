[CmdletBinding()]
param(
    [string]$MaqueteBindIp = '127.0.0.1',
    [string]$MaqueteDeviceIp = '127.0.0.1'
)

# This launcher starts an already prepared local clone. It never creates a database,
# applies SQL, imports history, changes passwords, or touches the two source MySQLs.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$site = Join-Path $repo 'site\emps-site-main'
$backend = Join-Path $site 'backend'
$frontend = Join-Path $site 'frontend'
$gie = Join-Path $repo 'gie\GIE'
$privateRoot = Join-Path (Split-Path -Parent $repo) 'EMPS_BACKUPS'
$dbEnvPath = Join-Path $privateRoot 'emps-legacy-integration.mysql.env'
$runtimePath = Join-Path $privateRoot 'emps-legacy-integration.runtime.json'
$maqueteRuntimePath = Join-Path $privateRoot 'emps-maquete-lab.runtime.json'
$processStatePath = Join-Path $privateRoot 'emps-legacy-integration.processes.json'
$logs = Join-Path $privateRoot 'legacy-integration-logs'
$runTag = Get-Date -Format 'yyyyMMdd-HHmmss'
$container = 'emps-legacy-integration-mysql'
$volume = 'emps_legacy_integration_20261017'
$expectedImage = 'sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b'
$database = 'emps_integration_test'
$dbUser = 'emps_integration_app'
$mysqlPort = 3308
$backendPort = 3011
$sitePort = 3010
$legacyGiePort = 8530
$gieV3Port = 8540
$bridgePort = 3012
$ports = @($mysqlPort,$backendPort,$sitePort,$legacyGiePort,$gieV3Port)

function Assert-Exit([string]$label) {
    if ($LASTEXITCODE -ne 0) { throw "$label falhou (código $LASTEXITCODE)." }
}
function Save-Json([string]$path, $value) {
    [IO.File]::WriteAllText($path, (($value | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
      (New-Object System.Text.UTF8Encoding($false)))
}
function New-Secret([int]$bytes = 36) {
    $buffer = New-Object byte[] $bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Assert-LabIp([string]$value) {
    $parsed = [Net.IPAddress]::None
    if (-not [Net.IPAddress]::TryParse($value, [ref]$parsed) -or
        $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
        throw "Endereço IPv4 inválido para a ponte da maquete: $value"
    }
    $octets = $parsed.GetAddressBytes()
    if (-not (($value -eq '127.0.0.1') -or $octets[0] -eq 10 -or
        ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
        ($octets[0] -eq 192 -and $octets[1] -eq 168))) {
        throw 'A ponte aceita somente loopback ou endereços IPv4 privados específicos.'
    }
}
function Port-Listening([int]$port) {
    try { return @((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)).Count -gt 0 }
    catch {
        if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { return $false }
        throw "Não foi possível inspecionar a porta ${port}: $($_.Exception.Message)"
    }
}
function Wait-Http([string]$url, [hashtable]$headers = @{}, [int]$seconds = 90) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
        try { return Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 5 }
        catch { Start-Sleep -Seconds 1 }
    } while ((Get-Date) -lt $until)
    throw "Serviço local não respondeu: $url"
}
function Get-ListenerIdentity([int]$port, [string]$expectedName, [string]$signature,
                              [string]$address = '127.0.0.1') {
    $listener = Get-NetTCPConnection -LocalAddress $address -LocalPort $port `
      -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $listener) { throw "Porta $port não possui listener de loopback." }
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction Stop
    if ($process.ProcessName -ne $expectedName -or $details.CommandLine -notmatch $signature) {
        throw "Listener $port não corresponde ao serviço EMPS registrado."
    }
    [pscustomobject]@{ pid=[int]$listener.OwningProcess;
      startedAtUtc=$process.StartTime.ToUniversalTime().ToString('o');
      parentPid=[int]$details.ParentProcessId }
}
function Assert-Registered([string]$name, [int]$port, [string]$processName, [string]$signature,
                           [string]$address = '127.0.0.1') {
    $stored = $script:processState.services[$name]
    if (-not $stored -or $script:processState.fingerprint -ne $script:fingerprint -or
        [int]$stored.port -ne $port) {
        throw "A porta $port está ocupada por serviço não registrado nesta configuração; nenhum processo será substituído."
    }
    $actual = Get-ListenerIdentity $port $processName $signature $address
    $savedTime = ([datetime]$stored.startedAtUtc).ToUniversalTime().ToString('o')
    if ([int]$stored.pid -ne $actual.pid -or $savedTime -ne $actual.startedAtUtc) {
        throw "A identidade de $name mudou desde o registro; serviço preservado."
    }
}
function Register-Listener([string]$name, [int]$port, [string]$processName,
                           [string]$signature, [int]$launchedPid,
                           [string]$address = '127.0.0.1') {
    $actual = Get-ListenerIdentity $port $processName $signature $address
    $candidate = $actual.pid
    $related = $false
    for ($depth = 0; $depth -lt 8 -and $candidate -gt 0; $depth++) {
        if ($candidate -eq $launchedPid) { $related = $true; break }
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$candidate" -ErrorAction Stop
        $candidate = [int]$details.ParentProcessId
    }
    if (-not $related) { throw "Listener $name não pertence ao processo iniciado pelo launcher." }
    $script:processState.services[$name] = [pscustomobject]@{port=$port; pid=$actual.pid;
      startedAtUtc=$actual.startedAtUtc; localAddress=$address}
    Save-Json $processStatePath $script:processState
}
function Start-Local([string]$name, [string]$exe, [string[]]$arguments,
                     [string]$directory, [hashtable]$environment) {
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $directory `
      -Environment $environment -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logs "$name.$runTag.stdout.log") `
      -RedirectStandardError (Join-Path $logs "$name.$runTag.stderr.log") -PassThru
    Write-Host "$name iniciado (PID $($process.Id)); logs em $logs"
    [int]$process.Id
}

if ($PSVersionTable.PSVersion.Major -lt 7 -or -not (Get-Command Start-Process).Parameters.ContainsKey('Environment')) {
    throw 'Execute com PowerShell 7, necessário para isolar as variáveis de cada serviço.'
}
$branch = (& git -C $repo branch --show-current).Trim()
Assert-Exit 'Identificação da branch'
if ($branch -notin @('feat/legacy-mysql-local-integration',
                    'feat/predio-comercial-local-integration',
                    'feat/esp32-maquete-local-bridge',
                    'feat/charging-sandbox-esp32-integration')) {
    throw 'O launcher só aceita as branches auditadas da integração local.'
}
& git -C $repo merge-base --is-ancestor 79e000f HEAD
if ($LASTEXITCODE -ne 0) { throw 'A branch deve derivar da PR #6 (79e000f).' }
$maqueteEnabled = $branch -in @('feat/esp32-maquete-local-bridge',
                                'feat/charging-sandbox-esp32-integration')
$chargingSandboxEnabled = $branch -eq 'feat/charging-sandbox-esp32-integration'
if ($maqueteEnabled) {
    & git -C $repo merge-base --is-ancestor 4a759cd HEAD
    if ($LASTEXITCODE -ne 0) { throw 'A branch da maquete deve derivar da PR #7 (4a759cd).' }
    if ($branch -eq 'feat/charging-sandbox-esp32-integration') {
        & git -C $repo merge-base --is-ancestor 3134086 HEAD
        if ($LASTEXITCODE -ne 0) { throw 'A branch de recarga sandbox deve derivar da PR #8 (3134086).' }
    }
    Assert-LabIp $MaqueteBindIp
    Assert-LabIp $MaqueteDeviceIp
    if (($MaqueteBindIp -eq '127.0.0.1') -xor ($MaqueteDeviceIp -eq '127.0.0.1')) {
        throw 'Endereços da ponte e do ESP32 devem ser ambos loopback (simulador) ou ambos da LAN.'
    }
    $ports += $bridgePort
}
if (@($ports | Select-Object -Unique).Count -ne $ports.Count) {
    throw 'As portas locais devem ser diferentes.'
}
if (-not (Test-Path -LiteralPath $dbEnvPath)) {
    throw "Falta o arquivo privado de credenciais da cópia: $dbEnvPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $backend 'dist\main.js')) -or
    -not (Test-Path -LiteralPath (Join-Path $frontend 'node_modules\next\dist\bin\next')) -or
    -not (Test-Path -LiteralPath (Join-Path $gie '.venv\Scripts\python.exe'))) {
    throw 'Build do Backend, dependências do Frontend e Python GIE devem estar prontos antes de iniciar.'
}
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# Read only the private clone credential file; never print its values or store them in Git.
$dbEnv = @{}
foreach ($line in Get-Content -LiteralPath $dbEnvPath) {
    if ($line -notmatch '^([A-Z_]+)=(.*)$') { throw 'Formato de credenciais locais inválido.' }
    if ($dbEnv.ContainsKey($Matches[1])) { throw 'Chave duplicada no arquivo de credenciais locais.' }
    $dbEnv[$Matches[1]] = $Matches[2]
}
if (@($dbEnv.Keys | Sort-Object) -join ',' -ne 'MYSQL_DATABASE,MYSQL_PASSWORD,MYSQL_ROOT_PASSWORD,MYSQL_USER' -or
    $dbEnv.MYSQL_DATABASE -ne $database -or $dbEnv.MYSQL_USER -ne $dbUser -or
    [string]::IsNullOrWhiteSpace($dbEnv.MYSQL_PASSWORD) -or
    [string]::IsNullOrWhiteSpace($dbEnv.MYSQL_ROOT_PASSWORD)) {
    throw 'Credenciais locais não correspondem à cópia isolada esperada.'
}
if (Test-Path -LiteralPath $runtimePath) {
    $runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
} else {
    $runtime = [pscustomobject]@{ adminEmail='integration.local@emps.invalid';
      adminName='Administrador da integração local'; adminPassword=(New-Secret 24);
      jwtSecret=(New-Secret 48);
      gieLegacyToken=(New-Secret 36); gieV3Token=(New-Secret 36) }
    Save-Json $runtimePath $runtime
}
if ($runtime.adminEmail -ne 'integration.local@emps.invalid' -or
    [string]::IsNullOrWhiteSpace($runtime.adminName) -or $runtime.adminPassword.Length -lt 24 -or
    $runtime.jwtSecret.Length -lt 32 -or $runtime.gieLegacyToken.Length -lt 24 -or
    $runtime.gieV3Token.Length -lt 24 -or
    @(@($runtime.jwtSecret,$runtime.gieLegacyToken,$runtime.gieV3Token) | Select-Object -Unique).Count -ne 3) {
    throw 'Tokens privados locais inválidos; arquivo preservado sem correção automática.'
}
if ($maqueteEnabled) {
    if (Test-Path -LiteralPath $maqueteRuntimePath) {
        $maqueteRuntime = Get-Content -Raw -LiteralPath $maqueteRuntimePath | ConvertFrom-Json
    } else {
        $maqueteRuntime = [pscustomobject]@{deviceId='maquete-01'; stationId=46;
          token=(New-Secret 48)}
        Save-Json $maqueteRuntimePath $maqueteRuntime
    }
    if ($maqueteRuntime.deviceId -ne 'maquete-01' -or
        [int]$maqueteRuntime.stationId -ne 46 -or
        [string]::IsNullOrWhiteSpace($maqueteRuntime.token) -or
        $maqueteRuntime.token.Length -lt 32 -or
        $maqueteRuntime.token -in @($runtime.jwtSecret,$runtime.gieLegacyToken,$runtime.gieV3Token)) {
        throw 'Identidade ou token privados da maquete inválidos; nenhum serviço foi iniciado.'
    }
}

$docker = (Get-Command docker.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$python = Join-Path $gie '.venv\Scripts\python.exe'
$inspected = @(& $docker inspect $container 2>$null | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $inspected.Count -ne 1) {
    throw 'A cópia MySQL de integração ainda não existe. Prepare e verifique o clone antes de executar o launcher.'
}
$inspection = $inspected[0]
$binding = @($inspection.HostConfig.PortBindings.'3306/tcp')[0]
$mounts = @($inspection.Mounts)
if ($inspection.Name -ne "/$container" -or $inspection.Config.Image -ne $expectedImage -or
    $inspection.Image -ne $expectedImage -or
    $inspection.HostConfig.AutoRemove -or $mounts.Count -ne 1 -or
    $mounts[0].Type -ne 'volume' -or $mounts[0].Name -ne $volume -or
    $mounts[0].Destination -ne '/var/lib/mysql' -or
    $binding.HostIp -ne '127.0.0.1' -or [int]$binding.HostPort -ne $mysqlPort -or
    $inspection.Config.Env -notcontains "MYSQL_DATABASE=$database" -or
    $inspection.Config.Env -notcontains "MYSQL_USER=$dbUser" -or
    $inspection.Config.Env -notcontains "MYSQL_PASSWORD=$($dbEnv.MYSQL_PASSWORD)" -or
    $inspection.Config.Env -notcontains "MYSQL_ROOT_PASSWORD=$($dbEnv.MYSQL_ROOT_PASSWORD)") {
    throw 'Identidade do contêiner, volume, porta ou credenciais divergente; nenhum banco será alterado.'
}
if (-not $inspection.State.Running) {
    if (Port-Listening $mysqlPort) { throw 'A porta 3308 está ocupada; o clone permaneceu parado.' }
    & $docker start $container | Out-Null
    Assert-Exit 'Inicialização do clone já verificado'
}
$ready = $false
for ($i=0; $i -lt 90; $i++) {
    & $docker exec $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysqladmin ping -h 127.0.0.1 -u$MYSQL_USER --silent' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'O clone MySQL não respondeu.' }
$tables = @('SHOW TABLES;' | & $docker exec -i $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE -N -B')
Assert-Exit 'Verificação do schema da cópia'
$required = @('users','stations','chargers','charging_sessions','payments',
  'gie_station_bindings','demo_import_batches','demo_energy_readings',
  'demo_charging_sessions','demo_payments','demo_session_scenarios')
if ($maqueteEnabled) {
    $required += @('lab_devices','lab_device_commands','lab_device_events','lab_rfid_tags')
}
if ($chargingSandboxEnabled) {
    $required += @('lab_charge_intents','lab_charge_sessions','lab_charge_payments','lab_charge_receipts')
}
$expectedTableCount = if ($chargingSandboxEnabled) { 44 } elseif ($maqueteEnabled) { 40 } else { 36 }
if ($tables.Count -ne $expectedTableCount -or
    @($required | Where-Object { $tables -notcontains $_ }).Count -gt 0) {
    throw 'A cópia não apresenta o schema esperado (patches 0001–0006 na branch sandbox). Nenhum patch será aplicado pelo launcher.'
}
if ($maqueteEnabled) {
    $binding = @('SELECT id, station_id FROM lab_devices;' |
      & $docker exec -i $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE -N -B')
    Assert-Exit 'Verificação do vínculo explícito da maquete'
    if ($binding.Count -ne 1 -or "$($binding[0])" -ne "maquete-01`t46") {
        throw 'Vínculo de laboratório maquete-01 → Posto 46 ausente ou divergente.'
    }
}
if ($chargingSandboxEnabled) {
    $sandboxFixtures = @('SELECT (SELECT COUNT(*) FROM tariffs WHERE station_id=46 AND charger_id IN (76,77) AND tariff_name=''SANDBOX - Posto 24h'' AND status=''active''), (SELECT COUNT(*) FROM charger_qr_bindings WHERE charger_id IN (76,77) AND is_active=1 AND short_code LIKE ''LAB46-%'');' |
      & $docker exec -i $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE -N -B')
    Assert-Exit 'Verificação dos vínculos de tarifa e QR sandbox'
    if ($sandboxFixtures.Count -ne 1 -or "$($sandboxFixtures[0])" -ne "2`t2") {
        throw 'Tarifas ou QR sandbox ausentes. Execute setup-charging-sandbox.py antes de iniciar.'
    }
}
$dbCounts = @('SELECT (SELECT COUNT(*) FROM stations WHERE id=39), (SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM stations), (SELECT COUNT(*) FROM chargers);' |
  & $docker exec -i $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE -N -B')
Assert-Exit 'Verificação dos dados de integração'
$parts = "$($dbCounts[0])" -split "`t"
if ($parts.Count -ne 4 -or [int]$parts[0] -ne 1 -or [int]$parts[1] -lt 10 -or
    [int]$parts[2] -lt 8 -or [int]$parts[3] -lt 13) {
    throw 'A cópia não preserva a Shopping 39 e os registros legados mínimos de usuários, estações e carregadores.'
}

$head = (& git -C $repo rev-parse HEAD).Trim()
Assert-Exit 'Identificação do commit'
$fingerprintMaterial = @($repo,$head,$container,$volume,$database,$dbUser,
  $dbEnv.MYSQL_PASSWORD,$runtime.adminEmail,$runtime.adminPassword,
  $runtime.jwtSecret,$runtime.gieLegacyToken,$runtime.gieV3Token,
  $mysqlPort,$backendPort,$sitePort,$legacyGiePort,$gieV3Port) -join "`n"
if ($maqueteEnabled) {
    $fingerprintMaterial += "`n" + (@($maqueteRuntime.deviceId,$maqueteRuntime.stationId,
      $maqueteRuntime.token,$MaqueteBindIp,$MaqueteDeviceIp,$bridgePort) -join "`n")
}
$hash = [Security.Cryptography.SHA256]::Create()
try { $script:fingerprint = ([BitConverter]::ToString($hash.ComputeHash(
      [Text.Encoding]::UTF8.GetBytes($fingerprintMaterial)))).Replace('-','').ToLowerInvariant() }
finally { $hash.Dispose() }
$script:processState = [pscustomobject]@{fingerprint=$script:fingerprint; services=@{}}
if (Test-Path -LiteralPath $processStatePath) {
    $recorded = Get-Content -Raw -LiteralPath $processStatePath | ConvertFrom-Json
    if ($recorded.fingerprint -eq $script:fingerprint) {
        foreach ($item in $recorded.services.PSObject.Properties) {
            $script:processState.services[$item.Name] = $item.Value
        }
    } elseif (@($ports[1..4] | Where-Object { Port-Listening $_ }).Count -gt 0) {
        throw 'Código/configuração mudaram enquanto serviços locais estão ativos. Pare-os com stop-legacy-integration.ps1.'
    }
}
$signatures = @{
  backend=[regex]::Escape((Join-Path $backend 'dist\main.js'));
  frontend='[\\/]next[\\/]dist[\\/].*(?:start-server\.js|bin[\\/]next)';
  'gie-v3'='gie_multistation.*--port\s+8540';
  'gie-legado'='service\.api:create_app.*--port\s+8530';
  'maquete-bridge'=[regex]::Escape((Join-Path $repo 'scripts\maquete-lan-bridge.mjs'))
}
$services = @(@('backend',$backendPort,'node'),@('frontend',$sitePort,'node'),
  @('gie-v3',$gieV3Port,'python'),@('gie-legado',$legacyGiePort,'python'))
if ($maqueteEnabled) { $services += ,@('maquete-bridge',$bridgePort,'node',$MaqueteBindIp) }
foreach ($entry in $services) {
    if (Port-Listening ([int]$entry[1])) {
        $address = if ($entry.Count -gt 3) { [string]$entry[3] } else { '127.0.0.1' }
        Assert-Registered ([string]$entry[0]) ([int]$entry[1]) ([string]$entry[2]) `
          $signatures[[string]$entry[0]] $address
    }
}

$frontendUrl = "http://127.0.0.1:$sitePort"
$backendUrl = "http://127.0.0.1:$backendPort"
$legacyUrl = "http://127.0.0.1:$legacyGiePort"
$v3Url = "http://127.0.0.1:$gieV3Port"
$dataUrl = 'mysql://' + $dbUser + ':' + [uri]::EscapeDataString($dbEnv.MYSQL_PASSWORD) +
  "@127.0.0.1:$mysqlPort/$database"
$commonSafety = @{
  NODE_ENV='development'; EMPS_REMOTE_DEVELOPMENT='false'; EMPS_REMOTE_ACCESS_MODE='';
  EMPS_LOCAL_LEGACY_INTEGRATION='true'; PAYMENT_PROVIDER='sandbox';
  OCPP_GATEWAY_URL=''; OCPP_GATEWAY_TOKEN=''; STRIPE_SECRET_KEY='';
  STRIPE_WEBHOOK_SECRET=''; STRIPE_PUBLISHABLE_KEY='';
  EMPS_PHYSICAL_COMMANDS_ENABLED='false';
  EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED='false'; NODE_OPTIONS=''
}
$gieData = Join-Path $privateRoot 'legacy-integration-gie-runtime'
New-Item -ItemType Directory -Force -Path $gieData | Out-Null
$v3Env = @{} + $commonSafety
$v3Env.DATABASE_URL = ''
$v3Env.JWT_SECRET = ''
$v3Env.GIE_SERVICE_TOKEN = ''
$v3Env.GIE_MULTISTATION_TOKENS = (@{$runtime.gieV3Token=@(
  'Commercial_HighAutonomy_V2','DEMO_POSTO_24H_001','DEMO_CASA_001')} | ConvertTo-Json -Compress)
$v3Env.GIE_MULTISTATION_DATA_DIR = $gieData
$v3Env.PYTHONPATH = Join-Path $gie 'src'
$legacyEnv = @{} + $commonSafety
$legacyEnv.DATABASE_URL = ''
$legacyEnv.JWT_SECRET = ''
$legacyEnv.GIE_STATION_ID = '39'
$legacyEnv.GIE_SERVICE_TOKEN = $runtime.gieLegacyToken
$legacyEnv.GIE_NORMAL_DEMO = 'true'
$legacyEnv.GIE_WEATHER_ENABLED = 'false'
$legacyEnv.PYTHONPATH = Join-Path $gie 'src'
$backendEnv = @{} + $commonSafety
$backendEnv.DATABASE_URL = $dataUrl
$backendEnv.DEMO_HISTORY_TEST_DATABASE = $database
$backendEnv.EMPS_LEGACY_LOCAL_OWNER_ID = '105'
$backendEnv.JWT_SECRET = $runtime.jwtSecret
$backendEnv.EMPS_BACKGROUND_JOBS_ENABLED = 'true'
# An explicit empty charge scope prevents budget/reservation jobs and any
# physical charge action from mutating preserved operational records.
$backendEnv.CHARGE_RUNTIME_STATION_IDS = ''
$backendEnv.EMPS_GIE_PRESENTATION_ACTIONS_ENABLED = 'true'
$backendEnv.EMPS_GIE_PRESENTATION_ACTIONS_PORT = [string]$legacyGiePort
$backendEnv.GIE_SERVICE_URL = $legacyUrl
$backendEnv.GIE_SERVICE_TOKEN = $runtime.gieLegacyToken
$backendEnv.GIE_STATION_ID = '39'
$backendEnv.GIE_COMMERCIAL_STATION_ID = '39'
if ($branch -in @('feat/predio-comercial-local-integration','feat/esp32-maquete-local-bridge',
                 'feat/charging-sandbox-esp32-integration')) {
    $backendEnv.GIE_PREDIO_STATION_ID = '13'
}
$backendEnv.GIE_V3_SERVICE_URL = $v3Url
$backendEnv.GIE_V3_SERVICE_TOKEN = $runtime.gieV3Token
$backendEnv.GIE_V3_PROVISIONING_TOKEN = ''
$backendEnv.GIE_V3_TIMEOUT_MS = '30000'
$backendEnv.CORS_ORIGINS = "$frontendUrl,http://localhost:$sitePort"
$backendEnv.HOST = '127.0.0.1'
$backendEnv.PORT = [string]$backendPort
if ($maqueteEnabled) {
    $backendEnv.EMPS_MAQUETE_LAB_ENABLED = 'true'
    $backendEnv.EMPS_MAQUETE_DEVICE_ID = 'maquete-01'
    $backendEnv.EMPS_MAQUETE_STATION_ID = '46'
    $backendEnv.EMPS_MAQUETE_DEVICE_TOKEN = $maqueteRuntime.token
}
if ($chargingSandboxEnabled) {
    $backendEnv.EMPS_CHARGING_SANDBOX_ENABLED = 'true'
}
$frontendEnv = @{} + $commonSafety
$frontendEnv.DATABASE_URL = ''
$frontendEnv.JWT_SECRET = ''
$frontendEnv.GIE_SERVICE_TOKEN = ''
$frontendEnv.GIE_V3_SERVICE_TOKEN = ''
$frontendEnv.GIE_MULTISTATION_TOKENS = ''
$frontendEnv.MYSQL_PASSWORD = ''
$frontendEnv.MYSQL_ROOT_PASSWORD = ''
$frontendEnv.EMPS_LOCAL_PREVIEW = 'true'
$frontendEnv.NEXT_PUBLIC_API_URL = $backendUrl
$frontendEnv.NEXT_PUBLIC_EMPS_DEMO_MODE = 'false'
$frontendEnv.NEXT_PUBLIC_EMPS_READ_ONLY = 'false'

$v3Headers = @{Authorization = 'Bearer ' + $runtime.gieV3Token}
if (Port-Listening $gieV3Port) {
    $managerHealth = Wait-Http "$v3Url/v1/health" $v3Headers 5
} else {
    $launched = Start-Local 'gie-v3' $python @('-B','-m','gie_multistation','--port',"$gieV3Port") $gie $v3Env
    $managerHealth = Wait-Http "$v3Url/v1/health" $v3Headers 120
    Register-Listener 'gie-v3' $gieV3Port 'python' $signatures['gie-v3'] $launched
}
if ($managerHealth.origin -ne 'SIMULATED' -or $managerHealth.physical_dispatch -ne $false) {
    throw 'GIE V3 local não confirmou simulação sem despacho físico.'
}
foreach ($sid in @('Commercial_HighAutonomy_V2','DEMO_POSTO_24H_001','DEMO_CASA_001')) {
    $worker = Invoke-RestMethod -Uri "$v3Url/v1/stations/$sid/health" -Headers $v3Headers -TimeoutSec 5
    if ($worker.status -ne 'running') {
        Invoke-RestMethod -Method Post -Uri "$v3Url/v1/stations/$sid/initialize" `
          -Headers $v3Headers -ContentType 'application/json' -Body '{}' -TimeoutSec 180 | Out-Null
        $worker = Invoke-RestMethod -Uri "$v3Url/v1/stations/$sid/health" -Headers $v3Headers -TimeoutSec 5
    }
    if ($worker.status -ne 'running' -or $worker.physical_dispatch -ne $false) {
        throw "Worker $sid não confirmou execução apenas simulada."
    }
    $state = Invoke-RestMethod -Uri "$v3Url/v1/stations/$sid/state" -Headers $v3Headers -TimeoutSec 10
    if ([int]$state.revision -eq 0 -and $null -eq $state.state) {
        # One local scenario step produces a decision; never retry on ambiguous failure.
        $cycle = Invoke-RestMethod -Method Post -Uri "$v3Url/v1/stations/$sid/cycle" `
          -Headers $v3Headers -ContentType 'application/json' -Body '{}' -TimeoutSec 180
        if ($cycle.source -ne 'SIMULATED' -or $cycle.hardware_commands_sent -ne $false -or
            $cycle.capabilities.physical_dispatch -ne $false -or [int]$cycle.revision -ne 1 -or
            $cycle.state.execution_allowed -ne $true -or $cycle.state.visual_state.valid -ne $true -or
            [string]::IsNullOrWhiteSpace([string]$cycle.state.timestamp)) {
            throw "Ciclo inicial $sid não confirmou decisão simulada válida."
        }
        Write-Host "${sid}: primeira decisão SIMULATED disponível."
    }
}
$legacyHeaders = @{Authorization = 'Bearer ' + $runtime.gieLegacyToken}
if (Port-Listening $legacyGiePort) {
    Wait-Http "$legacyUrl/health" $legacyHeaders 5 | Out-Null
} else {
    $launched = Start-Local 'gie-legado' $python @('-B','-m','uvicorn','service.api:create_app',
      '--factory','--host','127.0.0.1','--port',"$legacyGiePort") $gie $legacyEnv
    Wait-Http "$legacyUrl/health" $legacyHeaders 120 | Out-Null
    Register-Listener 'gie-legado' $legacyGiePort 'python' $signatures['gie-legado'] $launched
}
if (Port-Listening $backendPort) {
    Wait-Http "$backendUrl/auth/health" @{} 5 | Out-Null
} else {
    $launched = Start-Local 'backend' $node @((Join-Path $backend 'dist\main.js')) $backend $backendEnv
    Wait-Http "$backendUrl/auth/health" @{} 120 | Out-Null
    Register-Listener 'backend' $backendPort 'node' $signatures.backend $launched
}
if ($maqueteEnabled) {
    $bridgeEnv = @{} + $commonSafety
    $bridgeEnv.DATABASE_URL = ''
    $bridgeEnv.JWT_SECRET = ''
    $bridgeEnv.GIE_SERVICE_TOKEN = ''
    $bridgeEnv.GIE_V3_SERVICE_TOKEN = ''
    $bridgeEnv.EMPS_MAQUETE_DEVICE_TOKEN = $maqueteRuntime.token
    $bridgeEnv.EMPS_MAQUETE_BRIDGE_BIND_IP = $MaqueteBindIp
    $bridgeEnv.EMPS_MAQUETE_DEVICE_IP = $MaqueteDeviceIp
    $bridgeEnv.EMPS_MAQUETE_BRIDGE_PORT = [string]$bridgePort
    if (-not (Port-Listening $bridgePort)) {
        $launched = Start-Local 'maquete-bridge' $node `
          @((Join-Path $repo 'scripts\maquete-lan-bridge.mjs')) $repo $bridgeEnv
        $deadline = (Get-Date).AddSeconds(15)
        while (-not (Port-Listening $bridgePort) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
        if (-not (Port-Listening $bridgePort)) {
            throw 'Ponte local da maquete não abriu a porta restrita; consulte o log.'
        }
        Register-Listener 'maquete-bridge' $bridgePort 'node' `
          $signatures['maquete-bridge'] $launched $MaqueteBindIp
    }
}
if (Port-Listening $sitePort) {
    Wait-Http "$frontendUrl/login" @{} 5 | Out-Null
} else {
    $launched = Start-Local 'frontend' $node @((Join-Path $frontend 'node_modules\next\dist\bin\next'),
      'dev','--hostname','127.0.0.1','--port',"$sitePort") $frontend $frontendEnv
    Wait-Http "$frontendUrl/login" @{} 120 | Out-Null
    Register-Listener 'frontend' $sitePort 'node' $signatures.frontend $launched
}
Write-Host "Site integrado local: $frontendUrl/login"
Write-Host "Comparativo: $frontendUrl/stations/overview"
Write-Host "API local: $backendUrl/auth/health"
if ($maqueteEnabled) {
    Write-Host "Ponte da maquete: http://${MaqueteBindIp}:$bridgePort (somente IP $MaqueteDeviceIp; token privado)."
}
Write-Host 'Contêiner MySQL de integração e volume persistente preservados. Use senhas antigas conhecidas ou conta de teste criada somente na cópia.'
