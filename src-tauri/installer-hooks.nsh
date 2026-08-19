; VxAPO NSIS installer hooks
; 安装/卸载前先停音频服务并结束残留 CLI（保证 DLL/exe 可覆盖），
; 安装完成后注册随包 driver DLL 的 CLSID 绑定并恢复音频服务。
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM vxapo-cli.exe'
  nsExec::Exec 'net stop audiosrv'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$INSTDIR\resources\vxapo-cli.exe" register'
  Pop $0
  nsExec::Exec 'net start audiosrv'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM vxapo-cli.exe'
  nsExec::Exec 'net stop audiosrv'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'net start audiosrv'
!macroend
