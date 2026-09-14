[CmdletBinding()]
param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  throw "A raiz esperada do VoiceUP não foi encontrada: $root"
}

$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($package.name -ne 'voiceup') {
  throw "Projeto inesperado em $root"
}

function Resolve-SafePath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -eq $root -or -not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Caminho fora da raiz protegida: $full"
  }
  return $full
}

function Get-SafeRelativePath([string]$Base, [string]$Target) {
  $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $basePrefix = $baseFull + [IO.Path]::DirectorySeparatorChar
  $targetFull = [IO.Path]::GetFullPath($Target)
  if (-not $targetFull.StartsWith($basePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Não foi possível relativizar um caminho fora da base: $targetFull"
  }
  return $targetFull.Substring($basePrefix.Length)
}

function Get-TreeBytes([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) { return [int64]$item.Length }
  return [int64]((Get-ChildItem -LiteralPath $Path -Force -Recurse -File |
    Measure-Object -Property Length -Sum).Sum)
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Copy-Verified([string]$SourceRelative, [string]$TargetRelative) {
  $source = Resolve-SafePath (Join-Path $root $SourceRelative)
  $target = Resolve-SafePath (Join-Path $root $TargetRelative)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      $script:copyPlan += [pscustomobject]@{
        Source = '[já consolidado]'
        Target = $TargetRelative
        Bytes = (Get-Item -LiteralPath $target).Length
      }
      return
    }
    throw "Artefato obrigatório ausente e ainda não consolidado: $SourceRelative"
  }
  $script:copyPlan += [pscustomobject]@{
    Source = $SourceRelative
    Target = $TargetRelative
    Bytes = (Get-Item -LiteralPath $source).Length
  }
  if (-not $Apply) { return }

  $targetDirectory = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  $sourceHash = Get-Sha256 $source
  if (Test-Path -LiteralPath $target) {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-Sha256 $target) -ne $sourceHash) {
      throw "Colisão no arquivo de retenção: $TargetRelative"
    }
    return
  }
  Copy-Item -LiteralPath $source -Destination $target
  if ((Get-Sha256 $target) -ne $sourceHash) {
    throw "Falha de verificação após copiar: $TargetRelative"
  }
}

function Write-ShaManifest([string]$FolderRelative) {
  if (-not $Apply) { return }
  $folder = Resolve-SafePath (Join-Path $root $FolderRelative)
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
    throw "Pasta de manifesto ausente: $FolderRelative"
  }
  $lines = Get-ChildItem -LiteralPath $folder -Force -Recurse -File |
    Where-Object { $_.FullName -ne (Join-Path $folder 'SHA256.txt') } |
    ForEach-Object {
      $relative = (Get-SafeRelativePath $folder $_.FullName).Replace('\', '/')
      "$(Get-Sha256 $_.FullName)  $relative"
    } |
    Sort-Object
  $content = if ($lines.Count) { ($lines -join "`n") + "`n" } else { '' }
  [IO.File]::WriteAllText(
    (Join-Path $folder 'SHA256.txt'),
    $content,
    [Text.UTF8Encoding]::new($false)
  )
}

function Verify-ShaManifest([string]$FolderRelative) {
  $folder = Resolve-SafePath (Join-Path $root $FolderRelative)
  $manifest = Join-Path $folder 'SHA256.txt'
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Manifesto ausente: $FolderRelative/SHA256.txt"
  }
  foreach ($line in Get-Content -LiteralPath $manifest) {
    if (-not $line) { continue }
    if ($line -notmatch '^([a-fA-F0-9]{64})  (.+)$') {
      throw "Linha inválida em $FolderRelative/SHA256.txt: $line"
    }
    $expected = $Matches[1].ToLowerInvariant()
    $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
    $file = Resolve-SafePath (Join-Path $folder $relative)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Sha256 $file) -ne $expected) {
      throw "Artefato ausente ou divergente: $FolderRelative/$($Matches[2])"
    }
  }
}

$copyPlan = @()
$deleteTargets = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)

function Add-DeleteTarget([string]$Path) {
  $full = Resolve-SafePath $Path
  if (-not (Test-Path -LiteralPath $full)) { return }
  if (-not $deleteTargets.ContainsKey($full)) {
    $deleteTargets[$full] = [pscustomobject]@{
      Path = $full
      Relative = Get-SafeRelativePath $root $full
      Bytes = Get-TreeBytes $full
    }
  }
}

