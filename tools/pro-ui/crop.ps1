# tools/pro-ui/crop.ps1 —— 从真机截图里裁一块出来看（排查「对齐 / 覆盖不全」这类问题）
# 用法：powershell -NoProfile -File tools/pro-ui/crop.ps1 <源图> <x> <y> <w> <h> <输出.png>
param([string]$Src, [int]$X, [int]$Y, [int]$W, [int]$H, [string]$Out)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Src)
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img,
  (New-Object System.Drawing.Rectangle 0, 0, $W, $H),
  (New-Object System.Drawing.Rectangle $X, $Y, $W, $H),
  [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $img.Dispose()
Write-Output "写出 $Out ($W x $H)"
