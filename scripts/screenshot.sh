#!/bin/bash
# Capture the Windows desktop and copy the PNG to the given path (WSL side).
# Usage: screenshot.sh <output_path>
set -euo pipefail
OUT="${1:?usage: screenshot.sh <output_path>}"
WIN_PS='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
WIN_TMP='C:\Users\Tsao\screenshot_temp.png'

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
\$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
\$bmp = New-Object System.Drawing.Bitmap \$bounds.Width, \$bounds.Height
\$g = [System.Drawing.Graphics]::FromImage(\$bmp)
\$g.CopyFromScreen(\$bounds.Location, [System.Drawing.Point]::Empty, \$bounds.Size)
\$bmp.Save('$WIN_TMP', [System.Drawing.Imaging.ImageFormat]::Png)
\$g.Dispose(); \$bmp.Dispose()
"
cp /mnt/c/Users/Tsao/screenshot_temp.png "$OUT"
rm /mnt/c/Users/Tsao/screenshot_temp.png
