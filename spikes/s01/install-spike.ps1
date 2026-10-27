# Installs, runs, or removes Obelisk.SpikeS01. It does not remove Obelisk.Dev.
# Ci is the unattended path: trust when elevated, install, launch, Get-Item from this process, uninstall.
# Run launches an already installed package and then runs confirm-outside.ps1 in this process.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Ci', 'Install', 'Run', 'Uninstall')]
  [string] $Action,
  [string] $Msix,
  [string] $Certificate,
  [string] $Second,
  [string] $Output
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PackageName = 'Obelisk.SpikeS01'
$FolderName = 'Obelisk-Spike-S01'
$ExeName = 'ObeliskSpikeS01.exe'
$Publisher = 'CN=Obelisk Dev'
$SpikeRoot = Split-Path -Parent $PSCommandPath
if (-not $Output) { $Output = Join-Path $SpikeRoot 'output\packaged' }
if (-not $Second) { $Second = [Environment]::GetFolderPath('Desktop') }

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

function Uninstall-Spike {
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

function Format-Arguments([string[]] $Items) {
  return (($Items | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' ')
}

function Start-Hidden([string] $File, [string[]] $ArgumentList) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $File
  $info.Arguments = Format-Arguments $ArgumentList
  $info.WorkingDirectory = $env:TEMP
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Could not start $File." }
  $null = $process.StandardOutput.ReadToEndAsync()
  $null = $process.StandardError.ReadToEndAsync()
  return $process
}

function Start-Watcher([string] $Go, [string] $Summary) {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script = Join-Path $SpikeRoot 'watch-replace.ps1'
  return Start-Hidden $powershell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $script, '-Go', $Go, '-Summary', $Summary
  )
}

function Start-SpikeApp([string] $Executable, [string] $OutDir, [string] $SecondFolder) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.WorkingDirectory = $env:TEMP
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables['OBELISK_S01_AUTO'] = '1'
  $info.EnvironmentVariables['OBELISK_S01_OUTPUT'] = $OutDir
  $info.EnvironmentVariables['OBELISK_S01_SECOND'] = $SecondFolder
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Could not start $Executable." }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit(300000)
  if ($timedOut) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    $process.WaitForExit() | Out-Null
  }
  $stdout = ''
  $stderr = ''
  try { $stdout = $stdoutTask.Result } catch { $stdout = '' }
  try { $stderr = $stderrTask.Result } catch { $stderr = '' }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  Set-Content -LiteralPath (Join-Path $OutDir 'packaged-stdout.txt') -Value $stdout
  Set-Content -LiteralPath (Join-Path $OutDir 'packaged-stderr.txt') -Value $stderr
  if ($timedOut) { throw 'The spike package did not exit within 300 seconds.' }
  return $process.ExitCode
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

function Clear-TestFiles([string] $SecondFolder) {
  $documents = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $FolderName
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) $FolderName
  Remove-TreeIfPresent $documents
  Remove-TreeIfPresent $desktop
  if ($SecondFolder) {
    Remove-TreeIfPresent (Join-Path $SecondFolder $FolderName)
  }
  Remove-TreeIfPresent (Join-Path $env:APPDATA 'obelisk-spike-s01')
  Remove-TreeIfPresent (Join-Path $env:APPDATA 'Obelisk Spike S-01')
  Remove-TreeIfPresent (Join-Path $env:APPDATA $FolderName)
  Remove-TreeIfPresent (Join-Path $env:LOCALAPPDATA $FolderName)
}

function Assert-DevUnchanged {
  $after = Get-DevStamp
  if ($script:DevBefore -ne $after) {
    throw "Obelisk.Dev changed from '$($script:DevBefore)' to '$after'."
  }
}

