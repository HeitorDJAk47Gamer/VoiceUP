param([switch]$Release)
$ErrorActionPreference = 'Stop'

$mobileDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidDirectory = Join-Path $mobileDirectory 'android'
$workspaceDirectory = [System.IO.Path]::GetFullPath((Join-Path $mobileDirectory '..'))

function Get-JavaMajorVersion([string]$javaHome, [string]$binary = 'java.exe') {
    if (-not $javaHome) { return 0 }
    $executable = Join-Path $javaHome "bin\$binary"
    if (-not (Test-Path -LiteralPath $executable)) { return 0 }
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executable
    $startInfo.Arguments = '-version'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $output = $process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { return 0 }
    $match = [regex]::Match($output, '(?:version|javac)\s+"?(?<major>\d+)')
    if (-not $match.Success) { return 0 }
    return [int]$match.Groups['major'].Value
}

function Select-JavaHome([string[]]$candidates, [scriptblock]$accept, [string]$binary) {
    foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        $fullPath = [Environment]::ExpandEnvironmentVariables($candidate)
        $major = Get-JavaMajorVersion $fullPath $binary
        if (& $accept $major) { return $fullPath }
    }
    return $null
}

$programFiles = ${env:ProgramFiles}
$gradleJava = Select-JavaHome @(
    $env:VOICEUP_GRADLE_JAVA_HOME,
    $env:JAVA_HOME,
    (Join-Path $programFiles 'Zulu\zulu-17'),
    (Join-Path $programFiles 'Java\jdk-17')
) { param($major) $major -ge 17 -and $major -le 23 } 'java.exe'

$compilerJava = Select-JavaHome @(
    $env:VOICEUP_JAVA_COMPILER_HOME,
    $env:JAVA_HOME,
    (Join-Path $programFiles 'Java\jdk-21'),
    (Join-Path $programFiles 'Android\Android Studio\jbr'),
    (Join-Path $programFiles 'Java\jdk-25'),
    (Join-Path $programFiles 'Eclipse Adoptium\jdk-25.0.2.10-hotspot')
) { param($major) $major -ge 21 } 'javac.exe'

if (-not $gradleJava) {
    throw 'Instale um JDK 17 a 23 ou defina VOICEUP_GRADLE_JAVA_HOME.'
}
if (-not $compilerJava) {
    throw 'Instale um JDK 21 ou mais recente ou defina VOICEUP_JAVA_COMPILER_HOME.'
}

$env:JAVA_HOME = $gradleJava
$env:VOICEUP_JAVA_COMPILER_HOME = $compilerJava
$env:Path = "$(Join-Path $gradleJava 'bin')$([IO.Path]::PathSeparator)$env:Path"

Write-Host "Gradle: Java $(Get-JavaMajorVersion $gradleJava 'java.exe')"
Write-Host "Compilador Android: Java $(Get-JavaMajorVersion $compilerJava 'javac.exe')"

Push-Location $mobileDirectory
try {
    & npm.cmd run sync
    if ($LASTEXITCODE -ne 0) { throw "A sincronização do Capacitor falhou ($LASTEXITCODE)." }
} finally {
    Pop-Location
}

# Some restricted Windows environments allow AF_UNIX binding but reject the
# subsequent connection. A deliberately long temporary path makes Java fall
# back to TCP loopback, which Gradle also supports.
$temporaryName = '.gradle-tmp-disable-af-unix-' + ('x' * 110)
$buildTemporary = [System.IO.Path]::GetFullPath((Join-Path $androidDirectory $temporaryName))
$androidPrefix = $androidDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $buildTemporary.StartsWith($androidPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A pasta temporária calculada está fora do projeto Android.'
}

$previousTemp = $env:TEMP
$previousTmp = $env:TMP
New-Item -ItemType Directory -Force -Path $buildTemporary | Out-Null
try {
    $env:TEMP = $buildTemporary
    $env:TMP = $buildTemporary
    Push-Location $androidDirectory
    try {
        $buildTask = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
        & .\gradlew.bat $buildTask --no-daemon
        if ($LASTEXITCODE -ne 0) { throw "A compilação Android falhou ($LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    if (Test-Path -LiteralPath $buildTemporary) {
        Remove-Item -LiteralPath $buildTemporary -Recurse -Force
    }
}

$package = Get-Content -Raw -LiteralPath (Join-Path $mobileDirectory 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$sourceApk = if ($Release) { Join-Path $androidDirectory 'app\build\outputs\apk\release\app-release.apk' } else { Join-Path $androidDirectory 'app\build\outputs\apk\debug\app-debug.apk' }
$releaseDirectory = Join-Path $workspaceDirectory "test-$version"
$releaseApk = Join-Path $releaseDirectory "VoiceUP-$version.apk"
New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $sourceApk -Destination $releaseApk -Force
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($releaseApk)
try {
    $hashBytes = $sha256.ComputeHash($stream)
} finally {
    $stream.Dispose()
    $sha256.Dispose()
}
$hash = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '')
Set-Content -LiteralPath (Join-Path $releaseDirectory 'SHA256.txt') -Value "$hash  VoiceUP-$version.apk" -Encoding ascii
$guide = @"
VOICEUP MOBILE $version

INSTALAÇÃO
1. Copie VoiceUP-$version.apk para o celular Android.
2. Abra o arquivo e permita a instalação desta fonte quando o Android solicitar.
3. A atualização pode ser instalada sobre as betas móveis anteriores sem apagar o perfil.

DESTAQUES
- ícones Windows, Linux, Android e SelfWeb com as cores do status;
- identidade protegida para os ServerHosts recentes;
- participantes organizados por canal, duração da call e indicadores de câmera/live;
- consentimento antes de carregar imagens e prévias externas;
- grade para várias transmissões, tela cheia e contagem de espectadores;
- prioridade de fluidez configurável para compartilhamento de tela.

OBSERVAÇÃO
Este é um pacote de teste assinado com a chave de desenvolvimento do VoiceUP.
Microfone, câmera, áudio e compartilhamento de tela precisam das permissões do Android.

SHA-256
$hash
"@
Set-Content -LiteralPath (Join-Path $releaseDirectory 'COMO-INSTALAR.txt') -Value $guide -Encoding utf8

Write-Host "APK: $releaseApk"
Write-Host "SHA-256: $hash"
