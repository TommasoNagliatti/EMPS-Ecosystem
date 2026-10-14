$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'stop-remote-dev.ps1'
$tokens = $null
$errors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Stop script contains parser errors.' }
$assignment = $tree.Find({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and
    $node.Left.VariablePath.UserPath -eq 'startedUtc'
}, $true)
if (-not $assignment) { throw 'Recorded UTC conversion is missing.' }
$convert = [ScriptBlock]::Create($assignment.Right.Extent.Text)
$expected = [DateTimeOffset]::Parse('2026-10-10T18:37:42.033Z').UtcDateTime
$values = @('2026-10-10T18:37:42.033Z', $expected, [DateTimeOffset]::Parse('2026-10-10T15:37:42.033-03:00'))
foreach ($value in $values) {
    $state = [PSCustomObject]@{ startedAt = $value }
    $actual = & $convert
    if ($actual.Kind -ne [DateTimeKind]::Utc -or $actual -ne $expected) { throw 'UTC conversion changed the recorded instant.' }
}
Write-Output 'PASS: ISO string, UTC DateTime and DateTimeOffset preserve the same launcher instant. No process was stopped.'
