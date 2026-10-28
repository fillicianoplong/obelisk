# Puts a CN=Obelisk Dev code-signing certificate in CurrentUser\My when -AllowCreate is set
# and the store does not already have one. The package step does not call this script.
[CmdletBinding()]
param(
  [switch] $AllowCreate
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Publisher = 'CN=Obelisk Dev'

function Test-DevCertificate {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
  try {
    foreach ($cert in $store.Certificates) {
      if ($cert.Subject -ne $Publisher) { continue }
      if (-not $cert.HasPrivateKey) { continue }
      if ($cert.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) { continue }
      foreach ($ext in $cert.Extensions) {
        $eku = $ext -as [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
        if (-not $eku) { continue }
        foreach ($oid in $eku.EnhancedKeyUsages) {
          if ($oid.Value -eq '1.3.6.1.5.5.7.3.3') { return $true }
        }
      }
    }
  } finally {
    $store.Close()
  }
  return $false
}

if (Test-DevCertificate) {
  Write-Output 'Dev certificate: already present'
  exit 0
}

if (-not $AllowCreate) {
  Write-Error 'Dev certificate: would create a new CN=Obelisk Dev certificate. Stopped.'
  exit 1
}

$inf = Join-Path $env:TEMP 'obelisk-spike-s07.inf'
$cer = Join-Path $env:TEMP 'obelisk-spike-s07-job.cer'
$lines = @(
  '[Version]',
  'Signature = "$Windows NT$"',
  '',
  '[NewRequest]',
  "Subject = `"$Publisher`"",
  'KeySpec = 2',
  'KeyLength = 2048',
  'Exportable = FALSE',
  'MachineKeySet = FALSE',
  'ProviderName = "Microsoft Enhanced RSA and AES Cryptographic Provider"',
  'ProviderType = 24',
  'HashAlgorithm = SHA256',
  'RequestType = Cert',
  'KeyUsage = 0x80',
  'ValidityPeriod = Years',
  'ValidityPeriodUnits = 1',
  '',
  '[EnhancedKeyUsageExtension]',
  'OID=1.3.6.1.5.5.7.3.3',
  ''
)
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($inf, $lines, $utf8)
$certreq = Join-Path $env:SystemRoot 'System32\certreq.exe'
try {
  & $certreq -q -new $inf $cer
  if ($LASTEXITCODE -ne 0) { throw "certreq exited $LASTEXITCODE." }
} finally {
  Remove-Item -LiteralPath $inf -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $cer -Force -ErrorAction SilentlyContinue
}

if (-not (Test-DevCertificate)) {
  throw 'The job certificate was not stored in CurrentUser\My.'
}
Write-Output 'Dev certificate: created for this job'
