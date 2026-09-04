param(
  [string]$Source = (Join-Path $PSScriptRoot '..\assets\voiceup-logo.png'),
  [string]$Output = (Join-Path $PSScriptRoot '..\store-assets-v1.0.25'),
  [switch]$AppxOnly
)

Add-Type -AssemblyName System.Drawing

$sourcePath = [IO.Path]::GetFullPath($Source)
$outputPath = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$sourceImage = [Drawing.Image]::FromFile($sourcePath)

function New-Canvas([int]$width, [int]$height) {
  $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Add-Background($graphics, [int]$width, [int]$height) {
  $rect = [Drawing.Rectangle]::new(0, 0, $width, $height)
  $brush = [Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [Drawing.Color]::FromArgb(255, 5, 10, 28),
    [Drawing.Color]::FromArgb(255, 17, 27, 58),
    45
  )
  $graphics.FillRectangle($brush, $rect)
  $brush.Dispose()

  $glowSize = [int]([Math]::Min($width, $height) * 0.78)
  $glowX = [int](($width - $glowSize) / 2)
  $glowY = [int](($height - $glowSize) / 2)
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddEllipse($glowX, $glowY, $glowSize, $glowSize)
  $glow = [Drawing.Drawing2D.PathGradientBrush]::new($path)
  $glow.CenterColor = [Drawing.Color]::FromArgb(58, 82, 118, 255)
  $glow.SurroundColors = @([Drawing.Color]::FromArgb(0, 8, 14, 35))
  $graphics.FillPath($glow, $path)
  $glow.Dispose()
  $path.Dispose()
}

function Add-Logo($graphics, [int]$width, [int]$height, [double]$scale = 0.82, [double]$centerY = 0.50) {
  $side = [int]([Math]::Min($width, $height) * $scale)
  $x = [int](($width - $side) / 2)
  $y = [int](($height * $centerY) - ($side / 2))
  $graphics.DrawImage($sourceImage, [Drawing.Rectangle]::new($x, $y, $side, $side))
}

function Save-Square([string]$name, [int]$side) {
  $canvas = New-Canvas $side $side
  Add-Background $canvas.Graphics $side $side
  Add-Logo $canvas.Graphics $side $side 0.90 0.50
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Save((Join-Path $outputPath $name), [Drawing.Imaging.ImageFormat]::Png)
  $canvas.Bitmap.Dispose()
}

function Save-WideTile([string]$name) {
  $width = 310; $height = 150
  $canvas = New-Canvas $width $height
  Add-Background $canvas.Graphics $width $height
  Add-Logo $canvas.Graphics $width $height 0.88 0.50
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Save((Join-Path $outputPath $name), [Drawing.Imaging.ImageFormat]::Png)
  $canvas.Bitmap.Dispose()
}

function Add-CenteredText($graphics, [string]$text, [int]$width, [float]$y, [float]$size, [Drawing.FontStyle]$style, [Drawing.Color]$color) {
  $font = [Drawing.Font]::new('Segoe UI', $size, $style, [Drawing.GraphicsUnit]::Pixel)
  $format = [Drawing.StringFormat]::new()
  $format.Alignment = [Drawing.StringAlignment]::Center
  $format.LineAlignment = [Drawing.StringAlignment]::Center
  $brush = [Drawing.SolidBrush]::new($color)
  $graphics.DrawString($text, $font, $brush, [Drawing.RectangleF]::new(0, $y, $width, $size * 1.5), $format)
  $brush.Dispose(); $format.Dispose(); $font.Dispose()
}

function Save-BoxArt {
  $side = 1080
  $canvas = New-Canvas $side $side
  Add-Background $canvas.Graphics $side $side
  Add-Logo $canvas.Graphics $side $side 0.70 0.42
  Add-CenteredText $canvas.Graphics 'VoiceUP' $side 790 92 ([Drawing.FontStyle]::Bold) ([Drawing.Color]::White)
  Add-CenteredText $canvas.Graphics 'Converse sem barreiras.' $side 895 38 ([Drawing.FontStyle]::Regular) ([Drawing.Color]::FromArgb(255, 180, 194, 226))
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Save((Join-Path $outputPath 'VoiceUP-Store-BoxArt-1080x1080.png'), [Drawing.Imaging.ImageFormat]::Png)
  $canvas.Bitmap.Dispose()
}

function Save-PosterArt {
  $width = 720; $height = 1080
  $canvas = New-Canvas $width $height
  Add-Background $canvas.Graphics $width $height
  Add-Logo $canvas.Graphics $width $height 0.76 0.36
  Add-CenteredText $canvas.Graphics 'VoiceUP' $width 690 86 ([Drawing.FontStyle]::Bold) ([Drawing.Color]::White)
  Add-CenteredText $canvas.Graphics 'Aproxime pessoas' $width 800 42 ([Drawing.FontStyle]::Bold) ([Drawing.Color]::FromArgb(255, 86, 226, 207))
  Add-CenteredText $canvas.Graphics 'de verdade.' $width 852 42 ([Drawing.FontStyle]::Bold) ([Drawing.Color]::FromArgb(255, 236, 111, 168))
  Add-CenteredText $canvas.Graphics 'Voz  |  Video  |  Tela  |  Texto' $width 955 27 ([Drawing.FontStyle]::Regular) ([Drawing.Color]::FromArgb(255, 180, 194, 226))
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Save((Join-Path $outputPath 'VoiceUP-Store-Poster-720x1080.png'), [Drawing.Imaging.ImageFormat]::Png)
  $canvas.Bitmap.Dispose()
}

if ($AppxOnly) {
  # These names are consumed directly by electron-builder's AppX template.
  # Supplying all of them prevents Electron's default atom icons from entering
  # the package and keeps the Start menu tiles branded as VoiceUP.
  Save-Square 'StoreLogo.png' 50
  Save-Square 'Square44x44Logo.png' 44
  Save-Square 'Square150x150Logo.png' 150
  Save-WideTile 'Wide310x150Logo.png'
} else {
  Save-Square 'VoiceUP-Store-Icon-300x300.png' 300
  Save-Square 'VoiceUP-Store-Icon-150x150.png' 150
  Save-Square 'VoiceUP-Store-Icon-71x71.png' 71
  Save-BoxArt
  Save-PosterArt
}

$sourceImage.Dispose()
Get-ChildItem -LiteralPath $outputPath -Filter '*.png' | Select-Object Name, Length
