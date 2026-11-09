# Installs the dev MSIX for the current user, launches it, checks the install
# folder, and removes it. Trusting the dev certificate is a one-time
# administrator step on the machine:
#   Import-Certificate -FilePath .\obelisk-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
# Add-AppxPackage and launch then run as a standard user. Store builds are
# signed by Microsoft, so they do not need this certificate. The Start-menu
# app id is Obelisk. This script launches the installed executable so it can
# pass the smoke environment variable.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Msix,
  [Parameter(Mandatory = $true)]
  [string] $Certificate
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$MarkerName = 'smoke-write.txt'
$script:PackageName = $null
$script:Failed = $false
$script:Imported = New-Object System.Collections.Generic.List[string]

function Test-IsElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-PackageIdentity([string] $PackagePath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    $entry = $zip.GetEntry('AppxManifest.xml')
    if (-not $entry) {
      throw "AppxManifest.xml is missing from $PackagePath."
    }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try {
      $text = $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $zip.Dispose()
  }
  $xml = New-Object System.Xml.XmlDocument
  $xml.LoadXml($text)
  $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace('m', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $identity = $xml.SelectSingleNode('/m:Package/m:Identity', $ns)
  if (-not $identity) {
    throw 'The package manifest has no Identity element.'
  }
  return [pscustomobject]@{
    Name = $identity.GetAttribute('Name')
    Publisher = $identity.GetAttribute('Publisher')
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
    foreach ($item in @($found)) {
      $store.Remove($item)
    }
  } finally {
    $store.Close()
  }
}

function Enable-Sideloading {
  $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
  if (-not (Test-Path -LiteralPath $key)) {
    New-Item -Path $key -Force | Out-Null
  }
  New-ItemProperty -Path $key -Name AllowAllTrustedApps -PropertyType DWord -Value 1 -Force | Out-Null
  New-ItemProperty -Path $key -Name AllowDevelopmentWithoutDevLicense -PropertyType DWord -Value 1 -Force | Out-Null
}

function Uninstall-DevPackage([string] $Name) {
  $packages = @(Get-AppxPackage -Name $Name -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $Name })
  foreach ($package in $packages) {
    Remove-AppxPackage -Package $package.PackageFullName
  }
}

function Try-Install([string] $Path) {
  try {
    Add-AppxPackage -Path $Path -ForceUpdateFromAnyVersion -ErrorAction Stop
    return $null
  } catch {
    return $_.Exception.Message
  }
}

function Get-InstallStamp([string] $Root) {
  $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force)
  $lines = foreach ($file in $files) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    $relative = $file.FullName.Substring($Root.Length).TrimStart('\')
    '{0}|{1}|{2}' -f $relative, $file.Length, $hash
  }
  return (($lines | Sort-Object) -join "`n")
}

function Test-IsInside([string] $Parent, [string] $Candidate) {
  $root = [System.IO.Path]::GetFullPath($Parent)
  if (-not $root.EndsWith('\')) {
    $root = "$root\"
  }
  $full = [System.IO.Path]::GetFullPath($Candidate)
  if ($full.Equals($root.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  return $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-IsAppDataPath([string] $Candidate) {
  foreach ($parent in @($env:APPDATA, $env:LOCALAPPDATA)) {
    if ($parent -and (Test-IsInside $parent $Candidate)) {
      return $true
    }
  }
  return $false
}

function Read-MarkerField([string] $Text, [string] $Name) {
  foreach ($line in ($Text -split '\r?\n')) {
    $prefix = "$Name="
    if ($line.StartsWith($prefix)) {
      return $line.Substring($prefix.Length)
    }
  }
  throw "The smoke marker has no $Name line."
}

function Find-SmokeMarkers([string] $Family) {
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($candidate in @(
      (Join-Path $env:APPDATA "Obelisk\$MarkerName"),
      (Join-Path $env:LOCALAPPDATA "Obelisk\$MarkerName")
    )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      $found.Add((Resolve-Path -LiteralPath $candidate).Path)
    }
  }
  $packageRoot = Join-Path $env:LOCALAPPDATA "Packages\$Family"
  if (Test-Path -LiteralPath $packageRoot) {
    Get-ChildItem -LiteralPath $packageRoot -Filter $MarkerName -Recurse -File -Force -ErrorAction SilentlyContinue |
      ForEach-Object { $found.Add($_.FullName) }
  }
  return $found
}

function Start-PackagedApp([string] $Executable, [string] $LogDir, [hashtable] $Environment) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.WorkingDirectory = $env:TEMP
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  if ($Environment) {
    foreach ($key in $Environment.Keys) {
      $info.EnvironmentVariables[$key] = [string]$Environment[$key]
    }
  }
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) {
    throw "Could not start $Executable."
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(90000)) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    throw 'The packaged app did not exit within 90 seconds.'
  }
  $process.WaitForExit() | Out-Null
  $stdout = ''
  $stderr = ''
  try { $stdout = $stdoutTask.Result } catch { $stdout = '' }
  try { $stderr = $stderrTask.Result } catch { $stderr = '' }
  Set-Content -LiteralPath (Join-Path $LogDir 'smoke-stdout.txt') -Value $stdout
  Set-Content -LiteralPath (Join-Path $LogDir 'smoke-stderr.txt') -Value $stderr
  return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $stdout; StdErr = $stderr }
}

