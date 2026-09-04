param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][string]$Version, [string]$Output)
$ErrorActionPreference = 'Stop'
$keyPath = Join-Path $env:APPDATA 'VoiceUP\release-signing\release-ed25519.dpapi'
$secureKey = Get-Content -LiteralPath $keyPath -Raw | ConvertTo-SecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:VOICEUP_RELEASE_PRIVATE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $arguments = @((Join-Path $PSScriptRoot 'release-artifacts.js'), 'sign', $Directory, $Version)
  if ($Output) { $arguments += $Output }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar os artefatos.' }
} finally {
  Remove-Item Env:\VOICEUP_RELEASE_PRIVATE_KEY -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}
