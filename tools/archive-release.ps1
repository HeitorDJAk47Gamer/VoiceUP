param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [ValidateRange(1, 20)]
  [int]$StableKeep = 3,

  [ValidateRange(1, 20)]
  [int]$BetaKeep = 3
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archiveRoot = Join-Path $projectRoot 'releases'
$versionRoot = Join-Path $archiveRoot $Version

function Copy-ReleaseFiles {
  param(
    [string]$DestinationName,
    [string[]]$Candidates
  )

  $existing = @($Candidates | Where-Object { Test-Path -LiteralPath $_ })
  if ($existing.Count -eq 0) {
    return
  }

  $destination = Join-Path $versionRoot $DestinationName
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  foreach ($file in $existing) {
    Copy-Item -LiteralPath $file -Destination $destination -Force
  }
}

New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null

Copy-ReleaseFiles 'Client' @(
  (Join-Path $projectRoot "release\VoiceUP Setup $Version.exe"),
  (Join-Path $projectRoot "release\VoiceUP Setup $Version.exe.blockmap")
)

Copy-ReleaseFiles 'ServerHost' @(
  (Join-Path $projectRoot "release-server\VoiceUPServer Setup $Version.exe"),
  (Join-Path $projectRoot "release-server\VoiceUPServer Setup $Version.exe.blockmap"),
  (Join-Path $projectRoot "release-server-v$Version\VoiceUPServer Setup $Version.exe"),
  (Join-Path $projectRoot "release-server-v$Version\VoiceUPServer Setup $Version.exe.blockmap")
)

$storeDirectory = Join-Path $projectRoot "release-store-v$Version"
if (Test-Path -LiteralPath $storeDirectory) {
  Copy-ReleaseFiles 'Microsoft Store' @(
    Get-ChildItem -LiteralPath $storeDirectory -File -Filter '*.appx' |
      Select-Object -ExpandProperty FullName
  )
}

Copy-ReleaseFiles 'Cloud' @(
  (Join-Path $projectRoot "deploy\VoiceUP-Server-Cloud-$Version.zip")
)

# Stable releases have their own independent retention window. Prerelease/beta
# folders never enter this calculation.
$stableFolders = Get-ChildItem -LiteralPath $archiveRoot -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [Version]$_.Name } -Descending

foreach ($folder in @($stableFolders | Select-Object -Skip $StableKeep)) {
  if ($folder.FullName.StartsWith($archiveRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $folder.FullName -Recurse -Force
  }
}

# Test builds keep their own three-version window.
$betaFolders = Get-ChildItem -LiteralPath $projectRoot -Directory -Filter 'test-v*-beta.*' |
  Where-Object { $_.Name -match '-beta\.(\d+)$' } |
  Sort-Object { [int]([regex]::Match($_.Name, '-beta\.(\d+)$').Groups[1].Value) } -Descending

foreach ($folder in @($betaFolders | Select-Object -Skip $BetaKeep)) {
  if ($folder.FullName.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $folder.FullName -Recurse -Force
  }
}

# electron-builder reuses these output directories. Retain only the installers
# belonging to the same latest beta versions preserved above.
$keptBetaNumbers = @($betaFolders | Select-Object -First $BetaKeep | ForEach-Object {
  [regex]::Match($_.Name, '-beta\.(\d+)$').Groups[1].Value
})

foreach ($outputDirectory in @('release', 'release-server')) {
  $fullOutput = Join-Path $projectRoot $outputDirectory
  if (-not (Test-Path -LiteralPath $fullOutput)) { continue }

  Get-ChildItem -LiteralPath $fullOutput -File |
    Where-Object { $_.Name -match '-beta\.(\d+)\.exe(?:\.blockmap)?$' } |
    Where-Object {
      $number = [regex]::Match($_.Name, '-beta\.(\d+)\.').Groups[1].Value
      $keptBetaNumbers -notcontains $number
    } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

$deployDirectory = Join-Path $projectRoot 'deploy'
if (Test-Path -LiteralPath $deployDirectory) {
  Get-ChildItem -LiteralPath $deployDirectory -File |
    Where-Object { $_.Name -match '-beta\.(\d+)\.zip$' } |
    Where-Object {
      $number = [regex]::Match($_.Name, '-beta\.(\d+)\.zip$').Groups[1].Value
      $keptBetaNumbers -notcontains $number
    } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

[pscustomobject]@{
  ArchivedVersion = $Version
  StableDirectory = $versionRoot
  StableVersionsKept = (@(Get-ChildItem -LiteralPath $archiveRoot -Directory).Name -join ', ')
  TestVersionsKept = (@(Get-ChildItem -LiteralPath $projectRoot -Directory -Filter 'test-v*-beta.*').Name -join ', ')
}
