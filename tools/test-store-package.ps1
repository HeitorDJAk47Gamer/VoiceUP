param([string]$ClientBuildDirectory = 'release-beta', [string]$StoreBuildDirectory = '.store-build')

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw (Join-Path $workspace 'package.json') | ConvertFrom-Json
$match = [regex]::Match([string]$manifest.version, '^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$')
if (-not $match.Success) { throw 'A validacao da Store exige X.Y.Z ou X.Y.Z-beta.N.' }

$major = [int]$match.Groups[1].Value
$minor = [int]$match.Groups[2].Value
$patch = [int]$match.Groups[3].Value
$beta = if ($match.Groups[4].Success) { [int]$match.Groups[4].Value } else { 65535 }
if ($beta -lt 1 -or $beta -gt 65535) { throw 'Numero interno invalido para a Store.' }
$expectedVersion = "$major.$minor.$patch.$beta"

$package = Join-Path (Join-Path $workspace $StoreBuildDirectory) "VoiceUP $($manifest.version).appx"
if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw "AppX ausente: $package" }
if ((Get-Item -LiteralPath $package).Length -lt 1MB) { throw 'O AppX parece incompleto.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($package)
try {
  $entry = $archive.GetEntry('AppxManifest.xml')
  if (-not $entry) { throw 'AppxManifest.xml ausente.' }
  $reader = New-Object IO.StreamReader($entry.Open())
  try { [xml]$appx = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $archive.Dispose() }

$identity = $appx.Package.Identity
$application = $appx.Package.Applications.Application
if ($identity.Name -ne 'HeitorDJAk47.VoiceUP') { throw 'A identidade reservada da Store mudou.' }
if ($identity.Publisher -ne 'CN=B428B5E2-45D4-4626-A717-5C3180001375') { throw 'O publicador reservado da Store mudou.' }
if ($identity.ProcessorArchitecture -ne 'x64') { throw 'A arquitetura do AppX deixou de ser x64.' }
if ($identity.Version -ne $expectedVersion) { throw "Versao interna incorreta: $($identity.Version); esperada: $expectedVersion." }
if ($application.Id -ne 'VoiceUP') { throw 'O Application Id reservado da Store mudou.' }

$clientArchive = Join-Path (Join-Path $workspace $ClientBuildDirectory) 'win-unpacked\resources\app.asar'
$storeArchive = Join-Path (Join-Path $workspace $StoreBuildDirectory) 'win-unpacked\resources\app.asar'
if ((Test-Path -LiteralPath $clientArchive) -and (Test-Path -LiteralPath $storeArchive)) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $clientStream = [IO.File]::OpenRead($clientArchive)
    try { $clientHash = ([BitConverter]::ToString($sha256.ComputeHash($clientStream))).Replace('-', '') } finally { $clientStream.Dispose() }
    $storeStream = [IO.File]::OpenRead($storeArchive)
    try { $storeHash = ([BitConverter]::ToString($sha256.ComputeHash($storeStream))).Replace('-', '') } finally { $storeStream.Dispose() }
  } finally { $sha256.Dispose() }
  if ($clientHash -ne $storeHash) { throw 'O codigo da Store nao corresponde ao Client beta validado.' }
}

Write-Output "AppX $($manifest.version) validado com versao interna $expectedVersion e identidade preservada."
