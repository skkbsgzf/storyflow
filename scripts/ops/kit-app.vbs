CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\storyflow-kit\panel\kitapp && npx next dev -H 127.0.0.1 -p 30142 >> %TEMP%\kitapp-dev.log 2>&1", 0, False
