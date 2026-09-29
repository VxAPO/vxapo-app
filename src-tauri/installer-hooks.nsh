; VxAPO NSIS installer hooks
; 安装/卸载前先释放被 audiodg 映射的 driver DLL 映像（结束进程 + 轮询等待 + 可写打开校验，
; 全部 NSIS 原生指令，安装包自给自足——不依赖也不调用 CLI），再停音频服务；
; 安装完成后恢复音频服务，并把安装时选择的界面语言写入 C:\ProgramData\VxAPO\lang.txt
; （与 config 同目录约定，注意 NSIS 没有 $COMMONAPPDATA 变量，路径需硬编码）。
;
; 全局 COM 注册（HKCR\CLSID\* 与 AudioEngine\AudioProcessingObjects\*）**不在此处做**：
; 应用的设备安装流程会经 auto_register_driver() 写同一批键，且该注册幂等，
; 安装期重复一遍没有收益，只会把安装器绑到 CLI 上。

; 释放 driver DLL 映像：先结束 audiodg，再最多等约 5s（12 × 400ms），
; 每轮用「可写打开」验证映像确实已释放（文件仍被映射时打开必然失败）。
; ${tag} 只用于给标签去重（同一宏会被展开多次）。
!macro VBX_RELEASE_DRIVER_IMAGE tag
  nsExec::Exec 'taskkill /F /IM audiodg.exe'
  StrCpy $2 0
  vbx_retry_${tag}:
    IntOp $2 $2 + 1
    Sleep 400
    IfFileExists "$INSTDIR\resources\vxapo_driver.dll" 0 vbx_done_${tag}
    ClearErrors
    FileOpen $3 "$INSTDIR\resources\vxapo_driver.dll" "a"
    IfErrors 0 vbx_close_${tag}
    IntCmp $2 12 vbx_done_${tag} vbx_retry_${tag} vbx_retry_${tag}
  vbx_close_${tag}:
    FileClose $3
  vbx_done_${tag}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM vxapo-cli.exe'
  nsExec::Exec 'net stop audiosrv'
  !insertmacro VBX_RELEASE_DRIVER_IMAGE preinstall
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 语言：只在**首次安装**（lang.txt 不存在）时按安装器语言写入。
  ; 已装过（重装 / 覆盖升级）必须沿用用户当前设置——原来无条件用 "w" 覆盖，
  ; 会把 app 里改过的语言冲回安装器语言（重装后默认变英文）。
  IfFileExists "C:\ProgramData\VxAPO\lang.txt" vbx_lang_keep
    ; 安装器语言为简体中文（LCID 2052）→ zh，否则 en
    StrCpy $0 "en"
    IntCmp $LANGUAGE 2052 +1 +2 +2
      StrCpy $0 "zh"
    CreateDirectory "C:\ProgramData\VxAPO"
    FileOpen $1 "C:\ProgramData\VxAPO\lang.txt" w
    FileWrite $1 $0
    FileClose $1
  vbx_lang_keep:
  nsExec::Exec 'net start audiosrv'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM vxapo-cli.exe'
  nsExec::Exec 'net stop audiosrv'
  !insertmacro VBX_RELEASE_DRIVER_IMAGE preuninstall
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "C:\ProgramData\VxAPO\lang.txt"
  nsExec::Exec 'net start audiosrv'
!macroend
