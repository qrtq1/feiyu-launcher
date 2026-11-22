; 自解压器：把一个 exe 双击后解压到「它自己所在的目录」，然后启动。
; 编译时用 /INPUTCHARSET UTF8，否则中文会乱码。
Unicode true
SetCompressor /SOLID lzma
Name "肥鱼启动器"
OutFile "D:\feiyu-launcher\dist\FeiyuLauncher-SelfExtract.exe"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
XPStyle on

!define APPNAME "肥鱼启动器"
!define SRCDIR "D:\feiyu-launcher\dist\win-unpacked"

Section
  ; 已经解压过就直接启动，不重复解压
  IfFileExists "$EXEDIR\${APPNAME}\${APPNAME}.exe" doLaunch

  ; 第一次：在 exe 旁边建文件夹，把程序铺进去
  SetOutPath "$EXEDIR\${APPNAME}"
  File /r "${SRCDIR}\*.*"

doLaunch:
  Exec '"$EXEDIR\${APPNAME}\${APPNAME}.exe"'
SectionEnd
