Add-Type -AssemblyName System.Drawing

function New-Png($outPath, $size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Clear canvas with dark app color
  $g.Clear([System.Drawing.Color]::FromArgb(255, 9, 10, 16))

  $m = [math]::Max(1.0, $size * 0.06)
  $w = $size - (2 * $m)
  $h = $size - (2 * $m)

  # Container background squircle
  $cornerRadius = [math]::Max(3.0, $size * 0.22)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r2 = $cornerRadius * 2
  $path.AddArc($m, $m, $r2, $r2, 180, 90)
  $path.AddArc($m + $w - $r2, $m, $r2, $r2, 270, 90)
  $path.AddArc($m + $w - $r2, $m + $h - $r2, $r2, $r2, 0, 90)
  $path.AddArc($m, $m + $h - $r2, $r2, $r2, 90, 90)
  $path.CloseFigure()

  # Container fill gradient
  $rectF = New-Object System.Drawing.RectangleF $m, $m, $w, $h
  $containerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rectF, ([System.Drawing.Color]::FromArgb(255, 14, 16, 26)), ([System.Drawing.Color]::FromArgb(255, 26, 30, 50)), 135.0
  $g.FillPath($containerBrush, $path)

  # Border gradient pen (Cyan to Magenta glow border)
  $borderBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rectF, ([System.Drawing.Color]::FromArgb(255, 0, 240, 255)), ([System.Drawing.Color]::FromArgb(255, 224, 64, 251)), 45.0
  $penWidth = [math]::Max(1.2, $size * 0.045)
  $borderPen = New-Object System.Drawing.Pen $borderBrush, $penWidth
  $g.DrawPath($borderPen, $path)

  # Scale coordinates for pulse lines
  $cx = $size / 2.0
  $cy = $size / 2.0
  $unit = $size / 100.0

  # Channel A Wave (Electric Cyan)
  $penAWidth = [math]::Max(1.2, $size * 0.06)
  $penA = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0, 240, 255)), $penAWidth
  $penA.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penA.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penA.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $ptsA = @(
    (New-Object System.Drawing.PointF ($cx - 30 * $unit), ($cy - 8 * $unit)),
    (New-Object System.Drawing.PointF ($cx - 18 * $unit), ($cy - 8 * $unit)),
    (New-Object System.Drawing.PointF ($cx - 10 * $unit), ($cy - 26 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 2 * $unit), ($cy + 18 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 12 * $unit), ($cy - 14 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 20 * $unit), ($cy - 8 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 30 * $unit), ($cy - 8 * $unit))
  )

  if ($size -ge 32) {
    $penAGlow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 0, 240, 255)), ($penAWidth * 2.2)
    $penAGlow.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penAGlow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penAGlow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawLines($penAGlow, $ptsA)
    $penAGlow.Dispose()
  }
  $g.DrawLines($penA, $ptsA)

  # Channel B Wave (Electric Magenta)
  $penBWidth = [math]::Max(1.0, $size * 0.05)
  $penB = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 224, 64, 251)), $penBWidth
  $penB.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penB.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penB.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $ptsB = @(
    (New-Object System.Drawing.PointF ($cx - 30 * $unit), ($cy + 10 * $unit)),
    (New-Object System.Drawing.PointF ($cx - 20 * $unit), ($cy + 10 * $unit)),
    (New-Object System.Drawing.PointF ($cx - 12 * $unit), ($cy + 20 * $unit)),
    (New-Object System.Drawing.PointF ($cx - 2 * $unit), ($cy - 16 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 8 * $unit), ($cy + 14 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 18 * $unit), ($cy + 10 * $unit)),
    (New-Object System.Drawing.PointF ($cx + 30 * $unit), ($cy + 10 * $unit))
  )

  if ($size -ge 32) {
    $penBGlow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 224, 64, 251)), ($penBWidth * 2.2)
    $penBGlow.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penBGlow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penBGlow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawLines($penBGlow, $ptsB)
    $penBGlow.Dispose()
  }
  $g.DrawLines($penB, $ptsB)

  $dir = Split-Path $outPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose(); $bmp.Dispose(); $path.Dispose()
  $containerBrush.Dispose(); $borderBrush.Dispose(); $borderPen.Dispose()
  $penA.Dispose(); $penB.Dispose()
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
