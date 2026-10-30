# Installs, runs, or removes Obelisk.SpikeS07. It does not remove Obelisk.Dev.
# Ci is the unattended path: trust when elevated, install, encrypt, decrypt, uninstall.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Ci', 'Install', 'Run', 'Uninstall')]
  [string] $Action,
  [string] $Msix,
  [string] $Certificate,
  [string] $Output,
  [string] $Phase
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PackageName = 'Obelisk.SpikeS07'
$FolderName = 'Obelisk-Spike-S07'
$ExeName = 'ObeliskSpikeS07.exe'
$Publisher = 'CN=Obelisk Dev'
$SpikeRoot = Split-Path -Parent $PSCommandPath
if (-not $Output) { $Output = Join-Path $SpikeRoot 'output\packaged' }
$Output = [System.IO.Path]::GetFullPath($Output)

$script:Imported = New-Object System.Collections.Generic.List[string]
$script:Thumb = $null
$script:DevBefore = $null

function Test-IsElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-DevStamp {
  $packages = @(Get-AppxPackage -Name 'Obelisk.Dev' -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Obelisk.Dev' })
  if ($packages.Count -eq 0) { return 'absent' }
  return (($packages | ForEach-Object { $_.PackageFullName }) -join ',')
}

function Get-SpikePackage {
  return @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $PackageName } | Select-Object -First 1)
}

function Stop-SpikeProcesses {
  Get-Process -Name 'ObeliskSpikeS07' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Uninstall-Spike {
  Stop-SpikeProcesses
  $packages = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $PackageName })
  foreach ($package in $packages) {
    Remove-AppxPackage -Package $package.PackageFullName
  }
}

function Import-PublicCert([string] $File, [string] $StoreName, [string] $Location) {
  $loaded = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $File
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($StoreName, $Location)
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  try {
    $store.Add($loaded)
  } finally {
    $loaded.Dispose()
    $store.Close()
  }
  $script:Imported.Add("$Location|$StoreName")
}

function Remove-PublicCert([string] $Thumb, [string] $StoreName, [string] $Location) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($StoreName, $Location)
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  try {
    $found = $store.Certificates.Find(
      [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $Thumb,
      $false
    )
    foreach ($item in @($found)) { $store.Remove($item) }
  } finally {
    $store.Close()
  }
}

function Enable-Sideloading {
  $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
  if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name AllowAllTrustedApps -PropertyType DWord -Value 1 -Force | Out-Null
  New-ItemProperty -Path $key -Name AllowDevelopmentWithoutDevLicense -PropertyType DWord -Value 1 -Force | Out-Null
}

function Read-Utf8([string] $Path) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $text = [System.IO.File]::ReadAllText($Path, $utf8)
  if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
  return $text
}

function Read-JsonFile([string] $Path) {
  $parsed = ConvertFrom-Json -InputObject (Read-Utf8 $Path)
  Write-Output -NoEnumerate $parsed
}

function Read-PackageText([string] $PackagePath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    $entry = $zip.GetEntry('AppxManifest.xml')
    if (-not $entry) { throw "AppxManifest.xml is missing from $PackagePath." }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $zip.Dispose()
  }
}

function Assert-SpikeManifest([string] $Text, [string] $Label) {
  if ($Text -notmatch 'Name="Obelisk\.SpikeS07"') { throw "$Label is not Obelisk.SpikeS07." }
  if ($Text -match 'Name="Obelisk\.Dev"') { throw "$Label uses Obelisk.Dev." }
  if ($Text -match '\.obk') { throw "$Label mentions .obk." }
  if ($Text -match 'windows.fileTypeAssociation') { throw "$Label registers a file type." }
  if ($Text -notmatch 'ObeliskSpikeS07\.exe') { throw "$Label has no ObeliskSpikeS07.exe." }
  if ($Text -notmatch 'Category="windows.appExecutionAlias"') { throw "$Label has no app execution alias." }
  if ($Text -notmatch 'Alias="ObeliskSpikeS07.exe"') { throw "$Label alias is not ObeliskSpikeS07.exe." }
}

