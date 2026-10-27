# Reads or sets the Windows read-only attribute. Prints yes, no, on, or off.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Path,
  [Parameter(Mandatory = $true)]
  [ValidateSet('get', 'on', 'off')]
  [string] $Mode
)

$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $Path
if ($Mode -eq 'get') {
  if ($item.IsReadOnly) { Write-Output 'yes' } else { Write-Output 'no' }
  exit 0
}
$item.IsReadOnly = ($Mode -eq 'on')
if ($Mode -eq 'on') { Write-Output 'on' } else { Write-Output 'off' }
