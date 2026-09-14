param(
    [string]$SigningDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.voiceup\android-signing')
)

$ErrorActionPreference = 'Stop'

function Find-Keytool {
    $programFiles = ${env:ProgramFiles}
    $candidates = @(
        $env:VOICEUP_GRADLE_JAVA_HOME,
        $env:JAVA_HOME,
        (Join-Path $programFiles 'Zulu\zulu-17'),
        (Join-Path $programFiles 'Java\jdk-17'),
        (Join-Path $programFiles 'Java\jdk-21'),
        (Join-Path $programFiles 'Android\Android Studio\jbr'),
        (Join-Path $programFiles 'Java\jdk-25'),
        (Join-Path $programFiles 'Eclipse Adoptium\jdk-25.0.2.10-hotspot')
    )

    foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        $executable = Join-Path $expanded 'bin\keytool.exe'
        if (Test-Path -LiteralPath $executable) { return $executable }
    }

    $command = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Nenhum keytool foi encontrado. Instale um JDK ou configure JAVA_HOME.'
}

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    throw 'O armazenamento protegido automático desta ferramenta requer Windows.'
}

$signingDirectory = [System.IO.Path]::GetFullPath($SigningDirectory)
$keyStorePath = Join-Path $signingDirectory 'voiceup-upload.jks'
$certificatePath = Join-Path $signingDirectory 'voiceup-upload-certificate.pem'
$configPath = Join-Path $signingDirectory 'config.json'
$credentialPath = Join-Path $signingDirectory 'upload-key.credential.dpapi'
$alias = 'voiceup-upload'

$existing = @($keyStorePath, $certificatePath, $configPath, $credentialPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($existing.Count -gt 0) {
    throw "A configuração de assinatura já existe em $signingDirectory. Nada foi sobrescrito."
}

New-Item -ItemType Directory -Force -Path $signingDirectory | Out-Null

$passwordBytes = New-Object byte[] 36
$randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $randomNumberGenerator.GetBytes($passwordBytes)
} finally {
    $randomNumberGenerator.Dispose()
}
$password = [Convert]::ToBase64String($passwordBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = [PSCredential]::new($alias, $securePassword)
$keytool = Find-Keytool

$previousPassword = $env:VOICEUP_KEYTOOL_PASSWORD
$setupComplete = $false
try {
    $env:VOICEUP_KEYTOOL_PASSWORD = $password
    & $keytool -genkeypair -v `
        -keystore $keyStorePath `
        -storetype PKCS12 `
        -alias $alias `
        -keyalg RSA `
        -keysize 4096 `
        -validity 10000 `
        -dname 'CN=VoiceUP Android Upload, O=VoiceUP, C=BR' `
        -storepass:env VOICEUP_KEYTOOL_PASSWORD `
        -keypass:env VOICEUP_KEYTOOL_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw "O keytool não conseguiu criar a chave ($LASTEXITCODE)." }

    & $keytool -exportcert -rfc `
        -keystore $keyStorePath `
        -storetype PKCS12 `
        -alias $alias `
        -storepass:env VOICEUP_KEYTOOL_PASSWORD `
        -file $certificatePath
    if ($LASTEXITCODE -ne 0) { throw "O keytool não conseguiu exportar o certificado ($LASTEXITCODE)." }

    $credential | Export-Clixml -LiteralPath $credentialPath
    @{
        schemaVersion = 1
        keyStorePath = $keyStorePath
        keyAlias = $alias
        storeType = 'PKCS12'
        createdAt = [DateTimeOffset]::Now.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
    $setupComplete = $true
} finally {
    $env:VOICEUP_KEYTOOL_PASSWORD = $previousPassword
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    $password = $null
    if (-not $setupComplete) {
        @($keyStorePath, $certificatePath, $configPath, $credentialPath) | ForEach-Object {
            if (Test-Path -LiteralPath $_) { Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue }
        }
    }
}

Write-Host "Chave de upload criada em: $keyStorePath"
Write-Host "Certificado público criado em: $certificatePath"
Write-Host 'A senha foi protegida pelo Windows para este usuário e não foi exibida.'
Write-Host 'Faça backup da pasta de assinatura em um local privado.'
