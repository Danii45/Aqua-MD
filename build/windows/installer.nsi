; Aqua MD for Windows: per-user installer, built natively with makensis (no Wine).
; makensis -DSRC=<win-unpacked> -DOUTFILE=<setup.exe> -DICON=<icon.ico> -DVERSION=<x.y.z-tag> -DVIVERSION=<a.b.c.d> installer.nsi
Unicode true
!include "MUI2.nsh"

!define APPNAME "Aqua MD"
!define EXE "aqua-md.exe"
!define UNINST "Uninstall Aqua MD.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AquaMD"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Aqua MD"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
ShowUninstDetails nevershow
BrandingText "Aqua MD ${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_TITLE "Aqua MD is installed"
!define MUI_FINISHPAGE_TEXT "Find it on your desktop and in the Start menu.$\r$\n$\r$\nThis is a beta. If something doesn't work, please report it on GitHub."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open Aqua MD now"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VIVERSION}"
VIAddVersionKey "ProductName" "Aqua MD"
VIAddVersionKey "FileDescription" "Aqua MD setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Daniel"
VIAddVersionKey "LegalCopyright" "Aqua MD"

Section "Install"
  ; Close a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /IM ${EXE} /F'
  Sleep 400
  RMDir /r "$INSTDIR\resources"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\${UNINST}"
  CreateShortCut "$DESKTOP\Aqua MD.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Aqua MD.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\icon.ico" 0
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Aqua MD"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Daniel"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\resources\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\${UNINST}"'
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "https://github.com/Danii45/Aqua-MD"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM ${EXE} /F'
  Sleep 400
  Delete "$DESKTOP\Aqua MD.lnk"
  Delete "$SMPROGRAMS\Aqua MD.lnk"
  DeleteRegValue HKCU "${RUNKEY}" "app.aquamd.player"
  DeleteRegKey HKCU "${UNINSTKEY}"
  RMDir /r "$INSTDIR"
SectionEnd
