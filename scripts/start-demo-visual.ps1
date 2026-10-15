[CmdletBinding()]
param(
    [int]$MySqlPort = 3307,
    [int]$BackendPort = 3001,
    [int]$SitePort = 3000,
    [int]$LegacyGiePort = 8510,
    [int]$GieV3Port = 8520
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $repo
$site = Join-Path $repo 'site\emps-site-main'
$backend = Join-Path $site 'backend'
$frontend = Join-Path $site 'frontend'
$gie = Join-Path $repo 'gie\GIE'
$dataRoot = Join-Path $gie 'data'
$localState = Join-Path $workspace '.emps-demo-visual-runtime.json'
$dbStatePath = Join-Path $workspace '.emps-demo-visual-db.json'
$processStatePath = Join-Path $workspace '.emps-demo-visual-processes.json'
$logs = Join-Path $repo 'tmp\demo-visual'
$container = 'emps-demo-visual-mysql'
$database = 'emps_demo_test'
$branch = (& git -C $repo branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'feat/gie-demo-history-mysql') {
    throw 'Execute este teste na branch feat/gie-demo-history-mysql.'
}
& git -C $repo merge-base --is-ancestor 50cc7c5 HEAD
if ($LASTEXITCODE -ne 0) { throw 'O commit validado 50cc7c5 não está na ancestralidade desta branch.' }
if (@($MySqlPort,$BackendPort,$SitePort,$LegacyGiePort,$GieV3Port | Select-Object -Unique).Count -ne 5) {
    throw 'As cinco portas locais precisam ser diferentes.'
}
if ($MySqlPort -ne 3307) { throw 'O importador demonstrativo exige MySQL local na porta 3307.' }
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function New-Secret([int]$bytes = 36) {
    $value = New-Object byte[] $bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($value) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($value).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Save-Json([string]$path, $value) {
    $json = $value | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($path, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}
function Assert-Exit([string]$task) {
    if ($LASTEXITCODE -ne 0) { throw "$task falhou (código $LASTEXITCODE)." }
}
function Wait-Http([string]$url, [hashtable]$headers = @{}, [int]$seconds = 90) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
        try { return Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 4 }
        catch { Start-Sleep -Seconds 1 }
    } while ((Get-Date) -lt $until)
    throw "Serviço local não respondeu: $url"
}
function Port-Open([int]$port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $port)
        return $task.Wait(300) -and $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}
