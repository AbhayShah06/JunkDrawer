!macro customUnInstall
  Delete "$APPDATA\Microsoft\Windows\SendTo\Junk Drawer.lnk"
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JunkDrawerQuickAccess"
  ${endIf}
!macroend
