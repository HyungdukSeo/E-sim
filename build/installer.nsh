!macro customInit
  nsExec::Exec `taskkill /F /IM "Mantis CR Ultra Hub.exe"`
  nsExec::Exec `taskkill /F /IM "mantis-cr-search-hub.exe"`
!macroend

!macro customUnInit
  nsExec::Exec `taskkill /F /IM "Mantis CR Ultra Hub.exe"`
  nsExec::Exec `taskkill /F /IM "mantis-cr-search-hub.exe"`
!macroend