function Install-SpikePackage([string] $Path) {
  try {
    Add-AppxPackage -Path $Path -ForceUpdateFromAnyVersion -ErrorAction Stop
    return $null
  } catch {
    return $_.Exception.Message
  }
}

function Remove-TreeIfPresent([string] $Dir) {
  if ($Dir -and (Test-Path -LiteralPath $Dir)) {
    Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Clear-TestFiles {
  $documents = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $FolderName
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) $FolderName
  $localDesktop = Join-Path $env:USERPROFILE "Desktop\$FolderName"
  $oneDrive = Join-Path $env:USERPROFILE "OneDrive\Documents\$FolderName"
  Remove-TreeIfPresent $documents
  Remove-TreeIfPresent $desktop
  Remove-TreeIfPresent $localDesktop
  if (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'OneDrive\Documents')) {
    Remove-TreeIfPresent $oneDrive
  }
  Remove-TreeIfPresent (Join-Path $env:APPDATA 'Obelisk Spike S-07')
}

function Assert-DevUnchanged {
  $after = Get-DevStamp
  if ($script:DevBefore -ne $after) {
    throw "Obelisk.Dev changed from '$($script:DevBefore)' to '$after'."
  }
}

function Format-Arguments([string[]] $Items) {
  return (($Items | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' ')
}

function Get-AppAlias {
  $alias = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\$ExeName"
  for ($try = 0; $try -lt 10; $try++) {
    if (Test-Path -LiteralPath $alias) { return $alias }
    Start-Sleep -Milliseconds 500
  }
  throw "The app execution alias is not at $alias. This script does not start the copy under Program Files\WindowsApps. Smart App Control blocks that path."
}

function Start-Logged([string] $File, [string[]] $ArgumentList, [hashtable] $EnvExtra) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $File
  $info.Arguments = Format-Arguments $ArgumentList
  $info.WorkingDirectory = $env:TEMP
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($key in @($EnvExtra.Keys)) {
    $info.EnvironmentVariables[$key] = [string]$EnvExtra[$key]
  }
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Could not start $File." }
  return [pscustomobject]@{
    Process = $process
    Stdout = $process.StandardOutput.ReadToEndAsync()
    Stderr = $process.StandardError.ReadToEndAsync()
  }
}

function Save-Logged($Handle, [string] $StdoutPath, [string] $StderrPath) {
  if (-not $Handle) { return }
  $process = $Handle.Process
  if (-not $process.HasExited) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    $null = $process.WaitForExit(15000)
  }
  $stdout = ''
  $stderr = ''
  try { $stdout = $Handle.Stdout.Result } catch { $stdout = '' }
  try { $stderr = $Handle.Stderr.Result } catch { $stderr = '' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StdoutPath) | Out-Null
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($StdoutPath, $stdout, $utf8)
  [System.IO.File]::WriteAllText($StderrPath, $stderr, $utf8)
}

function Test-HasLeaks($Report) {
  if ($null -eq $Report.leaks) { return $false }
  $items = @($Report.leaks)
  if ($items.Count -eq 1 -and [string]::IsNullOrEmpty([string]$items[0])) { return $false }
  return $items.Count -gt 0
}