function Keep-OnlyTopLevel([string]$FolderRelative, [string[]]$AllowedNames) {
  $folder = Resolve-SafePath (Join-Path $root $FolderRelative)
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
    throw "Beta necessária ausente: $FolderRelative"
  }
  foreach ($child in Get-ChildItem -LiteralPath $folder -Force) {
    if ($AllowedNames -notcontains $child.Name) {
      Add-DeleteTarget $child.FullName
    }
  }
}

# As três releases públicas mais recentes, confirmadas pelos tags v1.1.2, v1.2.0 e v1.2.1.
$requiredTags = @('v1.1.2', 'v1.2.0', 'v1.2.1')
$localTags = @(git -C $root tag --list)
foreach ($tag in $requiredTags) {
  if ($localTags -notcontains $tag) { throw "Tag pública necessária ausente: $tag" }
}

foreach ($entry in @(
  @('release-v1.1.2-client\VoiceUP Setup 1.1.2.exe', 'releases\1.1.2\Client\VoiceUP Setup 1.1.2.exe'),
  @('release-v1.1.2-client\VoiceUP Setup 1.1.2.exe.blockmap', 'releases\1.1.2\Client\VoiceUP Setup 1.1.2.exe.blockmap'),
  @('release-v1.1.2-client\latest.yml', 'releases\1.1.2\Client\latest.yml'),
  @('release-v1.1.2-server\VoiceUPServer Setup 1.1.2.exe', 'releases\1.1.2\ServerHost\VoiceUPServer Setup 1.1.2.exe'),
  @('release-v1.1.2-server\VoiceUPServer Setup 1.1.2.exe.blockmap', 'releases\1.1.2\ServerHost\VoiceUPServer Setup 1.1.2.exe.blockmap'),
  @('release-v1.1.2-server\latest.yml', 'releases\1.1.2\ServerHost\latest.yml'),
  @('release-v1.1.2-store\VoiceUP 1.1.2.appx', 'releases\1.1.2\Microsoft Store\VoiceUP 1.1.2.appx'),
  @('release-v1.2.1\VoiceUP Setup 1.2.1.exe', 'releases\1.2.1\Client\VoiceUP Setup 1.2.1.exe'),
  @('release-v1.2.1\VoiceUP Setup 1.2.1.exe.blockmap', 'releases\1.2.1\Client\VoiceUP Setup 1.2.1.exe.blockmap'),
  @('release-v1.2.1\latest.yml', 'releases\1.2.1\Client\latest.yml'),
  @('release-server-v1.2.1\VoiceUPServer Setup 1.2.1.exe', 'releases\1.2.1\ServerHost\VoiceUPServer Setup 1.2.1.exe'),
  @('release-server-v1.2.1\VoiceUPServer Setup 1.2.1.exe.blockmap', 'releases\1.2.1\ServerHost\VoiceUPServer Setup 1.2.1.exe.blockmap'),
  @('release-server-v1.2.1\latest.yml', 'releases\1.2.1\ServerHost\latest.yml'),
  @('release-store\VoiceUP-Store-1.2.1.0.appx', 'releases\1.2.1\Microsoft Store\VoiceUP-1.2.1.0.appx'),
  @('test-1.2.1\VoiceUP-1.2.1.apk', 'releases\1.2.1\Android\VoiceUP-1.2.1.apk'),
  @('RELEASE-NOTES-1.2.1.md', 'releases\1.2.1\RELEASE-NOTES.md')
)) {
  Copy-Verified $entry[0] $entry[1]
}

$releaseAssets = Resolve-SafePath (Join-Path $root 'release-assets')
if (Test-Path -LiteralPath $releaseAssets -PathType Container) {
  foreach ($file in Get-ChildItem -LiteralPath $releaseAssets -File) {
    Copy-Verified (Get-SafeRelativePath $root $file.FullName) (Join-Path 'releases\1.2.0\Assets' $file.Name)
  }
} else {
  foreach ($required in @(
    'VoiceUP.Setup.1.2.0.exe',
    'VoiceUPServer.Setup.1.2.0.exe',
    'VoiceUP.1.2.0.appx',
    'VoiceUP-1.2.0-android.apk',
    'VoiceUP-1.2.0-linux-x64.AppImage',
    'VoiceUPServer-1.2.0-linux-x64.AppImage',
    'VoiceUP-SelfWeb.html',
    'VoiceUP-Server-Cloud-1.2.0.zip'
  )) {
    $archived = Resolve-SafePath (Join-Path $root (Join-Path 'releases\1.2.0\Assets' $required))
    if (-not (Test-Path -LiteralPath $archived -PathType Leaf)) {
      throw "Release 1.2.0 consolidada incompleta: $required"
    }
  }
}
Copy-Verified 'RELEASE-NOTES-1.2.0.md' 'releases\1.2.0\RELEASE-NOTES.md'

