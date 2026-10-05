# Process ownership helpers. No global Node/Python termination; MySQL is never selected.
$EmpsRoot = 'C:\goodwill_ai\EMPS_GITHUB'
$EmpsBackend = Join-Path $EmpsRoot 'site\emps-site-main\backend'
$EmpsState = Join-Path $EmpsBackend 'reports\ecosystem-v2-state.json'
function Get-EmpsSnapshot {
    @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','python.exe','pythonw.exe','stripe.exe') })
}
function Expand-EmpsChildren($Snapshot, $Ids) {
    $selected = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($item in $Ids) { [void]$selected.Add([int]$item) }
    do {
        $changed = $false
        foreach ($item in $Snapshot) {
            if ($selected.Contains([int]$item.ParentProcessId) -and $selected.Add([int]$item.ProcessId)) { $changed=$true }
        }
    } while ($changed)
    @($Snapshot | Where-Object { $selected.Contains([int]$_.ProcessId) })
}
function Get-EmpsManaged($Snapshot) {
    if (-not (Test-Path -LiteralPath $EmpsState)) { return @() }
    $state = Get-Content -LiteralPath $EmpsState -Raw | ConvertFrom-Json
    if ($state.root -ne $EmpsRoot) { throw 'Unexpected launcher state root' }
    $ids = @()
    foreach ($record in @($state.supervisor)+@($state.children)) {
        $live = $Snapshot | Where-Object { $_.ProcessId -eq $record.pid }
        if (-not $live) { continue }
        $delta = [Math]::Abs(($live.CreationDate.ToUniversalTime()-([datetime]$record.startedAt).ToUniversalTime()).TotalSeconds)
        if ($delta -le 10 -and $live.CommandLine -like ('*'+$record.marker+'*')) { $ids += $live.ProcessId }
    }
    Expand-EmpsChildren $Snapshot $ids
}
function Get-EmpsConflicts($Snapshot) {
    $old = 'C:\Users\Tommaso\Desktop\ECOSYSTEM_EMPS\'
    $ids = @($Snapshot | Where-Object { $_.CommandLine -like ('*'+$EmpsRoot+'\*') -or $_.CommandLine -like ('*'+$old+'*') } | ForEach-Object ProcessId)
    # Relative launch commands are admitted only through an already identified child.
    foreach ($item in $Snapshot | Where-Object { $_.ProcessId -in $ids }) {
        $parent = $Snapshot | Where-Object { $_.ProcessId -eq $item.ParentProcessId }
        if ($parent -and ($parent.CommandLine -match 'scripts[/\\]start-ecosystem\.cjs|node_modules[/\\]next[/\\]dist[/\\]bin[/\\]next')) { $ids += $parent.ProcessId }
    }
    # Adopt the previously recorded, isolated previews only while their PID/command/time still match.
    foreach ($file in @('preview-processes.json','app-preview-process.json')) {
        $path = Join-Path $EmpsBackend ('reports\platform-v2\'+$file)
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $saved=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $entries = if ($file -eq 'preview-processes.json') { @($saved.backend,$saved.frontend) } else { @($saved) }
        foreach ($record in $entries) {
            $live=$Snapshot | Where-Object { $_.ProcessId -eq $record.pid }
            if ($live -and $record.cwd -like ($EmpsRoot+'\*') -and $live.CreationDate -le (Get-Item -LiteralPath $path).LastWriteTime -and $live.CommandLine -match 'dist[/\\]main\.js|node_modules[/\\](expo|next)[/\\]') { $ids += $live.ProcessId }
        }
    }
    $ids += @(Get-EmpsManaged $Snapshot | ForEach-Object ProcessId)
    Expand-EmpsChildren $Snapshot $ids
}
function Stop-EmpsRecords($Records) {
    foreach ($record in $Records) {
        $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$record.ProcessId)
        if ($live -and $live.CreationDate -eq $record.CreationDate -and $live.CommandLine -eq $record.CommandLine) {
            Write-Host ('Stopping EMPS PID '+$live.ProcessId+' '+$live.Name)
            Stop-Process -Id $live.ProcessId -ErrorAction SilentlyContinue
        }
    }
}
