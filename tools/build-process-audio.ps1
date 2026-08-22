$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspace 'native\process-audio-capture.cpp'
$output = Join-Path $workspace 'native\voiceup-process-audio.exe'
$object = Join-Path $workspace 'native\process-audio-capture.obj'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Build Tools não encontrado.'
}

$visualStudio = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $visualStudio) {
  throw 'O compilador C++ x64 do Visual Studio não está instalado.'
}

$developerCommand = Join-Path $visualStudio 'Common7\Tools\VsDevCmd.bat'
$arguments = @(
  '/d', '/s', '/c',
  ('""{0}" -no_logo -arch=x64 -host_arch=x64 >nul && cl.exe /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE "{1}" /Fo:"{2}" /Fe:"{3}" /link Ole32.lib Mmdevapi.lib User32.lib"' -f $developerCommand, $source, $object, $output)
)

$process = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -NoNewWindow -PassThru -Wait
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $output)) {
  throw "Falha ao compilar o capturador nativo (código $($process.ExitCode))."
}

Write-Output "Capturador nativo criado: $output"
