; AdKerala — one-time firewall rules during NSIS install (driver phone access).
!macro customInstall
  IfFileExists "$INSTDIR\allow-firewall.bat" 0 +2
    ExecWait '"$INSTDIR\allow-firewall.bat"' $0
!macroend
