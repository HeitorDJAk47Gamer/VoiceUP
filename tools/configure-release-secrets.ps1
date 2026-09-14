$ErrorActionPreference = 'Stop'
$keyPath = Join-Path $env:APPDATA 'VoiceUP\release-signing\release-ed25519.dpapi'
$secureKey = Get-Content -LiteralPath $keyPath -Raw | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:VOICEUP_RELEASE_PRIVATE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:VOICEUP_ANDROID_KEYSTORE_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $env:USERPROFILE '.android\debug.keystore')))
  node (Join-Path $PSScriptRoot 'configure-release-secrets.js')
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível configurar todos os segredos de publicação.' }
} finally {
  Remove-Item Env:\VOICEUP_RELEASE_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\VOICEUP_ANDROID_KEYSTORE_BASE64 -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
