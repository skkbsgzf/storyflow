# ops · kit 服务栈运维件（Windows 本机）

微服务化后的常驻服务栈：三个服务各自独立隐藏启动器 + 统一守护巡检 + 一键停/查。全程无 cmd 窗口。

## 服务拓扑

| 服务 | 端口 | 启动器 | 健康探针 | 日志（%TEMP%） |
|---|---|---|---|---|
| 内核（core，编排） | 8421 | `kit-core.vbs` | `/api/v1/openapi.json` | `kit-core.log` |
| 协议面（storyharness web） | 8431 | `kit-web.vbs` | `/api/hub` | `kit-web.log` |
| 面板 dev 热更（kitapp） | 30142 | `kit-app.vbs` | `/` | `kitapp-dev.log` |

## 日常操作

```bat
wscript scripts\ops\kit-guard.vbs   rem 手动巡检一次（挂了才拉，全程无窗）
scripts\ops\kit-status.bat          rem 健康报告（exit 0 = 全绿）
scripts\ops\kit-stop.bat            rem 按端口停全栈
```

## 守护

计划任务 `kit-guard`（每 5 分钟）→ `wscript //B scripts\ops\kit-guard.vbs` →
`kit-guard.bat` 对三服务做 HTTP 健康探针（`curl --fail`，非 2xx 即视为挂），挂了才经对应 .vbs 隐藏拉起。
日志单文件超 2MB 自动轮转 .old。

重建守护任务（管理员）：

```bat
schtasks /Create /TN kit-guard /TR "wscript.exe //B D:\storyflow-kit\scripts\ops\kit-guard.vbs" /SC MINUTE /MO 5 /F
```

## 纪律（为什么是这套形态）

- **长驻服务不挂在 agent 会话进程树下**——会被环境周期性回收（serve.py / next dev / core 全中过招），计划任务走的 svchost 作业树不受影响。
- **一切无窗**：.vbs 以窗口 style 0 拉起，巡检/重启都不弹 cmd。
- **工作区必须显式钉**：`set STORYHARNESS_WORKSPACE=D:\storyflow-kit`——用户环境变量指向 storymasterv4（另一项目），漏 set 会静默落到 v4。
- **解释器必须显式钉**：各启动器 cmd 链里 `set MINIFLOW_PYTHON=C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\python.exe`——本机 PATH 上的 `python` 是 Windows 商店 stub（exit 49 无输出），不钉则 core 的 .py 脚本壳（minitools.ts 执行器）必踩；kit-guard.vbs 同样注入后经 bat 传导，三个服务 .vbs 各自再钉一遍（双保险）。
- 日志是真相：排障看 `%TEMP%\kit-*.log`，不看窗口。
