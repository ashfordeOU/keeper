; SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
; Keeper by Ashforde® — names the installer window and the Programs list entry.
!macro customHeader
  Caption "Keeper by Ashforde® Setup"
  BrandingText "Keeper by Ashforde®"
!macroend

; The finish page: "Run Keeper" as usual, and an optional second box that opens
; Keeper at Settings → Permissions (microphone, camera, location, notifications),
; so everything can be allowed now instead of while using it.
!ifndef BUILD_UNINSTALLER
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function KeeperSetUpPermissions
    ; A second start hands the link to the running Keeper, which opens Settings → Permissions.
    Sleep 1500
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "keeper://settings/permissions"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open Keeper and set up permissions"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "KeeperSetUpPermissions"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !insertmacro MUI_PAGE_FINISH
!macroend
!endif

; Uninstalling (not updating) removes the separate app icons Keeper added to this person's
; Start menu from Settings → Features → App icons (core/launchers.ts), and their icons.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadEnvStr $0 APPDATA
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Mail.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Calendar.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Notes.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Reminders.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Planner.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Files.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Studio.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Terminal.lnk"
    Delete "$0\Microsoft\Windows\Start Menu\Programs\Keeper Remote Desktops.lnk"
    RMDir /r "$0\Keeper\launchers"
  ${endIf}
!macroend
