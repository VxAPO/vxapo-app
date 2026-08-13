@echo off
rem Restore the M16+ tuning config from the old device GUID to the current one.
rem Run this as Administrator once.
set OLD={3b1c3cb8-af9e-47b9-b776-3dac8c7ca333}
set NEW={1bbf5fba-5424-42b6-ac3c-5987aee19fc7}
icacls "C:\ProgramData\VxAPO\%OLD%\config.toml" /grant "%USERNAME%:(M)" /C
icacls "C:\ProgramData\VxAPO\%NEW%\config.toml" /grant "%USERNAME%:(M)" /C
copy /Y "C:\ProgramData\VxAPO\%NEW%\config.toml" "C:\ProgramData\VxAPO\%NEW%\config.toml.passthrough.bak" >nul
copy /Y "C:\ProgramData\VxAPO\%OLD%\config.toml" "C:\ProgramData\VxAPO\%NEW%\config.toml"
del /Q "C:\ProgramData\VxAPO\%NEW%\config.toml.tmp"
echo.
echo Restored. This window can be closed now.
pause