if (-not (Test-Path -LiteralPath $Msix)) {
  throw "MSIX not found: $Msix"
}
if (-not (Test-Path -LiteralPath $Certificate)) {
  throw "Certificate not found: $Certificate"
}
$Msix = (Resolve-Path -LiteralPath $Msix).Path
$Certificate = (Resolve-Path -LiteralPath $Certificate).Path

$identity = Read-PackageIdentity $Msix
if (-not $identity.Name) {
  throw 'The package identity has no name.'
}
$script:PackageName = $identity.Name
$loaded = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $Certificate
if ($loaded.Subject -ne $identity.Publisher) {
  throw "Certificate subject '$($loaded.Subject)' does not match publisher '$($identity.Publisher)'."
}
$thumb = $loaded.Thumbprint

try {
  $trust = 'already-trusted'
  if (Test-IsElevated) {
    Import-PublicCert $Certificate 'TrustedPeople' 'LocalMachine'
    $trust = 'local-machine'
    try {
      Enable-Sideloading
      Write-Output 'OBELISK_SMOKE_SIDELOAD policy=enabled'
    } catch {
      Write-Output "OBELISK_SMOKE_SIDELOAD policy=unchanged $($_.Exception.Message)"
    }
  } else {
    Write-Output 'OBELISK_SMOKE_SIDELOAD policy=not-elevated'
  }

  Uninstall-DevPackage $script:PackageName
  $installError = Try-Install $Msix
  if ($installError -and (Test-IsElevated)) {
    # Windows 11 is satisfied by LocalMachine\TrustedPeople. Some runner
    # images still reject that chain until the same certificate is in
    # LocalMachine\Root.
    Write-Output "OBELISK_SMOKE_INSTALL trusted-people failed: $installError"
    Import-PublicCert $Certificate 'Root' 'LocalMachine'
    $trust = 'local-machine-root'
    $installError = Try-Install $Msix
  }
  if ($installError) {
    throw "Add-AppxPackage failed: $installError`nTrust the dev certificate once in an administrator PowerShell:`nImport-Certificate -FilePath .\obelisk-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`nThen run Add-AppxPackage again as a standard user. The Start-menu app id is Obelisk."
  }
  Write-Output "OBELISK_SMOKE_TRUST $trust"

  $package = @(Get-AppxPackage -Name $script:PackageName | Where-Object { $_.Name -eq $script:PackageName }) | Select-Object -First 1
  if (-not $package) {
    throw 'The package installed but Get-AppxPackage did not return it.'
  }
  if ($package.Publisher -ne $identity.Publisher) {
    throw "Installed publisher '$($package.Publisher)' does not match '$($identity.Publisher)'."
  }
  $install = $package.InstallLocation
  if (-not $install -or -not (Test-Path -LiteralPath $install)) {
    throw 'The package has no readable install location.'
  }
  $executable = Join-Path $install 'Obelisk.exe'
  if (-not (Test-Path -LiteralPath $executable)) {
    throw "Packaged executable is missing: $executable"
  }

  $before = Get-InstallStamp $install
  $logDir = Join-Path $env:TEMP 'obelisk-msix-smoke'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $run = Start-PackagedApp $executable $logDir @{ OBELISK_PACKAGED_SMOKE = '1' }
  if ($run.ExitCode -ne 0) {
    Write-Output $run.StdOut
    Write-Output $run.StdErr
    throw "The packaged app exited $($run.ExitCode)."
  }

  $found = @()
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $found = @(Find-SmokeMarkers $package.PackageFamilyName)
    if ($found.Count -gt 0) { break }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  if ($found.Count -eq 0) {
    Write-Output $run.StdOut
    Write-Output $run.StdErr
    throw 'The packaged app did not write smoke-write.txt under app data.'
  }

  foreach ($markerPath in $found) {
    if (Test-IsInside $install $markerPath) {
      throw "A smoke marker was written in the install folder: $markerPath"
    }
    if (-not (Test-IsAppDataPath $markerPath)) {
      throw "A smoke marker is outside app data: $markerPath"
    }
  }

  $marker = Get-Content -LiteralPath $found[0] -Raw
  Write-Output $marker
  $userData = Read-MarkerField $marker 'userData'
  $exe = Read-MarkerField $marker 'exe'
  $cwd = Read-MarkerField $marker 'cwd'
  if (Test-IsInside $install $userData) {
    throw "App data is inside the install folder: $userData"
  }
  if (-not (Test-IsAppDataPath $userData)) {
    throw "App data is outside the user app data folders: $userData"
  }
  if (-not (Test-IsInside $install $exe)) {
    throw "The running executable is not in the install folder: $exe"
  }
  if (Test-IsInside $install $cwd) {
    throw "The process working directory is the install folder: $cwd"
  }

  $after = Get-InstallStamp $install
  if ($before -ne $after) {
    throw 'The install folder changed while the app was running.'
  }
  $ioDir = Join-Path $env:TEMP 'obelisk-package-io'
  if (Test-Path -LiteralPath $ioDir) {
    Remove-Item -LiteralPath $ioDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $ioDir | Out-Null
  $openFile = Join-Path $ioDir 'opened.obk'
  $saveFile = Join-Path $ioDir 'saved.obk'
  $openText = 'Lab notes'
  $saveText = 'test'
  $fixture = Join-Path $PSScriptRoot 'write-package-io-fixture.mjs'
  & node $fixture $openFile $openText
  if ($LASTEXITCODE -ne 0) {
    throw 'The package check could not write the .obk to open.'
  }
  $ioLog = Join-Path $logDir 'package-io'
  New-Item -ItemType Directory -Force -Path $ioLog | Out-Null
  $io = Start-PackagedApp $executable $ioLog @{
    OBELISK_PACKAGE_IO = '1'
    OBELISK_PACKAGE_IO_OPEN = $openFile
    OBELISK_PACKAGE_IO_SAVE = $saveFile
    OBELISK_PACKAGE_IO_OPEN_TEXT = $openText
    OBELISK_PACKAGE_IO_SAVE_TEXT = $saveText
  }
  if ($io.ExitCode -ne 0 -or $io.StdOut -notmatch 'OBELISK_PACKAGE_IO_OK') {
    Write-Output $io.StdOut
    Write-Output $io.StdErr
    throw 'The installed app did not save a document and reopen it.'
  }
  if (-not (Test-Path -LiteralPath $saveFile)) {
    throw 'The installed app did not write the saved file.'
  }
  $afterIo = Get-InstallStamp $install
  if ($before -ne $afterIo) {
    throw 'The install folder changed while the app saved and reopened.'
  }
  Write-Output ($io.StdOut.Trim())
  Write-Output 'OBELISK_SMOKE_OK install-folder=unchanged'
} catch {
  $script:Failed = $true
  Write-Output "OBELISK_SMOKE_FAIL $($_.Exception.Message)"
  throw
} finally {
  $cleanupError = $null
  $certNotes = New-Object System.Collections.Generic.List[string]
  try {
    Get-Process -Name 'Obelisk' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if ($script:PackageName) {
      Uninstall-DevPackage $script:PackageName
      $still = @(Get-AppxPackage -Name $script:PackageName -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $script:PackageName })
      if ($still.Count -gt 0) {
        $cleanupError = 'The dev package was still installed after Remove-AppxPackage.'
      }
    }
    foreach ($entry in @($script:Imported)) {
      $parts = $entry.Split('|')
      try {
        Remove-PublicCert $thumb $parts[1] $parts[0]
      } catch {
        # The local-machine root store can refuse deletion even for an
        # administrator. A leftover dev certificate is recorded. Package
        # removal, above, is the cleanup failure that fails this script.
        $certNotes.Add("$($parts[0])\$($parts[1]): $($_.Exception.Message)")
      }
    }
  } catch {
    $cleanupError = $_.Exception.Message
  }
  if ($certNotes.Count -gt 0) {
    Write-Output ("OBELISK_SMOKE_CLEANUP " + ($certNotes -join ' | '))
  }
  if ($cleanupError) {
    Write-Output "OBELISK_SMOKE_CLEANUP $cleanupError"
    if (-not $script:Failed) {
      throw $cleanupError
    }
  }
}
