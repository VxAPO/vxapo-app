@echo off
rem Grant the current user Modify on existing per-device config.toml files.
icacls "C:\ProgramData\VxAPO\*\config.toml" /grant "%USERNAME%:(M)" /C
echo.
echo ACL done. This window can be closed now.
pause
