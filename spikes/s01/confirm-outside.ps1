# Runs outside the MSIX package. Get-Item here is not the packaged process and does not share its virtual file system.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Claim,
  [Parameter(Mandatory = $true)]
  [string] $Report
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Same-Text([string] $Left, [string] $Right) {
  if (-not $Left -or -not $Right) { return $false }
  return [string]::Equals($Left, $Right, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-Under([string] $Parent, [string] $Candidate) {
  if (-not $Parent -or -not $Candidate) { return $false }
  $root = [System.IO.Path]::GetFullPath($Parent)
  if (-not $root.EndsWith('\')) { $root = "$root\" }
  $full = [System.IO.Path]::GetFullPath($Candidate)
  return $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-Sha([string] $Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-JsonFile([string] $Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $text = [System.IO.File]::ReadAllText($Path)
  if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
  # Do not `return $text | ConvertFrom-Json`. That statement returned the raw text.
  $parsed = ConvertFrom-Json -InputObject $text
  Write-Output -NoEnumerate $parsed
}

function Unwrap-One($Value) {
  if ($Value -is [System.Array]) {
    if ($Value.Length -lt 1) { return $null }
    return $Value[0]
  }
  return $Value
}

function Find-CacheHits([string] $Leaf, [string] $Family) {
  if (-not $Family -or -not $Leaf) { return @() }
  $root = Join-Path $env:LOCALAPPDATA "Packages\$Family\LocalCache"
  if (-not (Test-Path -LiteralPath $root)) { return @() }
  $found = @(Get-ChildItem -LiteralPath $root -Filter $Leaf -Recurse -File -Force -ErrorAction SilentlyContinue)
  return @($found | ForEach-Object { $_.FullName })
}

function Measure-ClaimedFile($ClaimedPath, $ExpectedHash, [string] $Install, [string] $Family) {
  $result = [ordered]@{
    claimedPath = $ClaimedPath
    expectedSha256 = $ExpectedHash
    exists = $false
    fullName = $null
    actualSha256 = $null
    hashMatch = $false
    underInstall = $false
    underLocalCache = $false
    cacheHits = @()
    error = $null
    verdict = 'absent'
  }
  if (-not $ClaimedPath) {
    $result.verdict = 'absent'
    return $result
  }
  $leaf = [System.IO.Path]::GetFileName([string]$ClaimedPath)
  $result.cacheHits = @(Find-CacheHits $leaf $Family)
  try {
    $item = Get-Item -LiteralPath ([string]$ClaimedPath) -ErrorAction Stop
    $result.exists = $true
    $result.fullName = $item.FullName
    $result.actualSha256 = Get-Sha $item.FullName
    $result.hashMatch = Same-Text $result.actualSha256 $ExpectedHash
    $result.underInstall = Test-Under $Install $item.FullName
    $result.underLocalCache = $item.FullName -like '*\Packages\*\LocalCache\*'
  } catch {
    $result.error = $_.Exception.Message
  }
  $cached = @($result.cacheHits).Count -gt 0
  if ($result.exists -and $result.hashMatch -and -not $result.underInstall -and -not $result.underLocalCache) {
    $result.verdict = $(if ($cached) { 'both' } else { 'real' })
  } elseif (-not $result.exists -and $cached) {
    $result.verdict = 'redirected'
  } elseif ($result.exists -and -not $result.hashMatch) {
    $result.verdict = 'mismatch'
  } elseif (-not $result.exists) {
    $result.verdict = 'missing'
  } else {
    $result.verdict = 'not-real'
  }
  return $result
}

if (-not (Test-Path -LiteralPath $Claim)) {
  throw "Claim file not found: $Claim"
}
$loaded = Unwrap-One (Read-JsonFile $Claim)
if (-not $loaded) { throw "Claim file is empty: $Claim" }
if ($loaded.packageName -ne 'Obelisk.SpikeS01') {
  throw "Claim package is '$($loaded.packageName)' ($($loaded.GetType().FullName)), not Obelisk.SpikeS01."
}

$package = @(Get-AppxPackage -Name 'Obelisk.SpikeS01' -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Obelisk.SpikeS01' } | Select-Object -First 1)
$family = $null
$install = $null
if ($package) {
  $family = [string]$package.PackageFamilyName
  $install = [string]$package.InstallLocation
}

$dir = Split-Path -Parent (Resolve-Path -LiteralPath $Claim).Path
$documentsFolder = [Environment]::GetFolderPath('MyDocuments')
$desktopFolder = [Environment]::GetFolderPath('Desktop')

$body = [ordered]@{
  packageName = 'Obelisk.SpikeS01'
  packagedClaim = [bool]$loaded.packaged
  packageFound = [bool]$package
  packageFamilyName = $family
  installLocation = $install
  documentsFolder = $documentsFolder
  desktopFolder = $desktopFolder
  claimedDocuments = [string]$loaded.paths.documents
  claimedUserData = [string]$loaded.paths.userData
  documentsPathMatchesKnownFolder = (Same-Text ([string]$loaded.paths.documents) $documentsFolder)
  documents = Measure-ClaimedFile $loaded.documentsFile $loaded.documentsSha256 $install $family
  second = Measure-ClaimedFile $loaded.secondFile $loaded.secondSha256 $install $family
  userData = Measure-ClaimedFile $loaded.userDataFile $loaded.userDataSha256 $install $family
  roaming = Measure-ClaimedFile $loaded.roamingFile $loaded.roamingSha256 $install $family
  local = Measure-ClaimedFile $loaded.localFile $loaded.localSha256 $install $family
  watchOutsideDocuments = Unwrap-One (Read-JsonFile (Join-Path $dir 'watch-outside-documents.json'))
  watchChildDocuments = Unwrap-One (Read-JsonFile (Join-Path $dir 'watch-child-documents.json'))
  watchOutsideSecond = Unwrap-One (Read-JsonFile (Join-Path $dir 'watch-outside-second.json'))
  watchChildSecond = Unwrap-One (Read-JsonFile (Join-Path $dir 'watch-child-second.json'))
}

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($Report, (($body | ConvertTo-Json -Depth 6) + "`n"), $utf8)
Write-Output "S01_OUTSIDE report=$Report"
Write-Output "S01_VERDICT documents=$($body.documents['verdict']) second=$($body.second['verdict']) userData=$($body.userData['verdict']) roaming=$($body.roaming['verdict']) local=$($body.local['verdict'])"