function Invoke-Confirm([string] $OutDir) {
  $claim = Join-Path $OutDir 'claim.json'
  $report = Join-Path $OutDir 'outside-report.json'
  $script = Join-Path $SpikeRoot 'confirm-outside.ps1'
  $confirmOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Claim $claim -Report $report
  $confirmExit = $LASTEXITCODE
  foreach ($line in @($confirmOut)) { if ($null -ne $line -and "$line" -ne '') { Write-Host $line } }
  if ($confirmExit -ne 0) { throw "confirm-outside.ps1 exited $confirmExit." }
  if (-not (Test-Path -LiteralPath $report)) { throw "No outside report at $report." }
  $text = [System.IO.File]::ReadAllText($report)
  $parsed = ConvertFrom-Json -InputObject $text
  Write-Output -NoEnumerate $parsed
}

function Test-WatchClean($Watch) {
  if (-not $Watch) { return 'no watcher summary' }
  if ($Watch.error) { return [string]$Watch.error }
  if ([int]$Watch.missing -gt 0 -or [int]$Watch.partial -gt 0) {
    return "missing=$($Watch.missing) partial=$($Watch.partial)"
  }
  if ([int]$Watch.seenA -lt 1 -or [int]$Watch.seenB -lt 1 -or [int]$Watch.samples -lt 1) {
    return "seenA=$($Watch.seenA) seenB=$($Watch.seenB) samples=$($Watch.samples)"
  }
  return $null
}

