param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [switch]$IncludeLinuxDownloads
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+(?:-beta\.\d+)?$') {
  throw "Versao invalida para o pacote Cloud: $Version"
}

$workspace = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $workspace 'deploy\shardcloud'
$deployRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'deploy'))
$packageSuffix = ''
$output = [IO.Path]::GetFullPath((Join-Path $deployRoot "VoiceUP-Server-Cloud-$Version$packageSuffix.zip"))
if (-not $output.StartsWith($deployRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'O pacote Cloud precisa permanecer dentro da pasta deploy.'
}

$manifestVersion = (Get-Content -Raw (Join-Path $sourceRoot 'package.json') | ConvertFrom-Json).version
if ($manifestVersion -ne $Version) {
  throw "A tag ($Version) nao corresponde ao package.json do Cloud ($manifestVersion)."
}

# Lista fechada: dados, logs, .env, node_modules e arquivos de teste nunca entram
# no pacote, mesmo que existam na maquina usada para gerar a release.
$publicFiles = @(
  '.shardcloud',
  '.env.example',
  'index.js',
  'package.json',
  'package-lock.json',
  'persistent-storage.js',
  'plugin-runtime.js',
  'README.md',
  'site.css',
  'site.html',
  'site.js',
  'release-downloads.js',
  'release-integrity.js',
  'release-trust.js',
  'status.html',
  'privacy.html',
  'terms.html',
  'plugins.html',
  'assets\voiceup-logo.png',
  "downloads\VoiceUP-$Version-android.apk",
  'downloads\VoiceUP-SelfWeb.html',
  'downloads\release-downloads.json',
  'downloads\VoiceUP-Linux-LEIA-ME.txt',
  'music\README.md',
  'plugins\dados.js',
  'plugins\musica.js',
  'plugins\xp-chat.js'
)
# Linux usa os arquivos assinados da Release pública. Não duplica centenas
# de MB no Cloud; a opção antiga continua aceita para scripts existentes.

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("voiceup-cloud-release-" + [guid]::NewGuid().ToString('N'))
$stagingRoot = Join-Path $temporaryRoot 'package'
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

try {
  foreach ($relativePath in $publicFiles) {
    $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relativePath))
    if (-not $source.StartsWith([IO.Path]::GetFullPath($sourceRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Caminho fora do pacote Cloud: $relativePath"
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "Arquivo obrigatorio ausente no pacote Cloud: $relativePath"
    }
    $destination = Join-Path $stagingRoot $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Force
  }
  [IO.Compression.ZipFile]::CreateFromDirectory($stagingRoot, $output, [IO.Compression.CompressionLevel]::Optimal, $false)
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temporaryRoot)
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
Write-Output "Pacote Cloud criado: $output"
Write-Output "SHA256: $hash"
