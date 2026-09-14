param(
    [string]$SigningDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.voiceup\android-signing')
)

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

function Remove-TemporaryDirectory([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            if ($attempt -lt 5) { Start-Sleep -Milliseconds 500 }
        }
    }
    Write-Warning "O Gradle ainda mantém um arquivo temporário aberto; a pasta será removida numa execução futura: $path"
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

if (-not $gradleJava) { throw 'Instale um JDK 17 a 23 ou defina VOICEUP_GRADLE_JAVA_HOME.' }
if (-not $compilerJava) { throw 'Instale um JDK 21 ou mais recente ou defina VOICEUP_JAVA_COMPILER_HOME.' }

$requiredSigningVariables = @(
    'VOICEUP_ANDROID_KEYSTORE',
    'VOICEUP_ANDROID_STORE_PASSWORD',
    'VOICEUP_ANDROID_KEY_ALIAS',
    'VOICEUP_ANDROID_KEY_PASSWORD'
)
$providedSigningVariables = @($requiredSigningVariables | Where-Object { [Environment]::GetEnvironmentVariable($_) })
$loadedProtectedCredential = $false

if ($providedSigningVariables.Count -eq 0) {
    $signingDirectory = [System.IO.Path]::GetFullPath($SigningDirectory)
    $configPath = Join-Path $signingDirectory 'config.json'
    $credentialPath = Join-Path $signingDirectory 'upload-key.credential.dpapi'
    if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $credentialPath)) {
        throw "Chave de upload não configurada. Execute tools\setup-play-signing.ps1 uma vez."
    }

    $signingConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $credential = Import-Clixml -LiteralPath $credentialPath
    $plainPassword = $credential.GetNetworkCredential().Password
    $env:VOICEUP_ANDROID_KEYSTORE = [string]$signingConfig.keyStorePath
    $env:VOICEUP_ANDROID_STORE_PASSWORD = $plainPassword
    $env:VOICEUP_ANDROID_KEY_ALIAS = [string]$signingConfig.keyAlias
    $env:VOICEUP_ANDROID_KEY_PASSWORD = $plainPassword
    $loadedProtectedCredential = $true
} elseif ($providedSigningVariables.Count -ne $requiredSigningVariables.Count) {
    throw 'A configuração de assinatura por ambiente está incompleta.'
}

$previousJavaHome = $env:JAVA_HOME
$previousCompilerHome = $env:VOICEUP_JAVA_COMPILER_HOME
$previousPath = $env:Path
$env:JAVA_HOME = $gradleJava
$env:VOICEUP_JAVA_COMPILER_HOME = $compilerJava
$env:Path = "$(Join-Path $gradleJava 'bin')$([IO.Path]::PathSeparator)$env:Path"

Write-Host "Gradle: Java $(Get-JavaMajorVersion $gradleJava 'java.exe')"
Write-Host "Compilador Android: Java $(Get-JavaMajorVersion $compilerJava 'javac.exe')"
Write-Host 'Canal de distribuição: Google Play'

