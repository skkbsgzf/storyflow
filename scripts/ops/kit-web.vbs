CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\storyflow-kit\storyharness && set STORYHARNESS_WORKSPACE=D:\storyflow-kit&& npx tsx src/cli.ts web --no-open >> %TEMP%\kit-web.log 2>&1", 0, False