function Invoke-Phase([string] $Executable, [string] $PhaseName) {
  $name = $PhaseName.ToLowerInvariant()
  if ($name -ne 'encrypt' -and $name -ne 'decrypt' -and $name -ne 'probe') {
    throw "Phase must be Encrypt, Decrypt, or Probe. Got '$PhaseName'."
  }
  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  Stop-SpikeProcesses
  Write-Host "S07_ALIAS $Executable"
  $handle = Start-Logged $Executable @('--phase', $name, '--output', $Output) @{
    OBELISK_S07_OUTPUT = $Output
    OBELISK_S07_PHASE = $name
  }
  $timedOut = -not $handle.Process.WaitForExit(180000)
  $stdoutPath = Join-Path $Output "packaged-$name-stdout.txt"
  $stderrPath = Join-Path $Output "packaged-$name-stderr.txt"
  Save-Logged $handle $stdoutPath $stderrPath
  if ($timedOut) { throw "The $name launch did not exit within 180 seconds." }
  $reportPath = Join-Path $Output "report-$name.json"
  if (-not (Test-Path -LiteralPath $reportPath)) {
    throw "The $name launch exited $($handle.Process.ExitCode) and did not write $reportPath."
  }
  $report = Read-JsonFile $reportPath
  if ($handle.Process.ExitCode -ne 0 -or $report.ok -ne $true) {
    throw "The $name launch exited $($handle.Process.ExitCode) and report ok is $($report.ok)."
  }
  if ($report.phase -ne $name) { throw "The report phase is $($report.phase), not $name." }
  Write-Host "S07_PHASE $name exit=$($handle.Process.ExitCode) session=$($report.sessionEncryption) match=$($report.plaintextMatch) shouldReEncrypt=$($report.shouldReEncrypt) available=$($report.encryptionAvailable) async=$($report.asyncEncryptionAvailable)"
  return $report
}

function Assert-RoundTrip($Encrypt, $Decrypt) {
  $png = Join-Path $Output 'walkthrough.png'
  if (-not (Test-Path -LiteralPath $png) -or (Get-Item -LiteralPath $png).Length -lt 100) {
    throw 'walkthrough.png is missing.'
  }
  if ($Encrypt.electron.version -ne '45.0.0') { throw "Electron $($Encrypt.electron.version) is not 45.0.0." }
  if ($Encrypt.packaged -ne $true) { throw 'The encrypt launch was not packaged.' }
  if ($Encrypt.windowsStore -ne $true) { throw 'process.windowsStore was not true.' }
  if ($Decrypt.packaged -ne $true) { throw 'The decrypt launch was not packaged.' }
  if ($Encrypt.sessionEncryption -eq $true) {
    if ($Encrypt.plaintextMatch -ne $true) { throw 'The packaged encrypt launch did not match the plaintext.' }
    if (Test-HasLeaks $Encrypt) { throw 'The ciphertext still holds readable signature text.' }
    if ($Decrypt.plaintextMatch -ne $true -or $Decrypt.restart -ne $true) { throw 'The packaged restart did not decrypt the signature.' }
    if ($null -eq $Decrypt.shouldReEncrypt) { throw 'shouldReEncrypt was not recorded.' }
    if (-not (Test-Path -LiteralPath (Join-Path $Output 'cipher.bin'))) { throw 'cipher.bin is missing.' }
    Write-Output "S07_ROUNDTRIP match shouldReEncrypt=$($Decrypt.shouldReEncrypt) available=$($Encrypt.encryptionAvailable) async=$($Encrypt.asyncEncryptionAvailable)"
    return
  }
  $reason = ("$($Encrypt.encryptError) $($Encrypt.decryptError)").Trim()
  if (-not $reason) { throw 'Encryption did not complete and the report has no error text.' }
  Write-Output "S07_SESSION unavailable $reason"
}

$script:DevBefore = Get-DevStamp
Write-Output "S07_DEV_BEFORE $($script:DevBefore)"

