@echo off
rem kit-guard - health check + restart-if-dead (scheduled via kit-guard.vbs, fully hidden)
rem probe = curl --fail against HTTP health endpoints (better than netstat: a hung process still LISTENs)
setlocal
set OPS=D:\storyflow-kit\scripts\ops

rem log rotation: > 2MB -> .old
for %%F in ("%TEMP%\kit-core.log" "%TEMP%\kit-web.log" "%TEMP%\kitapp-dev.log") do (
  if exist %%F for %%Z in (%%F) do if %%~zZ GTR 2097152 move /y %%Z %%Z.old >nul 2>&1
)

rem 8421 core
curl --fail -s -o nul --noproxy "*" --max-time 4 http://127.0.0.1:8421/api/v1/openapi.json
if errorlevel 1 %OPS%\kit-core.vbs

rem 8431 protocol face
curl --fail -s -o nul --noproxy "*" --max-time 4 http://127.0.0.1:8431/api/hub
if errorlevel 1 %OPS%\kit-web.vbs

rem 30142 panel dev
curl --fail -s -o nul --noproxy "*" --max-time 4 http://127.0.0.1:30142/
if errorlevel 1 %OPS%\kit-app.vbs
endlocal
