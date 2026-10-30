# Polls a file while writeAtomic replaces it. The go file is JSON: { "target", "stop" }.
# Payload layout is the one in src/write-atomic.ts. $PayloadLength = 65553, markers OBK1 and END1.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Go,
  [Parameter(Mandatory = $true)]
  [string] $Summary
)

$ErrorActionPreference = 'Stop'
$PayloadLength = 65553
$BodyLength = 65536

function Write-Summary([int] $Samples, [int] $SeenA, [int] $SeenB, [int] $Missing, [int] $Partial, [int] $Locked, [string] $ErrorText) {
  $obj = [ordered]@{
    samples = $Samples
    seenA = $SeenA
    seenB = $SeenB
    missing = $Missing
    partial = $Partial
    locked = $Locked
    error = $ErrorText
  }
  $json = $obj | ConvertTo-Json -Compress
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Summary, $json, $utf8)
}

function Test-MissingException($Record) {
  $ex = $Record.Exception
  while ($null -ne $ex) {
    if ($ex -is [System.IO.FileNotFoundException] -or $ex -is [System.IO.DirectoryNotFoundException]) {
      return $true
    }
    $ex = $ex.InnerException
  }
  return $false
}

function Get-Fill([byte[]] $Buf) {
  if ($null -eq $Buf -or $Buf.Length -ne $PayloadLength) { return 'partial' }
  if ($Buf[0] -ne 79 -or $Buf[1] -ne 66 -or $Buf[2] -ne 75 -or $Buf[3] -ne 49) { return 'partial' }
  $tail = $Buf.Length
  if ($Buf[$tail - 4] -ne 69 -or $Buf[$tail - 3] -ne 78 -or $Buf[$tail - 2] -ne 68 -or $Buf[$tail - 1] -ne 49) { return 'partial' }
  $fill = $Buf[12]
  if ($Buf[13] -ne $fill -or $Buf[13 + $BodyLength - 1] -ne $fill) { return 'partial' }
  for ($i = 0; $i -lt $BodyLength; $i += 64) {
    if ($Buf[13 + $i] -ne $fill) { return 'partial' }
  }
  if ($fill -eq 65) { return 'A' }
  if ($fill -eq 66) { return 'B' }
  return 'partial'
}

$samples = 0
$seenA = 0
$seenB = 0
$missing = 0
$partial = 0
$locked = 0
$errorText = ''
$share = [System.IO.FileShare]([int][System.IO.FileShare]::ReadWrite -bor [int][System.IO.FileShare]::Delete)

try {
  $deadline = (Get-Date).AddSeconds(240)
  while (-not (Test-Path -LiteralPath $Go)) {
    if ((Get-Date) -gt $deadline) {
      throw "Go file did not appear: $Go"
    }
    Start-Sleep -Milliseconds 20
  }
  $spec = Get-Content -LiteralPath $Go -Raw | ConvertFrom-Json
  $target = [string]$spec.target
  $stop = [string]$spec.stop
  if (-not $target -or -not $stop) {
    throw 'The go file has no target or stop path.'
  }
  $readyUtf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText("$Summary.ready", 'ready', $readyUtf8)
  $sampleDeadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Path -LiteralPath $stop)) {
    if ((Get-Date) -gt $sampleDeadline) {
      $errorText = 'Stop file did not appear.'
      break
    }
    $samples++
    $stream = $null
    $buf = $null
    $len = 0
    $got = 0
    try {
      $stream = New-Object System.IO.FileStream($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
      $len = [int]$stream.Length
      if ($len -lt 0) { $len = 0 }
      $buf = New-Object byte[] ([Math]::Max($len, 0))
      while ($got -lt $len) {
        $n = $stream.Read($buf, $got, $len - $got)
        if ($n -le 0) { break }
        $got += $n
      }
    } catch {
      if (Test-MissingException $_) { $missing++ } else { $locked++ }
      $buf = $null
    } finally {
      if ($stream) { $stream.Dispose() }
    }
    if ($null -ne $buf) {
      if ($got -ne $len) {
        $partial++
      } else {
        $kind = Get-Fill $buf
        if ($kind -eq 'A') { $seenA++ }
        elseif ($kind -eq 'B') { $seenB++ }
        else { $partial++ }
      }
    }
    Start-Sleep -Milliseconds 15
  }
} catch {
  $errorText = $_.Exception.Message
} finally {
  Write-Summary $samples $seenA $seenB $missing $partial $locked $errorText
}

if ($errorText) { exit 1 }
exit 0
