' kit-guard 隐藏调度入口（计划任务指向本件）：巡检 bat 以窗口 style 0 执行，全程无窗
CreateObject("Wscript.Shell").Run """D:\storyflow-kit\scripts\ops\kit-guard.bat""", 0, False