# Valida os pacotes antes de aplicar a retenção por plataforma.
foreach ($folder in @('test-v1.2.2-beta.10', 'test-v1.2.2-beta.11', 'test-v1.2.2-beta.16', 'test-v1.2.2-beta.17', 'test-v1.2.2-beta.18')) {
  Verify-ShaManifest $folder
}
$beta9LegacyEntries = @(Get-ChildItem -LiteralPath (Resolve-SafePath (Join-Path $root 'test-v1.2.2-beta.9')) -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notin @('Cloud', 'SHA256.txt') })
if ($beta9LegacyEntries.Count) { Verify-ShaManifest 'test-v1.2.2-beta.9' }

# Betas antigas retidas somente para as plataformas que ainda precisam delas.
Keep-OnlyTopLevel 'test-v1.1.3-beta.20' @('Linux', 'SelfWeb', 'SHA256.txt')
Keep-OnlyTopLevel 'test-v1.2.1-beta.6' @('Cloud', 'SHA256.txt')
Keep-OnlyTopLevel 'test-v1.2.2-beta.9' @('Cloud', 'SHA256.txt')
Keep-OnlyTopLevel 'test-v1.2.2-beta.10' @('Cloud', 'Linux', 'SHA256.txt')
Keep-OnlyTopLevel 'test-v1.2.2-beta.11' @('Linux', 'SHA256.txt')

$keptBetaFolders = @(
  'test-v1.2.2-beta.9',
  'test-v1.2.2-beta.10',
  'test-v1.2.2-beta.11',
  'test-v1.2.2-beta.16',
  'test-v1.2.2-beta.17',
  'test-v1.2.2-beta.18',
  'test-v1.1.3-beta.20',
  'test-v1.2.1-beta.6',
  'test-1.1.3-mobile-beta.5',
  'test-1.2.1-mobile-beta.1',
  'test-1.2.2-mobile-beta.1'
)

foreach ($directory in Get-ChildItem -LiteralPath $root -Directory) {
  if (($directory.Name -match '^test-v.+-beta\.' -or $directory.Name -match '^test-.+-mobile-beta\.') -and
      $keptBetaFolders -notcontains $directory.Name) {
    Add-DeleteTarget $directory.FullName
  }
}

foreach ($relative in @(
  'test-v1.1.0-dual-server-hosts',
  'test-v1.2.0-compat',
  'test-1.2.0',
  'test-1.2.1',
  'store-assets-v1.0.25',
  '.electron-cache',
  '.electron-builder-cache',
  '.npm-cache',
  '.release-tools',
  '.tmp',
  'VCUPGEM\client\node_modules',
  'VCUPGEM\client\dist',
  'VCUPGEM\server\node_modules',
  'VCUPGEM\server\dist',
  'deploy\VoiceUP-Server-Cloud-1.1.1',
  'deploy\shardcloud\shardcloud-1.1.0.zip'
)) {
  Add-DeleteTarget (Join-Path $root $relative)
}

# Todas estas pastas são saídas intermediárias reproduzíveis; releases/ é o arquivo permanente.
foreach ($directory in Get-ChildItem -LiteralPath $root -Force -Directory) {
  if ($directory.Name -ne 'releases' -and (
      $directory.Name -match '^release($|-)' -or
      $directory.Name -match '^\.store-build' -or
      $directory.Name -match '^\.store-repack'
    )) {
    Add-DeleteTarget $directory.FullName
  }
}

# Remove releases públicas mais antigas somente depois que as três atuais estiverem planejadas.
$keptReleases = @('1.1.2', '1.2.0', '1.2.1')
$releasesRoot = Resolve-SafePath (Join-Path $root 'releases')
foreach ($directory in Get-ChildItem -LiteralPath $releasesRoot -Directory -ErrorAction SilentlyContinue) {
  if ($keptReleases -notcontains $directory.Name) { Add-DeleteTarget $directory.FullName }
}

