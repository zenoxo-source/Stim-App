Add-Type -AssemblyName System.Drawing

function New-Png($path, $size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::FromArgb(255, 9, 9, 11))
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 120, 212))
  $margin = [math]::Max(2, [int]($size * 0.08))
  $g.FillEllipse($brush, $margin, $margin, ($size - 2 * $margin), ($size - 2 * $margin))
  $fontSize = [math]::Max(8, $size / 2.6)
  $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = "Center"
  $sf.LineAlignment = "Center"
  $rect = New-Object System.Drawing.RectangleF 0, 1, $size, $size
  $g.DrawString("S", $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $dir = Split-Path $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $font.Dispose(); $brush.Dispose()
}

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $PSScriptRoot "..\build"))) {
  # running from backend/scripts
}
$backend = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $backend

$sizes = @(16, 24, 32, 48, 64, 128, 256)
foreach ($s in $sizes) {
  New-Png (Join-Path $backend "build\icon-$s.png") $s
}
New-Png (Join-Path $backend "assets\icon.png") 256
New-Png (Join-Path $backend "assets\tray.png") 32
New-Png (Join-Path $backend "build\icon.png") 256
$frontendIcon = Join-Path $backend "..\frontend\assets\app-icon.png"
New-Png $frontendIcon 128

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)
$imageData = New-Object System.Collections.Generic.List[byte[]]
$offset = 6 + (16 * $sizes.Count)
foreach ($s in $sizes) {
  $pngPath = Join-Path $backend "build\icon-$s.png"
  $pngBytes = [IO.File]::ReadAllBytes($pngPath)
  $imageData.Add($pngBytes) | Out-Null
  $w = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$w)
  $bw.Write([byte]$w)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngBytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $pngBytes.Length
}
foreach ($img in $imageData) { $bw.Write($img) }
$bw.Flush()
$icoBytes = $ms.ToArray()
[IO.File]::WriteAllBytes((Join-Path $backend "build\icon.ico"), $icoBytes)
[IO.File]::WriteAllBytes((Join-Path $backend "assets\icon.ico"), $icoBytes)
$bw.Dispose(); $ms.Dispose()
Write-Host "Generated multi-size ICO ($($icoBytes.Length) bytes)"
