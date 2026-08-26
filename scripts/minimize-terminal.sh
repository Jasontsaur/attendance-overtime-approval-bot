#!/bin/bash
# Minimize the Windows Terminal window(s) so the browser underneath is visible
# for screenshots/clicking. Safe: it only minimizes, it does not close anything.
set -euo pipefail

/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
Add-Type -Name Win32 -Namespace Native -MemberDefinition '
[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
'
Get-Process -Name WindowsTerminal -ErrorAction SilentlyContinue | ForEach-Object {
  if (\$_.MainWindowHandle -ne 0) { [Native.Win32]::ShowWindowAsync(\$_.MainWindowHandle, 6) }
}
"
