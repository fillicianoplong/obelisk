# Holds a file open for reading and does not share delete, so a rename over it can fail.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Target,
  [Parameter(Mandatory = $true)]
  [string] $Held,
  [Parameter(Mandatory = $true)]
  [string] $Release
)

$ErrorActionPreference = 'Stop'
$stream = New-Object System.IO.FileStream(
  $Target,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::Read
)
try {
  Set-Content -LiteralPath $Held -Value 'held' -Encoding ascii
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path -LiteralPath $Release)) {
    if ((Get-Date) -gt $deadline) { break }
    Start-Sleep -Milliseconds 30
  }
} finally {
  $stream.Dispose()
}