function Invoke-Run([switch] $FailOnFindings) {
  $package = Get-SpikePackage
  if (-not $package) { throw 'Obelisk.SpikeS01 is not installed.' }
  $exe = Join-Path $package.InstallLocation $ExeName
  if (-not (Test-Path -LiteralPath $exe)) { throw "Packaged executable is missing: $exe" }
  if (Test-Path -LiteralPath $Output) {
    Remove-Item -LiteralPath $Output -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  Set-Content -LiteralPath (Join-Path $Output 'second-path.txt') -Value $Second -Encoding utf8
  $watchDocuments = Start-Watcher (Join-Path $Output 'rename-go-documents.json') (Join-Path $Output 'watch-outside-documents.json')
  $watchSecond = Start-Watcher (Join-Path $Output 'rename-go-second.json') (Join-Path $Output 'watch-outside-second.json')
  $code = 1
  try {
    $code = Start-SpikeApp $exe $Output $Second
    if (-not $watchDocuments.WaitForExit(30000)) { & taskkill.exe /PID $watchDocuments.Id /T /F | Out-Null }
    if (-not $watchSecond.WaitForExit(30000)) { & taskkill.exe /PID $watchSecond.Id /T /F | Out-Null }
  } catch {
    if (-not $watchDocuments.HasExited) { & taskkill.exe /PID $watchDocuments.Id /T /F | Out-Null }
    if (-not $watchSecond.HasExited) { & taskkill.exe /PID $watchSecond.Id /T /F | Out-Null }
    throw
  }
  $claimPath = Join-Path $Output 'claim.json'
  if (-not (Test-Path -LiteralPath $claimPath)) {
    throw "The spike package exited $code and did not write claim.json. See packaged-stdout.txt in the output folder."
  }
  $outside = Invoke-Confirm $Output
  if ($outside -is [System.Array]) { $outside = $outside[0] }
  if ($code -ne 0) {
    throw "The spike package exited $code. See packaged-stdout.txt and outside-report.json in the output folder."
  }
  $docWatch = Test-WatchClean $outside.watchOutsideDocuments
  $secondWatch = Test-WatchClean $outside.watchOutsideSecond
  Write-Output "S01_VERDICT documents=$($outside.documents.verdict) second=$($outside.second.verdict) userData=$($outside.userData.verdict) roaming=$($outside.roaming.verdict) local=$($outside.local.verdict)"
  Write-Output "S01_WATCH documents=$(if ($docWatch) { $docWatch } else { 'clean' }) second=$(if ($secondWatch) { $secondWatch } else { 'clean' })"
  Write-Output "S01_PATHS userData=$($outside.claimedUserData) documents=$($outside.claimedDocuments)"
  if (-not $FailOnFindings) { return }
  $problems = New-Object System.Collections.Generic.List[string]
  if ($outside.documents.verdict -ne 'real') { $problems.Add("documents=$($outside.documents.verdict)") }
  if ($outside.second.verdict -ne 'real') { $problems.Add("second=$($outside.second.verdict)") }
  if ($docWatch) { $problems.Add("documents watch: $docWatch") }
  if ($secondWatch) { $problems.Add("second watch: $secondWatch") }
  if (-not $outside.userData.verdict) { $problems.Add('userData verdict missing') }
  if ($problems.Count -gt 0) {
    throw ("Packaged checks did not pass: " + ($problems -join '; '))
  }
}

$script:DevBefore = Get-DevStamp
Write-Output "S01_DEV_BEFORE $($script:DevBefore)"

try {
  if ($Action -eq 'Uninstall') {
    Uninstall-Spike
    $still = @(Get-SpikePackage)
    if ($still.Count -gt 0) { throw 'Obelisk.SpikeS01 is still installed.' }
    $secondPath = $null
    $secondFile = Join-Path $Output 'second-path.txt'
    if (Test-Path -LiteralPath $secondFile) { $secondPath = (Get-Content -LiteralPath $secondFile -Raw).Trim() }
    Clear-TestFiles $secondPath
    Write-Output 'S01_UNINSTALLED Obelisk.SpikeS01'
    return
  }

  if ($Action -eq 'Install' -or $Action -eq 'Ci') {
    if (-not $Msix) { throw "$Action needs -Msix." }
    if (-not (Test-Path -LiteralPath $Msix)) { throw "MSIX not found: $Msix" }
    $Msix = (Resolve-Path -LiteralPath $Msix).Path
    if ($Action -eq 'Ci') {
      if (-not $Certificate) { throw 'Ci needs -Certificate.' }
      $Certificate = (Resolve-Path -LiteralPath $Certificate).Path
      $loaded = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $Certificate
      if ($loaded.Subject -ne $Publisher) {
        throw "Certificate subject '$($loaded.Subject)' is not $Publisher."
      }
      $script:Thumb = $loaded.Thumbprint
      if (Test-IsElevated) {
        Import-PublicCert $Certificate 'TrustedPeople' 'LocalMachine'
        try { Enable-Sideloading } catch { Write-Output "S01_SIDELOAD $($_.Exception.Message)" }
      }
    }
    Uninstall-Spike
    $installError = Install-SpikePackage $Msix
    if ($installError -and $Action -eq 'Ci' -and (Test-IsElevated)) {
      Write-Output "S01_INSTALL trusted-people failed: $installError"
      Import-PublicCert $Certificate 'Root' 'LocalMachine'
      $installError = Install-SpikePackage $Msix
    }
    if ($installError) {
      throw "Add-AppxPackage failed: $installError`nTrust CN=Obelisk Dev in LocalMachine\TrustedPeople, then install again as a standard user. This package is Obelisk.SpikeS01, not Obelisk.Dev."
    }
    $installed = Get-SpikePackage
    if (-not $installed) { throw 'The package installed but Get-AppxPackage did not return Obelisk.SpikeS01.' }
    if ($installed.Name -ne $PackageName) { throw "Installed name is $($installed.Name)." }
    Write-Output "S01_INSTALLED $($installed.PackageFullName)"
    if ($Action -eq 'Install') { return }
  }

  if ($Action -eq 'Run' -or $Action -eq 'Ci') {
    Invoke-Run -FailOnFindings:($Action -eq 'Ci')
  }
} finally {
  if ($Action -eq 'Ci') {
    Get-Process -Name 'ObeliskSpikeS01' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    try { Uninstall-Spike } catch { Write-Output "S01_CLEANUP $($_.Exception.Message)" }
    try { Clear-TestFiles $Second } catch { Write-Output "S01_CLEANUP $($_.Exception.Message)" }
    foreach ($entry in @($script:Imported)) {
      $parts = $entry.Split('|')
      try { Remove-PublicCert $script:Thumb $parts[1] $parts[0] } catch { Write-Output "S01_CLEANUP $($parts[0])\$($parts[1]): $($_.Exception.Message)" }
    }
  }
  Assert-DevUnchanged
  Write-Output "S01_DEV_AFTER $(Get-DevStamp)"
}
