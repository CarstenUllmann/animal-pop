# Draws the placeholder Pop Pals icons (PNG, no external dependencies).
# Run with: pwsh -File scripts/generate-icons.ps1
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\public\icons')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Icon {
  param(
    [int]$Size,
    [bool]$Maskable,
    [string]$Path
  )

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $s = [double]$Size
  $scale = if ($Maskable) { 0.82 } else { 1.0 }
  $u = $s * $scale
  $ox = ($s - $u) / 2.0
  $oy = ($s - $u) / 2.0

  function X([double]$x) { $ox + $x * $u }
  function Y([double]$y) { $oy + $y * $u }
  function D([double]$d) { $d * $u }
  function C([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

  $g.Clear((C '#101426'))

  # Soft background bubbles for depth.
  $depthA = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(38, 123, 223, 242))
  $depthB = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 255, 143, 163))
  $g.FillEllipse($depthA, [float](X 0.56), [float](Y -0.10), [float](D 0.62), [float](D 0.62))
  $g.FillEllipse($depthB, [float](X -0.12), [float](Y 0.62), [float](D 0.50), [float](D 0.50))

  # Ears first so the head overlaps their bases.
  $earBrush = [System.Drawing.SolidBrush]::new((C '#f2923c'))
  $leftEar = @(
    [System.Drawing.PointF]::new([float](X 0.24), [float](Y 0.40)),
    [System.Drawing.PointF]::new([float](X 0.29), [float](Y 0.13)),
    [System.Drawing.PointF]::new([float](X 0.45), [float](Y 0.32))
  )
  $rightEar = @(
    [System.Drawing.PointF]::new([float](X 0.76), [float](Y 0.40)),
    [System.Drawing.PointF]::new([float](X 0.71), [float](Y 0.13)),
    [System.Drawing.PointF]::new([float](X 0.55), [float](Y 0.32))
  )
  $g.FillPolygon($earBrush, $leftEar)
  $g.FillPolygon($earBrush, $rightEar)

  # Head.
  $headBrush = [System.Drawing.SolidBrush]::new((C '#ffe9c9'))
  $g.FillEllipse($headBrush, [float](X 0.23), [float](Y 0.28), [float](D 0.54), [float](D 0.54))

  # Cheeks, then eyes, then nose and smile.
  $cheekBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(110, 255, 143, 163))
  $g.FillEllipse($cheekBrush, [float](X 0.305), [float](Y 0.595), [float](D 0.085), [float](D 0.065))
  $g.FillEllipse($cheekBrush, [float](X 0.61), [float](Y 0.595), [float](D 0.085), [float](D 0.065))

  $eyeBrush = [System.Drawing.SolidBrush]::new((C '#2a1a12'))
  $g.FillEllipse($eyeBrush, [float](X 0.383), [float](Y 0.50), [float](D 0.066), [float](D 0.078))
  $g.FillEllipse($eyeBrush, [float](X 0.551), [float](Y 0.50), [float](D 0.066), [float](D 0.078))

  $noseBrush = [System.Drawing.SolidBrush]::new((C '#d96c7a'))
  $nose = @(
    [System.Drawing.PointF]::new([float](X 0.466), [float](Y 0.598)),
    [System.Drawing.PointF]::new([float](X 0.534), [float](Y 0.598)),
    [System.Drawing.PointF]::new([float](X 0.500), [float](Y 0.628))
  )
  $g.FillPolygon($noseBrush, $nose)

  $inkPen = [System.Drawing.Pen]::new((C '#2a1a12'), [float](D 0.012))
  $inkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $inkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($inkPen, [float](X 0.43), [float](Y 0.61), [float](D 0.14), [float](D 0.09), 20, 140)

  $whiskerPen = [System.Drawing.Pen]::new((C '#e2b184'), [float](D 0.010))
  $whiskerPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $whiskerPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($whiskerPen, [float](X 0.20), [float](Y 0.575), [float](X 0.34), [float](Y 0.595))
  $g.DrawLine($whiskerPen, [float](X 0.20), [float](Y 0.650), [float](X 0.34), [float](Y 0.642))
  $g.DrawLine($whiskerPen, [float](X 0.80), [float](Y 0.575), [float](X 0.66), [float](Y 0.595))
  $g.DrawLine($whiskerPen, [float](X 0.80), [float](Y 0.650), [float](X 0.66), [float](Y 0.642))

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $inkPen.Dispose()
  $whiskerPen.Dispose()
  $headBrush.Dispose()
  $earBrush.Dispose()
  $cheekBrush.Dispose()
  $eyeBrush.Dispose()
  $noseBrush.Dispose()
  $depthA.Dispose()
  $depthB.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

New-Icon -Size 192 -Maskable $false -Path (Join-Path $OutDir 'icon-192.png')
New-Icon -Size 512 -Maskable $false -Path (Join-Path $OutDir 'icon-512.png')
New-Icon -Size 512 -Maskable $true -Path (Join-Path $OutDir 'icon-maskable-512.png')

Get-ChildItem $OutDir -Filter '*.png' | ForEach-Object { "{0} ({1} bytes)" -f $_.Name, $_.Length }
