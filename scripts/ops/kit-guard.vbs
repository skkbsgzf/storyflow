' kit-guard hidden dispatch entry (scheduled task points to this file): inspection bat runs with window style 0, fully windowless
' MINIFLOW_PYTHON pinned to the real python (the python on PATH is a Windows Store stub, exit 49 with no output),
' propagated via cmd set to kit-guard.bat and the three-service .vbs launch path (each launcher pins it again, double insurance).
CreateObject("Wscript.Shell").Run "cmd /c set MINIFLOW_PYTHON=C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\python.exe&& ""D:\storyflow-kit\scripts\ops\kit-guard.bat""", 0, False
