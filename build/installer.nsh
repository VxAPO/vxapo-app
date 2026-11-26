!define VXAPO_DATA_ROOT "C:\ProgramData\VxAPO"
!define VXAPO_DLL "$INSTDIR\resources\vxapo_driver.dll"
!define VXAPO_DLL_BAK "$INSTDIR\resources\vxapo_driver.dll.old"

Var vxapoHasOld

!macro VXAPO_RESTART_AUDIO
  nsExec::Exec 'sc stop Audiosrv'
  Pop $R0
  nsExec::Exec 'sc start Audiosrv'
  Pop $R0
!macroend

!macro VXAPO_DELETE_BAK
  Delete "${VXAPO_DLL_BAK}"
  IfFileExists "${VXAPO_DLL_BAK}" 0 +2
    Delete /REBOOTOK "${VXAPO_DLL_BAK}"
!macroend

!macro VXAPO_CLEAR_STALE_BAK
  IfFileExists "${VXAPO_DLL_BAK}" 0 +2
    Delete /REBOOTOK "${VXAPO_DLL_BAK}"
!macroend

!ifndef BUILD_UNINSTALLER
Function vxapoRenameDriver
  StrCpy $vxapoHasOld "0"
  IfFileExists "${VXAPO_DLL}" 0 vxapo_ren_done
  !insertmacro VXAPO_CLEAR_STALE_BAK
  ClearErrors
  Rename "${VXAPO_DLL}" "${VXAPO_DLL_BAK}"
  IfErrors vxapo_ren_done
  StrCpy $vxapoHasOld "1"
  vxapo_ren_done:
FunctionEnd

!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $R0
  Sleep 600
  Call vxapoRenameDriver
!macroend
!else
Function un.vxapoRenameDriver
  StrCpy $vxapoHasOld "0"
  IfFileExists "${VXAPO_DLL}" 0 vxapo_unren_done
  !insertmacro VXAPO_CLEAR_STALE_BAK
  ClearErrors
  Rename "${VXAPO_DLL}" "${VXAPO_DLL_BAK}"
  IfErrors vxapo_unren_done
  StrCpy $vxapoHasOld "1"
  vxapo_unren_done:
FunctionEnd
!endif

!macro customInstall
  SetOutPath "$INSTDIR\resources"
  SetOverwrite on
  File "/oname=vxapo_driver.dll" "${PROJECT_DIR}\src-tauri\resources\vxapo_driver.dll"
  SetOutPath "$INSTDIR"

  !insertmacro VXAPO_RESTART_AUDIO
  !insertmacro VXAPO_DELETE_BAK

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
  Call un.vxapoRenameDriver
  StrCmp $vxapoHasOld "1" 0 vxapo_un_done
    !insertmacro VXAPO_RESTART_AUDIO
    !insertmacro VXAPO_DELETE_BAK
  vxapo_un_done:
!macroend
