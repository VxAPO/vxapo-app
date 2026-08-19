; VxAPO NSIS installer hooks
; 安装完成后注册随包 driver DLL 的 CLSID 绑定（CLI `register` 子命令，幂等），
; 保证安装版 App 的 CLSID 指向安装目录而非开发目录。
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$INSTDIR\resources\vxapo-cli.exe" register'
  Pop $0
!macroend