function Port-Listening([int]$port) {
    try {
        return @((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)).Count -gt 0
    } catch {
        if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { return $false }
        throw "Não foi possível inspecionar a porta local $port sem conexão: $($_.Exception.Message)"
    }
}
function Get-ListenerIdentity([int]$port, [string]$name, [string]$signature) {
    try {
        $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port `
          -State Listen -ErrorAction Stop | Select-Object -First 1
        if (-not $listener) { throw 'listener ausente em 127.0.0.1' }
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction Stop
        $expectedName = if ($name -in @('backend','frontend')) { 'node' } else { 'python' }
        if ($process.ProcessName -ne $expectedName -or $details.CommandLine -notmatch $signature) {
            throw "PID $($listener.OwningProcess) não corresponde ao processo EMPS esperado"
        }
        return [pscustomobject]@{ pid=[int]$listener.OwningProcess;
          startedAtUtc=$process.StartTime.ToUniversalTime().ToString('o');
          parentPid=[int]$details.ParentProcessId }
    } catch {
        throw "Porta $port ocupada e identidade do processo local não pôde ser confirmada: $($_.Exception.Message)"
    }
}
function Assert-RegisteredListener([string]$name, [int]$port, [string]$signature) {
    $stored = $script:processState.services[$name]
    if (-not $stored -or $script:processState.fingerprint -ne $script:fingerprint -or
        [int]$stored.port -ne $port) {
        throw "Serviço ativo $name na porta $port não foi iniciado por este launcher com esta configuração; preservado sem consulta."
    }
    $actual = Get-ListenerIdentity $port $name $signature
    if ([int]$stored.pid -ne $actual.pid -or [string]$stored.startedAtUtc -ne $actual.startedAtUtc) {
        throw "Serviço ativo $name mudou de processo desde o registro local; preservado sem consulta."
    }
}
function Register-Listener([string]$name, [int]$port, [string]$signature, [int]$launchedPid) {
    $actual = Get-ListenerIdentity $port $name $signature
    $candidate = $actual.pid
    $related = $false
    for ($depth=0; $depth -lt 5 -and $candidate -gt 0; $depth++) {
        if ($candidate -eq $launchedPid) { $related = $true; break }
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$candidate" -ErrorAction Stop
        $candidate = [int]$details.ParentProcessId
    }
    if (-not $related) { throw "Listener $name não pertence ao processo iniciado por este launcher." }
    $script:processState.services[$name] = [pscustomobject]@{port=$port;pid=$actual.pid;
      startedAtUtc=$actual.startedAtUtc}
    Save-Json $processStatePath $script:processState
}
function Start-Local([string]$name, [string]$exe, [string[]]$arguments, [string]$directory) {
    $stdout = Join-Path $logs "$name.stdout.log"
    $stderr = Join-Path $logs "$name.stderr.log"
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $directory `
      -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Write-Host "$name iniciado (PID $($process.Id)); logs em $logs"
    return $process.Id
}

$docker = (Get-Command docker.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

if (Test-Path $dbStatePath) {
    $db = Get-Content -Raw -LiteralPath $dbStatePath | ConvertFrom-Json
} else {
    $db = [pscustomobject]@{ host='127.0.0.1'; port=3307; database=$database; container=$container;
      user='emps_demo'; rootPassword=(New-Secret); userPassword=(New-Secret) }
    Save-Json $dbStatePath $db
}
if ($db.host -ne '127.0.0.1' -or [int]$db.port -ne 3307 -or $db.database -ne $database -or
    $db.container -ne $container -or $db.user -ne 'emps_demo' -or
    [string]::IsNullOrWhiteSpace($db.rootPassword) -or [string]::IsNullOrWhiteSpace($db.userPassword)) {
    throw "Identidade do banco no arquivo $dbStatePath não confere com o teste isolado."
}
if (Test-Path $localState) {
    $runtime = Get-Content -Raw -LiteralPath $localState | ConvertFrom-Json
} else {
    $runtime = [pscustomobject]@{ frontendUrl="http://127.0.0.1:$SitePort";
      backendUrl="http://127.0.0.1:$BackendPort"; gieLegacyUrl="http://127.0.0.1:$LegacyGiePort";
      gieV3Url="http://127.0.0.1:$GieV3Port"; adminEmail='visual.local@emps.invalid';
      adminName='Administrador visual local'; adminPassword=(New-Secret 24); jwtSecret=(New-Secret 48);
      gieLegacyToken=(New-Secret 36); gieToken=(New-Secret 36) }
    Save-Json $localState $runtime
}
if ($runtime.frontendUrl -ne "http://127.0.0.1:$SitePort" -or
    $runtime.backendUrl -ne "http://127.0.0.1:$BackendPort" -or
    $runtime.gieLegacyUrl -ne "http://127.0.0.1:$LegacyGiePort" -or
    $runtime.gieV3Url -ne "http://127.0.0.1:$GieV3Port" -or
    -not $runtime.adminEmail.EndsWith('@emps.invalid') -or
    $runtime.adminPassword.Length -lt 12 -or $runtime.gieToken.Length -lt 24) {
    throw "Estado local em $localState não corresponde a estas portas ou credenciais demonstrativas."
}
$head = (& git -C $repo rev-parse HEAD).Trim()
Assert-Exit 'Identificação do checkout'
$fingerprintMaterial = @($repo,$head,$db.host,$db.port,$db.database,$db.container,
  $db.user,$db.rootPassword,$db.userPassword,$runtime.frontendUrl,$runtime.backendUrl,
  $runtime.gieLegacyUrl,$runtime.gieV3Url,$runtime.jwtSecret,
  $runtime.gieLegacyToken,$runtime.gieToken,$runtime.adminEmail,$runtime.adminName,
  $runtime.adminPassword,
  'NEXT_PUBLIC_EMPS_DEMO_MODE=false','PAYMENT_PROVIDER=sandbox',
  'EMPS_PHYSICAL_COMMANDS_ENABLED=false','EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED=false') -join "`n"
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $script:fingerprint = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprintMaterial)))).Replace('-','').ToLowerInvariant() }
finally { $sha.Dispose() }
$script:processState = [pscustomobject]@{ fingerprint=$script:fingerprint; services=@{} }
if (Test-Path $processStatePath) {
    $recorded = Get-Content -Raw -LiteralPath $processStatePath | ConvertFrom-Json
    if ($recorded.fingerprint -eq $script:fingerprint) {
        foreach ($item in $recorded.services.PSObject.Properties) {
            $script:processState.services[$item.Name] = $item.Value
        }
    } elseif (@($BackendPort,$SitePort,$LegacyGiePort,$GieV3Port | Where-Object { Port-Listening $_ }).Count -gt 0) {
        throw 'Configuração local mudou enquanto há serviços ativos; reinicie-os explicitamente antes de usar o launcher.'
    }
}
$signatures = @{
  backend='dist[\\/]main\.js';
  frontend='[\\/]next[\\/]dist[\\/].*(?:start-server\.js|bin[\\/]next)';
  'gie-v3'='gie_multistation';
  'gie-legado'='service\.api:create_app'
}
foreach ($service in @(@('backend',$BackendPort),@('frontend',$SitePort),
  @('gie-v3',$GieV3Port),@('gie-legado',$LegacyGiePort))) {
    if (Port-Listening ([int]$service[1])) {
        Assert-RegisteredListener ([string]$service[0]) ([int]$service[1]) $signatures[[string]$service[0]]
    }
}