try {
  if ($Action -eq 'Uninstall') {
    Uninstall-Spike
    $still = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $PackageName })
    if ($still.Count -gt 0) { throw 'Obelisk.SpikeS07 is still installed.' }
    Clear-TestFiles
    Write-Output 'S07_UNINSTALLED Obelisk.SpikeS07'
    return
  }

  if ($Action -eq 'Run') {
    if (-not $Phase) { throw 'Run needs -Phase Encrypt, Decrypt, or Probe.' }
    $package = Get-SpikePackage
    if (-not $package) { throw 'Obelisk.SpikeS07 is not installed.' }
    Write-Output "S07_PACKAGE $($package.PackageFullName)"
    Invoke-Phase (Get-AppAlias) $Phase | Out-Null
    return
  }

  if ($Action -eq 'Install' -or $Action -eq 'Ci') {
    if (-not $Msix) { throw "$Action needs -Msix." }
    if (-not (Test-Path -LiteralPath $Msix)) { throw "MSIX not found: $Msix" }
    $Msix = (Resolve-Path -LiteralPath $Msix).Path
    $packageText = Read-PackageText $Msix
    Assert-SpikeManifest $packageText $Msix
    if ($Action -eq 'Ci') {
      if (-not $Certificate) { throw 'Ci needs -Certificate.' }
      $Certificate = (Resolve-Path -LiteralPath $Certificate).Path
      $loaded = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $Certificate
      if ($loaded.Subject -ne $Publisher) { throw "Certificate subject '$($loaded.Subject)' is not $Publisher." }
      $script:Thumb = $loaded.Thumbprint
      $loaded.Dispose()
      if (Test-IsElevated) {
        Import-PublicCert $Certificate 'TrustedPeople' 'LocalMachine'
        try { Enable-Sideloading } catch { Write-Output "S07_SIDELOAD $($_.Exception.Message)" }
      }
    }
    Uninstall-Spike
    $installError = Install-SpikePackage $Msix
    if ($installError -and $Action -eq 'Ci' -and (Test-IsElevated)) {
      Write-Output "S07_INSTALL trusted-people failed: $installError"
      Import-PublicCert $Certificate 'Root' 'LocalMachine'
      $installError = Install-SpikePackage $Msix
    }
    if ($installError) {
      throw "Add-AppxPackage failed: $installError`nTrust CN=Obelisk Dev in LocalMachine\TrustedPeople, then install again as a standard user. This package is Obelisk.SpikeS07, not Obelisk.Dev."
    }
    $installed = Get-SpikePackage
    if (-not $installed) { throw 'The package installed but Get-AppxPackage did not return Obelisk.SpikeS07.' }
    if ($installed.Name -ne $PackageName) { throw "Installed name is $($installed.Name)." }
    $installedManifest = Join-Path $installed.InstallLocation 'AppxManifest.xml'
    Assert-SpikeManifest (Read-Utf8 $installedManifest) $installedManifest
    Write-Output "S07_INSTALLED $($installed.PackageFullName)"
    if ($Action -eq 'Install') { return }

    if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Output | Out-Null
    $alias = Get-AppAlias
    $encrypt = Invoke-Phase $alias 'encrypt'
    $decrypt = Invoke-Phase $alias 'decrypt'
    Assert-RoundTrip $encrypt $decrypt
    if ($encrypt.sessionEncryption -eq $true) {
      $observe = Join-Path $SpikeRoot 'observe-states.ps1'
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $observe -Output $Output
      if ($LASTEXITCODE -ne 0) { throw "observe-states.ps1 exited $LASTEXITCODE." }
      $statesPath = Join-Path $Output 'states-report.json'
      if (-not (Test-Path -LiteralPath $statesPath)) { throw 'states-report.json is missing.' }
      $states = Read-JsonFile $statesPath
      if ($states.restoredDecryptMatch -ne $true) { throw 'The signature did not decrypt after the state experiments restored the key.' }
      if ($states.cipherUnchanged -ne $true) { throw 'The state experiments changed cipher.bin.' }
      Write-Output 'S07_STATES recorded'
    }
  }
} finally {
  if ($Action -eq 'Ci') {
    try { Uninstall-Spike } catch { Write-Output "S07_CLEANUP $($_.Exception.Message)" }
    try { Clear-TestFiles } catch { Write-Output "S07_CLEANUP $($_.Exception.Message)" }
    foreach ($entry in @($script:Imported)) {
      $parts = $entry.Split('|')
      try { Remove-PublicCert $script:Thumb $parts[1] $parts[0] } catch { Write-Output "S07_CLEANUP $($parts[0])\$($parts[1]): $($_.Exception.Message)" }
    }
  }
  Assert-DevUnchanged
  Write-Output "S07_DEV_AFTER $(Get-DevStamp)"
}
