param(
    [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA 'WhaleHome\bridge.xml'),
    [string]$NodePath = (Join-Path $env:ProgramFiles 'nodejs\node.exe')
)
$ErrorActionPreference = 'Stop'
$stage = 'credentials'
$stateFile = Join-Path (Split-Path -Parent $CredentialPath) 'bridge-status.txt'
try {
    $bridge = Import-Clixml -LiteralPath $CredentialPath
    $env:WHALE_SITE_ORIGIN = $bridge.Origin
    $env:WHALE_SITE_ACCESS = [Net.NetworkCredential]::new('', $bridge.Access).Password
    $env:WHALE_BRIDGE_KEY = [Net.NetworkCredential]::new('', $bridge.Key).Password
    $stage = 'node'
    if (!(Test-Path -LiteralPath $NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
    $stage = 'running'
    $env:WHALE_BRIDGE_STATUS = Join-Path (Split-Path -Parent $CredentialPath) 'gateway-status.json'
    [IO.File]::WriteAllText($stateFile, ((Get-Date -Format o) + ' running'))
    & $NodePath (Join-Path $PSScriptRoot 'qq-bridge.mjs')
    [IO.File]::WriteAllText($stateFile, ((Get-Date -Format o) + ' exited ' + $LASTEXITCODE))
    exit $LASTEXITCODE
} catch {
    [IO.File]::WriteAllText($stateFile, ((Get-Date -Format o) + ' failed at ' + $stage + ' ' + $_.Exception.GetType().Name))
    exit 1
} finally {
    Remove-Item Env:WHALE_SITE_ACCESS, Env:WHALE_BRIDGE_KEY -ErrorAction SilentlyContinue
}