$names = @(& $docker container ls -a --format '{{.Names}}')
Assert-Exit 'Inspeção Docker'
$fresh = $names -notcontains $container
if ($fresh) {
    if (Port-Open $MySqlPort) { throw "Porta MySQL $MySqlPort ocupada; nenhum serviço foi alterado." }
    & $docker run -d --rm --name $container --publish "127.0.0.1:${MySqlPort}:3306" `
      --env "MYSQL_ROOT_PASSWORD=$($db.rootPassword)" --env "MYSQL_DATABASE=$database" `
      --env "MYSQL_USER=$($db.user)" --env "MYSQL_PASSWORD=$($db.userPassword)" mysql:8.0 | Out-Null
    Assert-Exit 'Criação do MySQL descartável'
}
$inspect = @(& $docker inspect $container | ConvertFrom-Json)[0]
Assert-Exit 'Inspeção do contêiner'
$binding = @($inspect.NetworkSettings.Ports.'3306/tcp')[0]
$mounts = @($inspect.Mounts)
$anonymousMysqlVolume = $mounts.Count -eq 1 -and $mounts[0].Type -eq 'volume' -and
    $mounts[0].Destination -eq '/var/lib/mysql' -and
    $mounts[0].Name -match '^[0-9a-f]{64}$' -and
    $null -eq $inspect.HostConfig.Binds -and $null -eq $inspect.HostConfig.Mounts
