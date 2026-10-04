@echo off
rem kit-status - health report for the three services (exit 0 = all green)
setlocal enabledelayedexpansion
set BAD=0
call :check 8421 core /api/v1/openapi.json
call :check 8431 web /api/hub
call :check 30142 panel-dev /
if !BAD! GTR 0 (
  echo !BAD! services down - run: wscript D:\storyflow-kit\scripts\ops\kit-guard.vbs
  exit /b 1
)
exit /b 0

:check
curl --fail -s -o nul --noproxy "*" --max-time 4 http://127.0.0.1:%1%3
if errorlevel 1 (
  echo [DOWN] %2 :%1
  set /a BAD+=1
) else (
  echo [ok] %2 :%1
)
goto :eof
