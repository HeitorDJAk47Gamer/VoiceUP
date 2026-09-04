param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArguments
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw (Join-Path $workspace 'package.json') | ConvertFrom-Json
$match = [regex]::Match([string]$manifest.version, '^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$')
if (-not $match.Success) {
  throw 'O pacote da Store beta exige uma versao no formato X.Y.Z-beta.N.'
}

$major = [int]$match.Groups[1].Value
$minor = [int]$match.Groups[2].Value
$patch = [int]$match.Groups[3].Value
$beta = [int]$match.Groups[4].Value
if ($beta -lt 1 -or $beta -gt 65534) { throw 'O numero da beta precisa ficar entre 1 e 65534; 65535 e reservado para a estavel.' }

# A Store aceita somente quatro numeros crescentes. O quarto componente guarda
# o numero da beta; 65535 fica reservado para a versao estavel desse mesmo trio.
$storeVersion = "$major.$minor.$patch.$beta"

$builder = Join-Path $workspace 'node_modules\.bin\electron-builder.cmd'
if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) { throw 'electron-builder nao encontrado. Execute npm ci primeiro.' }

Write-Output "Versao interna da Store: $storeVersion (aplicativo $($manifest.version))"
& $builder --win appx --publish never '--config.appx.setBuildNumber=true' "--config.buildNumber=$beta" '--config.directories.output=.store-build' @BuilderArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
