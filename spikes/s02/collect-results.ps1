# Copies S-02 reports to C:\Users\filli\s02-results. This process is not the packaged app.
[CmdletBinding()]
param(
  [string] $Destination = 'C:\Users\filli\s02-results'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($Destination -eq 'C:\Users\filli\s02-results' -and -not (Test-Path -LiteralPath 'C:\Users\filli')) {
  $Destination = Join-Path $env:USERPROFILE 's02-results'
}

$SpikeRoot = Split-Path -Parent $PSCommandPath
$FolderName = 'Obelisk-Spike-S02'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Copy-Tree([string] $From, [string] $To) {
  if (-not (Test-Path -LiteralPath $From)) { return $false }
  $children = @(Get-ChildItem -LiteralPath $From -Force -ErrorAction SilentlyContinue)
  if ($children.Count -eq 0) { return $false }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  foreach ($child in $children) {
    Copy-Item -LiteralPath $child.FullName -Destination $To -Recurse -Force
  }
  return $true
}

function Add-Source([System.Collections.Generic.List[string]] $Lines, [string] $Label, [string] $From, [string] $To) {
  $copied = Copy-Tree $From $To
  $Lines.Add("$Label`t$copied`t$From")
  if ($copied) { Write-Output "S02_COPIED $Label $From" }
}

if (Test-Path -LiteralPath $Destination) {
  Remove-Item -LiteralPath $Destination -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$notes = New-Object System.Collections.Generic.List[string]
$notes.Add("collected $((Get-Date).ToString('o'))")
$notes.Add("destination $Destination")

Add-Source $notes 'repo-output' (Join-Path $SpikeRoot 'output') (Join-Path $Destination 'repo-output')

$documents = [Environment]::GetFolderPath('MyDocuments')
$oneDrive = Join-Path $env:USERPROFILE 'OneDrive\Documents'
$desktopKnown = [Environment]::GetFolderPath('Desktop')
$desktopLocal = Join-Path $env:USERPROFILE 'Desktop'

Add-Source $notes 'documents-reports' (Join-Path $documents "$FolderName\reports") (Join-Path $Destination 'documents-reports')
Add-Source $notes 'documents-folder' (Join-Path $documents $FolderName) (Join-Path $Destination 'documents-folder')
if ((Test-Path -LiteralPath $oneDrive) -and -not [string]::Equals(
    [System.IO.Path]::GetFullPath($oneDrive).TrimEnd('\'),
    [System.IO.Path]::GetFullPath($documents).TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  Add-Source $notes 'onedrive-reports' (Join-Path $oneDrive "$FolderName\reports") (Join-Path $Destination 'onedrive-reports')
  Add-Source $notes 'onedrive-folder' (Join-Path $oneDrive $FolderName) (Join-Path $Destination 'onedrive-folder')
}
Add-Source $notes 'desktop-reports' (Join-Path $desktopKnown "$FolderName\reports") (Join-Path $Destination 'desktop-reports')
if ($desktopLocal -and (Test-Path -LiteralPath $desktopLocal)) {
  Add-Source $notes 'local-desktop-reports' (Join-Path $desktopLocal "$FolderName\reports") (Join-Path $Destination 'local-desktop-reports')
}

[System.IO.File]::WriteAllLines((Join-Path $Destination 'collected.txt'), $notes.ToArray(), $utf8)
Write-Output "S02_COLLECTED $Destination"
