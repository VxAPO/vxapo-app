; VxAPO NSIS installer hooks
; 安装/卸载前先停音频服务并结束残留 CLI（保证 DLL/exe 可覆盖），
; 安装完成后注册随包 driver DLL 的 CLSID 绑定并恢复音频服务；
; 同时把安装时选择的界面语言写入 C:\ProgramData\VxAPO\lang.txt（与 config 同目录约定，
; 注意 NSIS 没有 $COMMONAPPDATA 变量，路径需硬编码），作为应用首次启动的默认语言。
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM vxapo-cli.exe'
  nsExec::Exec 'net stop audiosrv'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 语言：安装器语言为简体中文（LCID 2052）→ zh，否则 en
  StrCpy $0 "en"
  IntCmp $LANGUAGE 2052 +1 +2 +2
    StrCpy $0 "zh"
  CreateDirectory "C:\ProgramData\VxAPO"
  FileOpen $1 "C:\ProgramData\VxAPO\lang.txt" w
  FileWrite $1 $0
  FileClose $1
  nsExec::ExecToStack '"$INSTDIR\resources\vxapo-cli.exe" register'
  Pop $0
  nsExec::Exec 'net start audiosrv'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM vxapo-cli.exe'
  nsExec::Exec 'net stop audiosrv'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "C:\ProgramData\VxAPO\lang.txt"
  nsExec::Exec 'net start audiosrv'
!macroend
