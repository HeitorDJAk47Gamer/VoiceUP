$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$keyDirectory = Join-Path $env:APPDATA 'VoiceUP\release-signing'
$keyFile = Join-Path $keyDirectory 'release-ed25519.dpapi'
if (Test-Path -LiteralPath $keyFile) {
  throw 'A chave de releases já existe. Não será substituída; preserve a chave para futuras atualizações.'
}
$generated = & node -e "const c=require('crypto'),k=c.generateKeyPairSync('ed25519');console.log(JSON.stringify({privateKey:k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),publicKey:k.publicKey.export({format:'jwk'})}));"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar a chave de releases.' }
$key = $generated | ConvertFrom-Json
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$protected = ConvertTo-SecureString $key.privateKey -AsPlainText -Force | ConvertFrom-SecureString
[IO.File]::WriteAllText($keyFile, $protected)
# Only the public key is returned; the private key remains DPAPI-protected.
$key.publicKey | ConvertTo-Json -Compress
