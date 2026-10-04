@echo off
rem kit-stop - stop the whole kit stack by port (8421 / 8431 / 30142)
for %%P in (8421 8431 30142) do (
  for /f "tokens=5" %%Q in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do taskkill /F /T /PID %%Q >nul 2>&1
)
echo kit stack stopped (8421/8431/30142).
