!define VXAPO_DATA_ROOT "C:\ProgramData\VxAPO"
!define VXAPO_DLL "$INSTDIR\resources\vxapo_driver.dll"
!define VXAPO_DLL_BAK "$INSTDIR\resources\vxapo_driver.dll.old"

!ifndef BUILD_UNINSTALLER
Var vxapoNeedRestart

Function vxapoRenameDriver
  StrCpy $vxapoNeedRestart "0"
  IfFileExists "${VXAPO_DLL}" 0 vxapo_ren_done
  Delete /REBOOTOK "${VXAPO_DLL_BAK}"
  ClearErrors
  Rename "${VXAPO_DLL}" "${VXAPO_DLL_BAK}"
  IfErrors vxapo_ren_done
  StrCpy $vxapoNeedRestart "1"
  vxapo_ren_done:
FunctionEnd

!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $R0
  Sleep 600
  Call vxapoRenameDriver
!macroend
!endif

!macro customInstall
  SetOutPath "$INSTDIR\resources"
  SetOverwrite on
  File "/oname=vxapo_driver.dll" "${PROJECT_DIR}\src-tauri\resources\vxapo_driver.dll"
  SetOutPath "$INSTDIR"

  StrCmp $vxapoNeedRestart "1" 0 vxapo_no_restart
    nsExec::Exec 'sc stop Audiosrv'
    Pop $R0
    StrCpy $R1 0
    vxapo_wait:
      Sleep 50
      nsExec::Exec 'cmd /c sc query Audiosrv | findstr /C:"STOPPED"'
      Pop $R0
      StrCmp $R0 "0" vxapo_go
      IntCmp $R1 40 0 0 vxapo_go
      IntOp $R1 $R1 + 1
      Goto vxapo_wait
    vxapo_go:
    Delete "${VXAPO_DLL_BAK}"
    IfFileExists "${VXAPO_DLL_BAK}" 0 +2
      Delete /REBOOTOK "${VXAPO_DLL_BAK}"
    nsExec::Exec 'sc start Audiosrv'
    Pop $R0
  vxapo_no_restart:

  nsExec::Exec 'regsvr32 /s "${VXAPO_DLL}"'
  Pop $R9

  CreateDirectory "${VXAPO_DATA_ROOT}"
  nsExec::Exec 'icacls "${VXAPO_DATA_ROOT}" /grant *S-1-5-4:(OI)(CI)M /Q'
  Pop $R9
  nsExec::Exec 'icacls "${VXAPO_DATA_ROOT}\*\config.toml" /grant *S-1-5-4:M /Q'
  Pop $R9
  IfFileExists "${VXAPO_DATA_ROOT}\lang.txt" vxapo_lang_done
    StrCpy $0 "en"
    IntCmp $LANGUAGE 2052 0 0 +2
    StrCpy $0 "zh"
    FileOpen $1 "${VXAPO_DATA_ROOT}\lang.txt" w
    FileWrite $1 $0
    FileClose $1
  vxapo_lang_done:
!macroend

!macro customUnInstall
  nsExec::Exec 'regsvr32 /s /u "${VXAPO_DLL}"'
  Pop $R9
!macroend