# Mantém três pacotes Cloud beta e a release estável mais recente disponível localmente.
$keptCloudZips = @(
  'VoiceUP-Server-Cloud-1.2.0.zip',
  'VoiceUP-Server-Cloud-1.2.1-beta.6.zip',
  'VoiceUP-Server-Cloud-1.2.2-beta.9.zip',
  'VoiceUP-Server-Cloud-1.2.2-beta.10.zip'
)
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root 'deploy') -File -Filter 'VoiceUP-Server-Cloud-*.zip') {
  if ($keptCloudZips -notcontains $file.Name) { Add-DeleteTarget $file.FullName }
}

$deletePlan = @($deleteTargets.Values | Sort-Object Relative)
$deleteBytes = [int64](($deletePlan | Measure-Object -Property Bytes -Sum).Sum)
$copyBytes = [int64](($copyPlan | Measure-Object -Property Bytes -Sum).Sum)

Write-Output "Modo: $(if ($Apply) { 'APLICAR' } else { 'AUDITORIA' })"
Write-Output "Raiz protegida: $root"
Write-Output "Cópias verificadas planejadas: $($copyPlan.Count) ($([math]::Round($copyBytes / 1GB, 3)) GB)"
Write-Output "Alvos de remoção: $($deletePlan.Count) ($([math]::Round($deleteBytes / 1GB, 3)) GB)"
Write-Output 'Betas preservadas:'
$keptBetaFolders | ForEach-Object { Write-Output "  $_" }
Write-Output 'Alvos:'
$deletePlan | ForEach-Object { Write-Output ("  {0} ({1:N3} GB)" -f $_.Relative, ($_.Bytes / 1GB)) }

if (-not $Apply) {
  Write-Output 'Nenhum arquivo foi alterado. Execute novamente com -Apply para aplicar este plano.'
  exit 0
}

$skippedTargets = @()
foreach ($target in $deletePlan) {
  $verified = Resolve-SafePath $target.Path
  if (Test-Path -LiteralPath $verified) {
    try {
      Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction Stop
    } catch {
      if (Test-Path -LiteralPath $verified -PathType Container) {
        foreach ($file in Get-ChildItem -LiteralPath $verified -Force -Recurse -File -ErrorAction SilentlyContinue) {
          try { Remove-Item -LiteralPath (Resolve-SafePath $file.FullName) -Force -ErrorAction Stop } catch { }
        }
        foreach ($directory in Get-ChildItem -LiteralPath $verified -Force -Recurse -Directory -ErrorAction SilentlyContinue |
            Sort-Object { $_.FullName.Length } -Descending) {
          try { Remove-Item -LiteralPath (Resolve-SafePath $directory.FullName) -Force -ErrorAction Stop } catch { }
        }
        try { Remove-Item -LiteralPath $verified -Force -ErrorAction Stop } catch { }
      }
      if (Test-Path -LiteralPath $verified) {
        $skippedTargets += [pscustomobject]@{ Relative = $target.Relative; Message = $_.Exception.Message }
        Write-Warning "Não foi possível remover completamente $($target.Relative): existe arquivo em uso."
      }
    }
  }
}

foreach ($folder in @('test-v1.1.3-beta.20', 'test-v1.2.1-beta.6', 'test-v1.2.2-beta.9', 'test-v1.2.2-beta.10', 'test-v1.2.2-beta.11')) {
  Write-ShaManifest $folder
  Verify-ShaManifest $folder
}
foreach ($folder in @('test-v1.2.2-beta.16', 'test-v1.2.2-beta.17', 'test-v1.2.2-beta.18')) {
  Verify-ShaManifest $folder
}
foreach ($version in $keptReleases) {
  Write-ShaManifest (Join-Path 'releases' $version)
  Verify-ShaManifest (Join-Path 'releases' $version)
}

Write-Output "Limpeza concluída. Espaço nominal processado: $([math]::Round($deleteBytes / 1GB, 3)) GB."
if ($skippedTargets.Count) {
  Write-Output "Alvos bloqueados e preservados nesta execução: $($skippedTargets.Count)"
  $skippedTargets | ForEach-Object { Write-Output "  $($_.Relative)" }
}