try {
    Push-Location $mobileDirectory
    try {
        & npm.cmd run sync
        if ($LASTEXITCODE -ne 0) { throw "A sincronização do Capacitor falhou ($LASTEXITCODE)." }
    } finally {
        Pop-Location
    }

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
            & .\gradlew.bat lintRelease bundleRelease -PvoiceupDistributionChannel=play --no-daemon
            if ($LASTEXITCODE -ne 0) { throw "A compilação Android App Bundle falhou ($LASTEXITCODE)." }
        } finally {
            Pop-Location
        }
    } finally {
        $env:TEMP = $previousTemp
        $env:TMP = $previousTmp
        Remove-TemporaryDirectory $buildTemporary
    }

    $package = Get-Content -Raw -LiteralPath (Join-Path $mobileDirectory 'package.json') | ConvertFrom-Json
    $version = [string]$package.version
    $sourceBundle = Join-Path $androidDirectory 'app\build\outputs\bundle\release\app-release.aab'
    if (-not (Test-Path -LiteralPath $sourceBundle)) { throw 'O Gradle não produziu o AAB esperado.' }

    $releaseDirectory = Join-Path $workspaceDirectory "test-$version"
    $releaseBundle = Join-Path $releaseDirectory "VoiceUP-$version-play.aab"
    New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
    Copy-Item -LiteralPath $sourceBundle -Destination $releaseBundle -Force

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($releaseBundle)
    try {
        $hashBytes = $sha256.ComputeHash($stream)
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
    $hash = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '')
    Set-Content -LiteralPath (Join-Path $releaseDirectory 'SHA256-PLAY.txt') -Value "$hash  VoiceUP-$version-play.aab" -Encoding ascii

    $jarsigner = Join-Path $gradleJava 'bin\jarsigner.exe'
    if (-not (Test-Path -LiteralPath $jarsigner)) { throw 'O jarsigner não foi encontrado no JDK selecionado.' }
    $jarsignerOutput = & $jarsigner -verify $releaseBundle 2>&1
    $jarsignerExitCode = $LASTEXITCODE
    if ($jarsignerExitCode -ne 0) {
        $jarsignerOutput | Write-Error
        throw "A verificação da assinatura do AAB falhou ($jarsignerExitCode)."
    }

    $manifestPath = Join-Path $androidDirectory 'app\build\intermediates\merged_manifests\release\processReleaseManifest\AndroidManifest.xml'
    $buildConfigPath = Join-Path $androidDirectory 'app\build\generated\source\buildConfig\release\com\goatgank\voiceup\BuildConfig.java'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'O manifesto mesclado da release não foi encontrado.' }
    if (-not (Test-Path -LiteralPath $buildConfigPath)) { throw 'O BuildConfig da release não foi encontrado.' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath
    $buildConfig = Get-Content -Raw -LiteralPath $buildConfigPath
    $versionNamePattern = 'android:versionName="' + [regex]::Escape($version) + '"'
    if ($manifest -notmatch 'package="com\.goatgank\.voiceup"') { throw 'O identificador do pacote no AAB está incorreto.' }
    if ($manifest -notmatch 'android:versionCode="120299"') { throw 'O versionCode do AAB está incorreto.' }
    if ($manifest -notmatch $versionNamePattern) { throw 'O versionName do AAB está incorreto.' }
    if ($manifest -notmatch 'android:minSdkVersion="23"') { throw 'O minSdk do AAB está incorreto.' }
    if ($manifest -notmatch 'android:targetSdkVersion="36"') { throw 'O AAB não foi gerado para targetSdk 36.' }
    if ($manifest -match 'android\.permission\.REQUEST_INSTALL_PACKAGES') { throw 'O canal Play não pode solicitar instalação de APKs externos.' }
    if ($buildConfig -notmatch 'DISTRIBUTION_CHANNEL\s*=\s*"play"') { throw 'O AAB não foi gerado no canal Play.' }

    @"
VOICEUP MOBILE $version - GOOGLE PLAY

Arquivo: VoiceUP-$version-play.aab
Pacote: com.goatgank.voiceup
Version code: 120299
Version name: $version
Min SDK: 23 (Android 6.0)
Target SDK: 36 (Android 16)
Canal: play (atualização externa por APK desativada)
SHA-256: $hash

O arquivo está assinado com a chave de upload do VoiceUP e pronto para ser
enviado a uma faixa de teste do Play Console. Enviar o AAB não publica o app;
a criação e o envio da versão pelo console são etapas separadas.
"@ | Set-Content -LiteralPath (Join-Path $releaseDirectory 'GOOGLE-PLAY.txt') -Encoding utf8

    Write-Host "AAB: $releaseBundle"
    Write-Host "SHA-256: $hash"
    Write-Host 'Assinatura, targetSdk 36 e canal Play verificados.'
} finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:VOICEUP_JAVA_COMPILER_HOME = $previousCompilerHome
    $env:Path = $previousPath
    if ($loadedProtectedCredential) {
        $env:VOICEUP_ANDROID_KEYSTORE = $null
        $env:VOICEUP_ANDROID_STORE_PASSWORD = $null
        $env:VOICEUP_ANDROID_KEY_ALIAS = $null
        $env:VOICEUP_ANDROID_KEY_PASSWORD = $null
        $plainPassword = $null
    }
}
