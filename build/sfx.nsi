; 自解压器：把一个 exe 双击后解压到「它自己所在的目录」，建桌面快捷方式，然后删掉自己。
; 编译时用 /INPUTCHARSET UTF8，否则中文会乱码。
Unicode true
SetCompressor /SOLID lzma
Name "肥鱼启动器"
OutFile "D:\feiyu-launcher\dist\FeiyuLauncher-SelfExtract.exe"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
XPStyle on

; 用启动器自己的图标，别顶着 NSIS 默认那个安装包图标
Icon "D:\feiyu-launcher\build\icon.ico"

!define APPNAME "肥鱼启动器"
!define SRCDIR "D:\feiyu-launcher\dist\win-unpacked"

Section
  ; 已经解压过就直接启动，不重复解压、也不重复建快捷方式
  IfFileExists "$EXEDIR\${APPNAME}\${APPNAME}.exe" doLaunch

  ; 第一次：在 exe 旁边建文件夹，把程序铺进去
  SetOutPath "$EXEDIR\${APPNAME}"
  File /r "${SRCDIR}\*.*"

  ; 桌面快捷方式
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$EXEDIR\${APPNAME}\${APPNAME}.exe" "" "$EXEDIR\${APPNAME}\${APPNAME}.exe" 0

  ; 删掉自解压本体。正在运行的 exe 自己删不了，所以交给一个后台 cmd：
  ; 等 2 秒（自解压器那时已经退出）再 del。
  Exec 'cmd /c ping 127.0.0.1 -n 3 >nul & del /f /q "$EXEDIR\$EXEFILE"'

doLaunch:
  Exec '"$EXEDIR\${APPNAME}\${APPNAME}.exe"'
SectionEnd
