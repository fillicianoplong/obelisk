# Installs, launches, or removes Obelisk.SpikeS02. It does not remove Obelisk.Dev and it does not register .obk.
# Ci is the unattended path: trust when elevated, install, launch the packaged exe twice, then uninstall.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Ci', 'Install', 'Uninstall')]
  [string] $Action,
  [string] $Msix,
  [string] $Certificate,
  [string] $Output
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PackageName = 'Obelisk.SpikeS02'
$FolderName = 'Obelisk-Spike-S02'
$ExeName = 'ObeliskSpikeS02.exe'
$Publisher = 'CN=Obelisk Dev'
$SpikeRoot = Split-Path -Parent $PSCommandPath
if (-not $Output) { $Output = Join-Path $SpikeRoot 'output\packaged' }

$script:Imported = New-Object System.Collections.Generic.List[string]
$script:Thumb = $null
$script:DevBefore = $null
$script:First = $null
$script:Second = $null

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
  Get-Process -Name 'ObeliskSpikeS02' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
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

function Format-Arguments([string[]] $Items) {
  return (($Items | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' ')
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

function As-Array($Value) {
  if ($null -eq $Value) { return @() }
  if ($Value -is [System.Array]) { return $Value }
  return @($Value)
}

function Test-HasPath($Values, [string] $Needle) {
  foreach ($item in @(As-Array $Values)) {
    if ([string]::Equals([string]$item, $Needle, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Test-RecordHasPath($Record, [string] $Needle) {
  if (-not $Record) { return $false }
  if (Test-HasPath $Record.argv $Needle) { return $true }
  if (Test-HasPath $Record.paths $Needle) { return $true }
  return $false
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
  if ($Text -notmatch 'Name="Obelisk\.SpikeS02"') { throw "$Label is not Obelisk.SpikeS02." }
  if ($Text -match 'Name="Obelisk\.Dev"') { throw "$Label uses Obelisk.Dev." }
  if ($Text -notmatch '<uap:FileType>\.s02obk</uap:FileType>') { throw "$Label does not register .s02obk." }
  if ($Text -match '<uap:FileType>\.obk</uap:FileType>') { throw "$Label registers .obk." }
  if ($Text -notmatch 'Alias="ObeliskSpikeS02\.exe"') { throw "$Label has no ObeliskSpikeS02.exe alias." }
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
  Remove-TreeIfPresent (Join-Path $env:TEMP 'obelisk-spike-s02-ci')
}

function Assert-DevUnchanged {
  $after = Get-DevStamp
  if ($script:DevBefore -ne $after) {
    throw "Obelisk.Dev changed from '$($script:DevBefore)' to '$after'."
  }
}

function Start-Logged([string] $File, [string[]] $ArgumentList, [string] $Work, [hashtable] $EnvExtra) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $File
  $info.Arguments = Format-Arguments $ArgumentList
  $info.WorkingDirectory = $Work
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

function Wait-Report([string] $Path, [scriptblock] $Ready, [int] $Seconds, $Process) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $lastError = ''
  while ((Get-Date) -lt $deadline) {
    $parsed = $null
    $isReady = $false
    if (Test-Path -LiteralPath $Path) {
      try {
        $parsed = Read-JsonFile $Path
        $isReady = [bool](& $Ready $parsed)
      } catch {
        $lastError = $_.Exception.Message
        $parsed = $null
        $isReady = $false
      }
    }
    if ($isReady) { return $parsed }
    if ($Process -and $Process.HasExited) {
      # The app writes the report and then exits. Read once more after that exit.
      Start-Sleep -Milliseconds 500
      if (Test-Path -LiteralPath $Path) {
        try {
          $parsed = Read-JsonFile $Path
          if ([bool](& $Ready $parsed)) { return $parsed }
        } catch {
          $lastError = $_.Exception.Message
        }
      }
      throw "The packaged app exited $($Process.ExitCode) before the report was ready. $lastError"
    }
    Start-Sleep -Milliseconds 400
  }
  if (Test-Path -LiteralPath $Path) {
    try {
      $parsed = Read-JsonFile $Path
      if ([bool](& $Ready $parsed)) { return $parsed }
    } catch {
      $lastError = $_.Exception.Message
    }
  }
  throw "Timed out after $Seconds seconds waiting for $Path. $lastError"
}

function Expand-Directory([string] $Path) {
  if (-not $Path) { return '' }
  $full = [System.IO.Path]::GetFullPath($Path)
  try {
    $shell = New-Object -ComObject Scripting.FileSystemObject
    if ($shell.FolderExists($full)) {
      return $shell.GetFolder($full).Path.TrimEnd('\')
    }
  } catch { }
  if (Test-Path -LiteralPath $full) {
    return (Get-Item -LiteralPath $full).FullName.TrimEnd('\')
  }
  return $full.TrimEnd('\')
}

function Get-ExtraData($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [string]) {
    try { return ConvertFrom-Json -InputObject $Value } catch { return $null }
  }
  return $Value
}

function Invoke-Ci([string] $Executable) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $work = Join-Path $env:TEMP 'obelisk-spike-s02-ci'
  $firstCwd = Join-Path $work 'first'
  $secondCwd = Join-Path $work 'second'
  New-Item -ItemType Directory -Force -Path $firstCwd, $secondCwd, $Output | Out-Null
  $coldFile = Join-Path $work 'ci-cold.s02obk'
  $secondFile = Join-Path $work 'ci second.s02obk'
  [System.IO.File]::WriteAllText($coldFile, "s02 ci cold`n", $utf8)
  [System.IO.File]::WriteAllText($secondFile, "s02 ci second`n", $utf8)
  $coldFile = [System.IO.Path]::GetFullPath($coldFile)
  $secondFile = [System.IO.Path]::GetFullPath($secondFile)
  $reportPath = Join-Path $Output 'spike-report.json'
  if (Test-Path -LiteralPath $reportPath) { Remove-Item -LiteralPath $reportPath -Force }

  $script:First = Start-Logged $Executable (,$coldFile) $firstCwd @{
    OBELISK_S02_OUTPUT = $Output
    OBELISK_S02_EXPECT_SECOND = '1'
    OBELISK_S02_SECOND_FILE = $secondFile
  }
  $listening = Wait-Report $reportPath {
    param($Report)
    return ($Report.listening -eq $true) -and (Test-RecordHasPath $Report.coldStart $coldFile)
  } 120 $script:First.Process
  Write-Output "S02_LISTENING pid=$($listening.pid) windows=$($listening.windowsOpened)"

  $alias = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\$ExeName"
  if (Test-Path -LiteralPath $alias) { Write-Output "S02_ALIAS $alias" } else { Write-Output 'S02_ALIAS missing' }

  $script:Second = Start-Logged $Executable (,$secondFile) $secondCwd @{
    OBELISK_S02_OUTPUT = $Output
  }
  if (-not $script:Second.Process.WaitForExit(60000)) {
    throw 'The second launch did not exit within 60 seconds.'
  }
  if ($script:Second.Process.ExitCode -ne 0) {
    throw "The second launch exited $($script:Second.Process.ExitCode)."
  }

  $null = Wait-Report $reportPath {
    param($Report)
    foreach ($item in @(As-Array $Report.secondInstances)) {
      if (Test-RecordHasPath $item $secondFile) { return $true }
    }
    return $false
  } 60 $script:First.Process

  if (-not $script:First.Process.WaitForExit(45000)) {
    throw 'The first launch did not exit after the second instance was recorded.'
  }
  $report = Read-JsonFile $reportPath
  $secondEvent = $null
  foreach ($item in @(As-Array $report.secondInstances)) {
    if (Test-RecordHasPath $item $secondFile) { $secondEvent = $item }
  }
  Write-Output ('S02_COLD ' + ((@(As-Array $report.coldStart.argv) | ForEach-Object { [string]$_ }) -join ' | '))
  if ($secondEvent) {
    Write-Output ('S02_SECOND_ARGV ' + ((@(As-Array $secondEvent.argv) | ForEach-Object { [string]$_ }) -join ' | '))
    Write-Output ('S02_SECOND_WD ' + [string]$secondEvent.workingDirectory)
    $data = Get-ExtraData $secondEvent.additionalData
    if ($data) { Write-Output ('S02_SECOND_DATA ' + ($data | ConvertTo-Json -Compress -Depth 5)) }
  }

  $problems = New-Object System.Collections.Generic.List[string]
  if ($script:First.Process.ExitCode -ne 0) { $problems.Add("first exit $($script:First.Process.ExitCode)") }
  if ($report.gotLock -ne $true) { $problems.Add('gotLock is not true') }
  if ([int]$report.windowsOpened -ne 1) { $problems.Add("windowsOpened=$($report.windowsOpened)") }
  if (-not (Test-RecordHasPath $report.coldStart $coldFile)) { $problems.Add('cold start missed the file') }
  if (-not $secondEvent) { $problems.Add('second-instance missed the file') }
  if ($secondEvent -and -not [string]$secondEvent.workingDirectory) { $problems.Add('workingDirectory is empty') }
  if ($secondEvent) {
    $expectedWd = Expand-Directory $secondCwd
    $actualWd = Expand-Directory ([string]$secondEvent.workingDirectory)
    if (-not [string]::Equals($expectedWd, $actualWd, [System.StringComparison]::OrdinalIgnoreCase)) {
      $problems.Add("workingDirectory was $actualWd, expected $expectedWd")
    }
    $data = Get-ExtraData $secondEvent.additionalData
    if ([string]$data.spike -ne 's02') { $problems.Add("additionalData.spike is '$($data.spike)'") }
    if ([string]$data.pid -eq [string]$report.pid) { $problems.Add('additionalData.pid is the primary pid') }
  }
  $held = 0
  foreach ($stamp in @(Get-ChildItem -LiteralPath $Output -Filter 'process-*.json' -File -ErrorAction SilentlyContinue)) {
    $row = Read-JsonFile $stamp.FullName
    if ($row.gotLock -eq $true) { $held += 1 }
  }
  if ($held -ne 1) { $problems.Add("processes with the lock: $held") }
  $secondStampPath = Join-Path $Output 'second-process.json'
  if (-not (Test-Path -LiteralPath $secondStampPath)) {
    $problems.Add('second-process.json is missing')
  } else {
    $secondStamp = Read-JsonFile $secondStampPath
    if ($secondStamp.gotLock -eq $true) { $problems.Add('the second process took the lock') }
    if (-not (Test-RecordHasPath $secondStamp $secondFile)) { $problems.Add('second-process.json missed the file') }
  }
  $png = Join-Path $Output 'walkthrough.png'
  if (-not (Test-Path -LiteralPath $png)) {
    $problems.Add('walkthrough.png is missing')
  } elseif ((Get-Item -LiteralPath $png).Length -lt 100) {
    $problems.Add('walkthrough.png is too small')
  }
  if ($report.ok -ne $true) { $problems.Add('report ok is not true') }
  if ($problems.Count -gt 0) {
    throw ('Packaged second-instance check failed: ' + ($problems -join '; '))
  }
  Write-Output "S02_OK cold=$coldFile second=$secondFile"
  Write-Output "S02_WINDOWS $($report.windowsOpened)"
}

$script:DevBefore = Get-DevStamp
Write-Output "S02_DEV_BEFORE $($script:DevBefore)"

try {
  if ($Action -eq 'Uninstall') {
    Uninstall-Spike
    $still = @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $PackageName })
    if ($still.Count -gt 0) { throw 'Obelisk.SpikeS02 is still installed.' }
    Clear-TestFiles
    Write-Output 'S02_UNINSTALLED Obelisk.SpikeS02'
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
        try { Enable-Sideloading } catch { Write-Output "S02_SIDELOAD $($_.Exception.Message)" }
      }
    }
    Uninstall-Spike
    $installError = Install-SpikePackage $Msix
    if ($installError -and $Action -eq 'Ci' -and (Test-IsElevated)) {
      Write-Output "S02_INSTALL trusted-people failed: $installError"
      Import-PublicCert $Certificate 'Root' 'LocalMachine'
      $installError = Install-SpikePackage $Msix
    }
    if ($installError) {
      throw "Add-AppxPackage failed: $installError`nTrust CN=Obelisk Dev in LocalMachine\TrustedPeople, then install again as a standard user. This package is Obelisk.SpikeS02, not Obelisk.Dev."
    }
    $installed = Get-SpikePackage
    if (-not $installed) { throw 'The package installed but Get-AppxPackage did not return Obelisk.SpikeS02.' }
    if ($installed.Name -ne $PackageName) { throw "Installed name is $($installed.Name)." }
    $installedManifest = Join-Path $installed.InstallLocation 'AppxManifest.xml'
    Assert-SpikeManifest (Read-Utf8 $installedManifest) $installedManifest
    Write-Output "S02_INSTALLED $($installed.PackageFullName)"
    $alias = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\$ExeName"
    if (Test-Path -LiteralPath $alias) { Write-Output "S02_ALIAS $alias" } else { Write-Output 'S02_ALIAS missing' }
    if ($Action -eq 'Install') { return }
    $exe = Join-Path $installed.InstallLocation $ExeName
    if (-not (Test-Path -LiteralPath $exe)) { throw "Executable not found: $exe" }
    Invoke-Ci $exe
  }
} finally {
  if ($Action -eq 'Ci') {
    try { Save-Logged $script:First (Join-Path $Output 'packaged-stdout.txt') (Join-Path $Output 'packaged-stderr.txt') } catch { Write-Output "S02_CLEANUP $($_.Exception.Message)" }
    try { Save-Logged $script:Second (Join-Path $Output 'second-stdout.txt') (Join-Path $Output 'second-stderr.txt') } catch { Write-Output "S02_CLEANUP $($_.Exception.Message)" }
    try { Uninstall-Spike } catch { Write-Output "S02_CLEANUP $($_.Exception.Message)" }
    try { Clear-TestFiles } catch { Write-Output "S02_CLEANUP $($_.Exception.Message)" }
    foreach ($entry in @($script:Imported)) {
      $parts = $entry.Split('|')
      try { Remove-PublicCert $script:Thumb $parts[1] $parts[0] } catch { Write-Output "S02_CLEANUP $($parts[0])\$($parts[1]): $($_.Exception.Message)" }
    }
  }
  Assert-DevUnchanged
  Write-Output "S02_DEV_AFTER $(Get-DevStamp)"
}
