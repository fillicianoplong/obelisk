# Creates the S-02 files under Documents and Desktop. It does not install a package.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$FolderName = 'Obelisk-Spike-S02'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Same-Path([string] $Left, [string] $Right) {
  if (-not $Left -or -not $Right) { return $false }
  $a = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
  $b = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
  return [string]::Equals($a, $b, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-Case04Name {
  return ('Lesson 04 ' + [char]0x2014 + ' caf' + [char]0x00E9 + '.s02obk')
}

function Write-SpikeFile([string] $Path) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, "Spike S-02`r`n", $utf8)
}

function Add-Tree([string] $Root, [System.Collections.Generic.List[string]] $Written) {
  if (-not $Root) { return }
  $folder = Join-Path $Root $FolderName
  $names = @(
    'case-01-cold.s02obk',
    'case-02-second.s02obk',
    (Get-Case04Name),
    'case-05-onedrive.s02obk',
    'case-06-open-with.s02obk',
    'case-07-alias.s02obk'
  )
  foreach ($name in $names) {
    $path = Join-Path $folder $name
    Write-SpikeFile $path
    $Written.Add([System.IO.Path]::GetFullPath($path))
  }
  foreach ($name in @('case-03-a.s02obk', 'case-03-b.s02obk', 'case-03-c.s02obk')) {
    $path = Join-Path (Join-Path $folder 'case-03') $name
    Write-SpikeFile $path
    $Written.Add([System.IO.Path]::GetFullPath($path))
  }
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($path in $Written) {
    if ($path.StartsWith([System.IO.Path]::GetFullPath($folder), [System.StringComparison]::OrdinalIgnoreCase)) {
      $lines.Add($path)
    }
  }
  [System.IO.File]::WriteAllLines((Join-Path $folder 'paths.txt'), $lines.ToArray(), $utf8)
  Write-Output "S02_FILES $folder"
}

$written = New-Object System.Collections.Generic.List[string]
$documents = [Environment]::GetFolderPath('MyDocuments')
$desktopKnown = [Environment]::GetFolderPath('Desktop')
$desktopLocal = Join-Path $env:USERPROFILE 'Desktop'
$oneDrive = Join-Path $env:USERPROFILE 'OneDrive\Documents'

Add-Tree $documents $written
if ($desktopKnown -and -not (Same-Path $desktopKnown $documents)) { Add-Tree $desktopKnown $written }
if ((Test-Path -LiteralPath $desktopLocal) -and -not (Same-Path $desktopLocal $documents) -and -not (Same-Path $desktopLocal $desktopKnown)) {
  Add-Tree $desktopLocal $written
}
if ((Test-Path -LiteralPath $oneDrive) -and -not (Same-Path $oneDrive $documents)) {
  Add-Tree $oneDrive $written
}

$oneDriveFile = Join-Path (Join-Path $oneDrive $FolderName) 'case-05-onedrive.s02obk'
if (Test-Path -LiteralPath $oneDrive) {
  if (-not (Test-Path -LiteralPath $oneDriveFile)) {
    Write-SpikeFile $oneDriveFile
    $written.Add([System.IO.Path]::GetFullPath($oneDriveFile))
  }
  Write-Output "S02_ONEDRIVE $oneDriveFile"
  Write-Output ("S02_DOCUMENTS_IS_ONEDRIVE " + (Same-Path $documents $oneDrive))
} else {
  Write-Output 'S02_ONEDRIVE missing'
}

$spikeRoot = Split-Path -Parent $PSCommandPath
$copyDir = Join-Path $spikeRoot 'output'
New-Item -ItemType Directory -Force -Path $copyDir | Out-Null
[System.IO.File]::WriteAllLines((Join-Path $copyDir 'test-files.txt'), $written.ToArray(), $utf8)
Write-Output "S02_FILE_COUNT $($written.Count)"