if (-not $inspect.State.Running -or $inspect.Config.Image -ne 'mysql:8.0' -or
    -not $inspect.HostConfig.AutoRemove -or -not $anonymousMysqlVolume -or
    $binding.HostIp -ne '127.0.0.1' -or [int]$binding.HostPort -ne $MySqlPort -or
    $inspect.Config.Env -notcontains "MYSQL_DATABASE=$database" -or
    $inspect.Config.Env -notcontains "MYSQL_USER=$($db.user)") {
    throw 'Contêiner com mesmo nome não corresponde ao MySQL local descartável esperado; preservado sem alteração.'
}
$ready = $false
for ($i=0; $i -lt 90; $i++) {
    & $docker exec $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysqladmin ping -h 127.0.0.1 -u$MYSQL_USER --silent' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'MySQL local não ficou pronto.' }
$expectedTables = @('users','stations','gie_station_bindings','demo_import_batches',
  'demo_charging_sessions','demo_payments','demo_energy_readings')
$tables = @('SHOW TABLES;' | & $docker exec -i $container sh -lc 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE -N -B')
Assert-Exit 'Verificação do schema'
$present = @($tables | Where-Object { $expectedTables -contains $_ })
if ($tables.Count -eq 0) {
    $base = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $site 'database\EMPS_Database_Completo.sql')
    if (-not $base.Contains('CREATE DATABASE IF NOT EXISTS emps_db') -or -not $base.Contains('USE emps_db;')) {
        throw 'Schema-base inesperado; nenhuma alteração foi aplicada.'
    }
    $base = $base.Replace('CREATE DATABASE IF NOT EXISTS emps_db',
      'CREATE DATABASE IF NOT EXISTS emps_demo_test').Replace('USE emps_db;', 'USE emps_demo_test;')
    $baseFile = Join-Path $logs 'schema-local.sql'
    [IO.File]::WriteAllText($baseFile, $base, (New-Object System.Text.UTF8Encoding($false)))
    $sqlFiles = @($baseFile,
      (Join-Path $site 'database\patches\0001-gie-v3-multistation.sql'),
      (Join-Path $site 'database\patches\0002-demo-history.sql'))
    foreach ($index in 0..2) {
        & $docker cp $sqlFiles[$index] "${container}:/tmp/emps-demo-visual-$index.sql" | Out-Null
        Assert-Exit 'Cópia de SQL local'
        & $docker exec $container sh -lc ('MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE < /tmp/emps-demo-visual-' + $index + '.sql')
        Assert-Exit "Aplicação do SQL local $index"
    }
    Remove-Item -LiteralPath $baseFile
} elseif ($present.Count -ne $expectedTables.Count) {
    throw 'Schema local parcialmente aplicado; não será sobrescrito automaticamente.'
}
Write-Host 'Schema oficial e patches 0001/0002 confirmados no contêiner descartável.'

$dataUrl = 'mysql://' + $db.user + ':' + [uri]::EscapeDataString($db.userPassword) +
  '@127.0.0.1:3307/emps_demo_test'
$values = @{
    DATABASE_URL=$dataUrl; DEMO_HISTORY_TEST_DATABASE=$database; NODE_ENV='development';
    EMPS_REMOTE_DEVELOPMENT='false'; EMPS_REMOTE_ACCESS_MODE='';
    PAYMENT_PROVIDER='sandbox'; OCPP_GATEWAY_URL=''; OCPP_GATEWAY_TOKEN='';
    STRIPE_SECRET_KEY=''; STRIPE_WEBHOOK_SECRET=''; STRIPE_PUBLISHABLE_KEY='';
    EMPS_PHYSICAL_COMMANDS_ENABLED='false'; EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED='false';
    EMPS_BACKGROUND_JOBS_ENABLED='true'; JWT_SECRET=$runtime.jwtSecret;
    GIE_SERVICE_URL=$runtime.gieLegacyUrl; GIE_SERVICE_TOKEN=$runtime.gieLegacyToken;
    GIE_STATION_ID=''; GIE_COMMERCIAL_STATION_ID='';
    GIE_V3_SERVICE_URL=$runtime.gieV3Url; GIE_V3_SERVICE_TOKEN=$runtime.gieToken;
    GIE_V3_PROVISIONING_TOKEN=''; GIE_V3_TIMEOUT_MS='30000';
    GIE_NORMAL_DEMO='true'; GIE_WEATHER_ENABLED='false';
    NEXT_PUBLIC_API_URL=$runtime.backendUrl; NEXT_PUBLIC_EMPS_DEMO_MODE='false';
    CORS_ORIGINS="http://127.0.0.1:$SitePort,http://localhost:$SitePort";
    HOST='127.0.0.1'; PORT=[string]$BackendPort;
    ADMIN_EMAIL=$runtime.adminEmail; ADMIN_NAME=$runtime.adminName;
    ADMIN_PASSWORD=$runtime.adminPassword;
    GIE_MULTISTATION_TOKENS=('{"' + $runtime.gieToken + '":["Commercial_HighAutonomy_V2","DEMO_POSTO_24H_001","DEMO_CASA_001"]}');
    GIE_MULTISTATION_DATA_DIR=(Join-Path $logs 'gie-data');
    PYTHONPATH=(Join-Path $gie 'src')
}
$backendAlreadyRunning = Port-Open $BackendPort
if ($backendAlreadyRunning) {
    Assert-RegisteredListener 'backend' $BackendPort $signatures.backend
    Wait-Http "$($runtime.backendUrl)/auth/health" @{} 5 | Out-Null
    Write-Host 'Backend local já ativo; geração Prisma e build serão preservados.'
}
$saved = @{}
foreach ($key in $values.Keys) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$values[$key], 'Process')
}
try {
    foreach ($project in @($backend,$frontend)) {
        if (-not (Test-Path (Join-Path $project 'node_modules'))) {
            Push-Location $project
            try { & $npm ci; Assert-Exit 'Instalação npm local' } finally { Pop-Location }
        }
    }
    $python = Join-Path $gie '.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) {
        $py = (Get-Command py.exe -ErrorAction Stop).Source
        & $py -3.12 -m venv (Join-Path $gie '.venv'); Assert-Exit 'Criação do Python local'
        & $python -m pip install -r (Join-Path $gie 'requirements-service.txt')
        Assert-Exit 'Instalação Python local'
    }
    New-Item -ItemType Directory -Force -Path $values.GIE_MULTISTATION_DATA_DIR | Out-Null
    Push-Location $backend
    try {
        if (-not $backendAlreadyRunning) {
            & $npm run prisma:generate; Assert-Exit 'Prisma local'
            & $npm run build; Assert-Exit 'Build do backend'
        }
        $tsx = Join-Path $backend 'node_modules\.bin\tsx.cmd'
        $admin = (& $tsx 'scripts/bootstrap-admin.ts' | Select-Object -Last 1) | ConvertFrom-Json
        Assert-Exit 'Conta administrativa local'
        $shopping = (& $tsx 'scripts/demo-visual-shopping.ts' | Select-Object -Last 1) | ConvertFrom-Json
        Assert-Exit 'Shopping local'
    } finally { Pop-Location }
    $env:ADMIN_PASSWORD = ''
    $values.GIE_STATION_ID = [string]$shopping.shoppingId
    $values.GIE_COMMERCIAL_STATION_ID = [string]$shopping.shoppingId
    $env:GIE_STATION_ID = $values.GIE_STATION_ID
    $env:GIE_COMMERCIAL_STATION_ID = $values.GIE_COMMERCIAL_STATION_ID
    $headers = @{ Authorization = 'Bearer ' + $runtime.gieToken }
    if (Port-Open $GieV3Port) {
        Assert-RegisteredListener 'gie-v3' $GieV3Port $signatures['gie-v3']
        Wait-Http "$($runtime.gieV3Url)/v1/health" $headers 5 | Out-Null
    } else {
        $launched = Start-Local 'gie-v3' $python @('-B','-m','gie_multistation','--port',"$GieV3Port") $gie
        Wait-Http "$($runtime.gieV3Url)/v1/health" $headers 90 | Out-Null
        Register-Listener 'gie-v3' $GieV3Port $signatures['gie-v3'] $launched
    }
    $legacyHeaders = @{ Authorization = 'Bearer ' + $runtime.gieLegacyToken }
    if (Port-Open $LegacyGiePort) {
        Assert-RegisteredListener 'gie-legado' $LegacyGiePort $signatures['gie-legado']
        Wait-Http "$($runtime.gieLegacyUrl)/health" $legacyHeaders 5 | Out-Null
    } else {
        $launched = Start-Local 'gie-legado' $python @('-B','-m','uvicorn','service.api:create_app','--factory',
          '--host','127.0.0.1','--port',"$LegacyGiePort") $gie
        Wait-Http "$($runtime.gieLegacyUrl)/health" $legacyHeaders 90 | Out-Null
        Register-Listener 'gie-legado' $LegacyGiePort $signatures['gie-legado'] $launched
    }
    Push-Location $backend
    try {
        $demos = (& $tsx 'scripts/demo-visual-installations.ts' | Select-Object -Last 1) | ConvertFrom-Json
        Assert-Exit 'Cadastro GIE das duas instalações'
    } finally { Pop-Location }
    $posto = @($demos.installations | Where-Object gieStationId -eq 'DEMO_POSTO_24H_001')[0]
    $casa = @($demos.installations | Where-Object gieStationId -eq 'DEMO_CASA_001')[0]
    if (-not $posto -or -not $casa) { throw 'API não confirmou as duas instalações demonstrativas.' }
    Push-Location $backend
    try {
        & $tsx 'scripts/demo-history-import.ts' --apply --owner-id "$($admin.id)" `
          --commercial-id "$($shopping.shoppingId)" --posto-id "$($posto.stationId)" `
          --casa-id "$($casa.stationId)" --data-root $dataRoot
        Assert-Exit 'Importação idempotente dos três históricos'
    } finally { Pop-Location }
    foreach ($stationId in @('Commercial_HighAutonomy_V2','DEMO_POSTO_24H_001','DEMO_CASA_001')) {
        Invoke-RestMethod -Method Post -Uri "$($runtime.gieV3Url)/v1/stations/$stationId/initialize" `
          -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 120 | Out-Null
    }
    if ($backendAlreadyRunning) {
        Assert-RegisteredListener 'backend' $BackendPort $signatures.backend
        Wait-Http "$($runtime.backendUrl)/auth/health" @{} 5 | Out-Null
    } else {
        $launched = Start-Local 'backend' $node @((Join-Path $backend 'dist\main.js')) $backend
        Wait-Http "$($runtime.backendUrl)/auth/health" @{} 90 | Out-Null
        Register-Listener 'backend' $BackendPort $signatures.backend $launched
    }
    $login = Invoke-RestMethod -Method Post -Uri "$($runtime.backendUrl)/auth/login" `
      -ContentType 'application/json' -Body (@{ email=$runtime.adminEmail; password=$runtime.adminPassword } | ConvertTo-Json)
    if (-not $login.accessToken) { throw 'Login administrativo local não retornou token.' }
    if (Port-Open $SitePort) {
        Assert-RegisteredListener 'frontend' $SitePort $signatures.frontend
        Wait-Http "$($runtime.frontendUrl)/login" @{} 5 | Out-Null
    } else {
        # The browser app only needs its two NEXT_PUBLIC settings. Keep local
        # database and service secrets out of the Next.js child process.
        foreach ($key in @('DATABASE_URL','ADMIN_PASSWORD','JWT_SECRET','GIE_SERVICE_TOKEN',
          'GIE_V3_SERVICE_TOKEN','GIE_MULTISTATION_TOKENS','GIE_V3_PROVISIONING_TOKEN')) {
            [Environment]::SetEnvironmentVariable($key, '', 'Process')
        }
        $launched = Start-Local 'frontend' $node @((Join-Path $frontend 'node_modules\next\dist\bin\next'),
          'dev','--hostname','127.0.0.1','--port',"$SitePort") $frontend
        Wait-Http "$($runtime.frontendUrl)/login" @{} 120 | Out-Null
        Register-Listener 'frontend' $SitePort $signatures.frontend $launched
    }
    Write-Host "Site: $($runtime.frontendUrl)/login"
    Write-Host "Comparativo: $($runtime.frontendUrl)/stations/overview"
    Write-Host "API: $($runtime.backendUrl)/auth/health"
    Write-Host "Login local: $($runtime.adminEmail)"
    Write-Host "Senha local: $($runtime.adminPassword)"
    Write-Host "Instalações: Shopping $($shopping.shoppingId), Posto $($posto.stationId), Residência $($casa.stationId)"
    Write-Host 'Serviços permanecem ativos; o MySQL é descartável e isolado. Nenhuma VPS ou banco oficial foi acessado.'
} finally {
    foreach ($key in $values.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
