# Edits the packaged app's Local State, launches the probe, and restores the original bytes.
# This process is not the packaged app. It does not delete cipher.bin.
[CmdletBinding()]
param(
  [string] $Output
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$SpikeRoot = Split-Path -Parent $PSCommandPath
if (-not $Output) { $Output = Join-Path $SpikeRoot 'output\packaged' }
$Install = Join-Path $SpikeRoot 'install-spike.ps1'
$Edit = Join-Path $SpikeRoot 'edit-key.mjs'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Read-Utf8([string] $Path) {
  $text = [System.IO.File]::ReadAllText($Path, $utf8)
  if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
  return $text
}

function Read-JsonFile([string] $Path) {
  $parsed = ConvertFrom-Json -InputObject (Read-Utf8 $Path)
  Write-Output -NoEnumerate $parsed
}

function Get-CipherHash {
  $file = Join-Path $Output 'cipher.bin'
  if (-not (Test-Path -LiteralPath $file)) { return '' }
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-LocalState([string] $ClaimedUserData, [string] $ClaimedFile) {
  if ($ClaimedFile -and (Test-Path -LiteralPath $ClaimedFile)) { return $ClaimedFile }
  $package = Get-AppxPackage -Name 'Obelisk.SpikeS07' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $package) { throw 'Obelisk.SpikeS07 is not installed.' }
  $roaming = [Environment]::GetFolderPath('ApplicationData')
  $suffix = 'Obelisk Spike S-07'
  if ($ClaimedUserData -and $ClaimedUserData.StartsWith($roaming, [System.StringComparison]::OrdinalIgnoreCase)) {
    $suffix = $ClaimedUserData.Substring($roaming.Length).TrimStart('\')
  }
  $mapped = Join-Path $env:LOCALAPPDATA "Packages\$($package.PackageFamilyName)\LocalCache\Roaming\$suffix\Local State"
  if (Test-Path -LiteralPath $mapped) { return $mapped }
  $root = Join-Path $env:LOCALAPPDATA "Packages\$($package.PackageFamilyName)\LocalCache"
  if (Test-Path -LiteralPath $root) {
    $found = @(Get-ChildItem -LiteralPath $root -Filter 'Local State' -Recurse -File -ErrorAction SilentlyContinue)
    $preferred = $found | Where-Object { $_.FullName -like '*Obelisk Spike S-07*' } | Select-Object -First 1
    if ($preferred) { return $preferred.FullName }
    if ($found.Count -eq 1) { return $found[0].FullName }
  }
  throw "Local State was not found. The app named $ClaimedFile."
}

function Invoke-Probe([string] $Label) {
  # The install script prints status lines. Those must not become this function's return value.
  $logged = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Install -Action Run -Phase Probe -Output $Output 2>&1
  if ($null -eq $LASTEXITCODE) { $code = 1 } else { $code = [int]$LASTEXITCODE }
  $logPath = Join-Path $Output "observe-$Label.txt"
  $lines = @($logged | ForEach-Object { "$_" })
  [System.IO.File]::WriteAllText($logPath, (($lines -join "`n").TrimEnd() + "`n"), $utf8)
  $reportPath = Join-Path $Output 'report-probe.json'
  $kept = Join-Path $Output "report-probe-$Label.json"
  if (Test-Path -LiteralPath $reportPath) {
    Copy-Item -LiteralPath $reportPath -Destination $kept -Force
  }
  return $code
}

function Convert-Experiment([string] $Id, [string] $LocalState, [int] $LaunchCode, [string] $LaunchError) {
  $reportPath = Join-Path $Output "report-probe-$Id.json"
  $row = [ordered]@{
    id = $Id
    localState = $LocalState
    launchCode = $LaunchCode
    launchError = $LaunchError
    encryptionAvailable = $null
    asyncEncryptionAvailable = $null
    sessionEncryption = $null
    plaintextMatch = $null
    shouldReEncrypt = $null
    temporarilyUnavailable = $null
    encryptError = $null
    decryptError = $null
    ok = $null
  }
  if (Test-Path -LiteralPath $reportPath) {
    $report = Read-JsonFile $reportPath
    $row.encryptionAvailable = $report.encryptionAvailable
    $row.asyncEncryptionAvailable = $report.asyncEncryptionAvailable
    $row.sessionEncryption = $report.sessionEncryption
    $row.plaintextMatch = $report.plaintextMatch
    $row.shouldReEncrypt = $report.shouldReEncrypt
    $row.temporarilyUnavailable = $report.temporarilyUnavailable
    $row.encryptError = $report.encryptError
    $row.decryptError = $report.decryptError
    $row.ok = $report.ok
  }
  return [pscustomobject]$row
}

$encryptPath = Join-Path $Output 'report-encrypt.json'
if (-not (Test-Path -LiteralPath $encryptPath)) { throw "No encrypt report at $encryptPath. Run -Phase Encrypt first." }
$encrypt = Read-JsonFile $encryptPath
if ($encrypt.sessionEncryption -ne $true) { throw 'The encrypt launch did not store a signature, so the state experiments have nothing to protect.' }

Get-Process -Name 'ObeliskSpikeS07' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$localState = Resolve-LocalState ([string]$encrypt.userData) ([string]$encrypt.localState)
$before = Get-CipherHash
if (-not $before) { throw 'cipher.bin is missing.' }

$experiments = New-Object System.Collections.Generic.List[object]
foreach ($mode in @('invalid-header', 'dpapi-fail')) {
  $backup = "$localState.s07-backup"
  $launchCode = -1
  $launchError = ''
  Copy-Item -LiteralPath $localState -Destination $backup -Force
  try {
    & node $Edit $localState $mode
    if ($LASTEXITCODE -ne 0) { throw "edit-key.mjs exited $LASTEXITCODE for $mode." }
    $launchCode = Invoke-Probe $mode
    if ($launchCode -ne 0) { $launchError = "probe exited $launchCode" }
  } catch {
    $launchError = $_.Exception.Message
    Write-Output "S07_STATE_ERROR $mode $launchError"
  } finally {
    Get-Process -Name 'ObeliskSpikeS07' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    if (Test-Path -LiteralPath $backup) {
      Copy-Item -LiteralPath $backup -Destination $localState -Force
      Remove-Item -LiteralPath $backup -Force
    }
  }
  $experiments.Add((Convert-Experiment $mode $localState $launchCode $launchError)) | Out-Null
  $mid = Get-CipherHash
  if ($mid -ne $before) { throw "cipher.bin changed during $mode." }
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Install -Action Run -Phase Decrypt -Output $Output
$restoreCode = $LASTEXITCODE
$decrypt = $null
$decryptPath = Join-Path $Output 'report-decrypt.json'
if (Test-Path -LiteralPath $decryptPath) { $decrypt = Read-JsonFile $decryptPath }
$after = Get-CipherHash
$restored = $restoreCode -eq 0 -and $null -ne $decrypt -and $decrypt.plaintextMatch -eq $true -and $decrypt.restart -eq $true
$unchanged = $after -eq $before
$reencrypt = $null
if ($null -ne $decrypt) { $reencrypt = $decrypt.shouldReEncrypt }

$summary = [ordered]@{
  cipherSha256 = $before
  cipherUnchanged = $unchanged
  restoredDecryptMatch = $restored
  restoreLaunchCode = $restoreCode
  shouldReEncrypt = $reencrypt
  experiments = @($experiments.ToArray())
}
$json = $summary | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $Output 'states-report.json'), ($json.TrimEnd() + "`n"), $utf8)
Write-Output "S07_OBSERVE cipherUnchanged=$unchanged restored=$restored"
foreach ($item in $experiments) {
  Write-Output "S07_STATE $($item.id) available=$($item.encryptionAvailable) async=$($item.asyncEncryptionAvailable) temporary=$($item.temporarilyUnavailable) encrypt=$($item.encryptError) decrypt=$($item.decryptError)"
}

if (-not $unchanged -or -not $restored) { exit 1 }
