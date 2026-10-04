CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\storyflow-kit\core && set STORYHARNESS_WORKSPACE=D:\storyflow-kit&& npx tsx src/cli.ts up --port 8421 >> %TEMP%\kit-core.log 2>&1", 0, False
