Launcher —— Worker 机器上的常驻"看门人"服务
=================================================

用途
----
worker.exe 里的 /start、/stop 接口，控制的是"模拟任务"的启停，前提是
worker.exe 这个进程本身必须已经在运行。但 worker.exe 进程本身要怎么
启动/关闭？如果它没在运行，就没有任何端口在监听，master 无法直接对
worker.exe 发起任何请求。

Launcher 就是为了解决这个问题：它是一个独立于 worker.exe、始终在线的
轻量级"看门人"服务，只负责：
  - 启动 worker.exe（进程不存在则拉起）
  - 关闭 worker.exe（terminate，超时后 kill）
  - 查询 worker.exe 运行状态

Master 从不直接对 worker.exe 发送"启动/关闭进程"的请求，而是发给
Launcher；Launcher 再用 subprocess/psutil 在本机拉起或杀掉 worker.exe
进程。整个链路复用 master<->worker 现有的 HTTP 代理模式，不需要开放
WinRM/PsExec/WMI 等高权限远程执行通道。

配置 (config.json)
------------------
{
  "worker_exe_path": "D:\\tools2\\worker\\worker.exe",  // worker.exe 完整路径
  "worker_process_name": "worker.exe",                    // 按进程名匹配（tasklist/psutil）
  "worker_cwd": "D:\\tools2\\worker",                      // 启动 worker.exe 时的工作目录
  "port": 5099,                                            // launcher 监听端口
  "auth_token": ""                                         // 可选共享密钥，配置后请求头需带 X-Launcher-Token
}

可选：不打包，直接跑源码（worker_command）
-------------------------------------------
如果不想打包 worker 成单文件可执行程序，而是直接用 python 解释器跑源码
（常见于 Linux 环境），在 config.json 里加一个 worker_command 数组，配了
它会优先于 worker_exe_path 生效：

{
  "worker_command": ["python3", "app.py"],
  "worker_cwd": "/opt/tools/worker",
  "port": 5099,
  "auth_token": ""
}

此时:
  - worker_exe_path / worker_process_name 可以留空或不配置，会被忽略
  - launcher 通过检查进程完整命令行是否包含 "app.py" 这个脚本路径来判断
    worker 是否在运行（因为系统里可能同时有很多个叫 python3 的进程，
    只看进程名不够，必须看命令行里具体跑的是哪个脚本）
  - 启动时使用 worker_cwd 作为工作目录去执行 worker_command，等价于
    在该目录下手动执行: python3 app.py
  - Windows 上如果也想直接跑源码而不打包，同样可以配置，例如
    "worker_command": ["python", "app.py"]，其余逻辑一致

本地开发运行
------------
pip install -r requirements.txt
python app.py

打包为单文件 exe
----------------
pip install pyinstaller
pyinstaller launcher.spec

打包后 dist/launcher.exe 与 config.json 放在同一目录即可运行。

部署到 Worker 机器（Windows，开机自启）
----------------------------------------
用 Windows 任务计划程序设置开机自动运行（无需登录用户，SYSTEM 权限）：

schtasks /create /tn "KiroLauncher" /tr "D:\path\to\launcher.exe" /sc onstart /ru SYSTEM /rl HIGHEST

或者通过"任务计划程序"GUI：
  触发器: 计算机启动时
  操作:   启动程序 -> D:\path\to\launcher.exe
  运行身份: SYSTEM 或指定管理员账户
  勾选"不管用户是否登录都要运行"

验证:
  重启机器后，浏览器/curl 访问 http://<worker_ip>:5099/launcher/health
  应返回 {"status": "ok", ...}

部署到 Worker 机器（Ubuntu/Linux，开机自启）
----------------------------------------------
Linux 上有两种方式让 launcher 拉起 worker，二选一：

方式 A：打包成可执行文件（PyInstaller）
config.json 里的路径/进程名要换成 Linux 风格（PyInstaller 在 Linux 上打包
出来的可执行文件不带 .exe 后缀，通常直接叫 worker）：

{
  "worker_exe_path": "/opt/tools/worker/worker",
  "worker_process_name": "worker",
  "worker_cwd": "/opt/tools/worker",
  "port": 5099,
  "auth_token": ""
}

方式 B：不打包，直接用 python3 跑源码（见上方"可选：不打包，直接跑源码"章节）
{
  "worker_command": ["python3", "app.py"],
  "worker_cwd": "/opt/tools/worker",
  "port": 5099,
  "auth_token": ""
}
方式 B 免去打包步骤，但要求目标机器已装好 worker 项目所需的 Python 依赖
（pip install -r requirements.txt），且 python3 命令在 PATH 中可用。

用 systemd 设置开机自启，新建 /etc/systemd/system/kiro-launcher.service：

[Unit]
Description=Kiro Launcher (worker.exe watchdog)
After=network.target

[Service]
Type=simple
ExecStart=/opt/tools/launcher/launcher
WorkingDirectory=/opt/tools/launcher
Restart=always
User=root

[Install]
WantedBy=multi-user.target

启用并启动:
  sudo systemctl daemon-reload
  sudo systemctl enable kiro-launcher
  sudo systemctl start kiro-launcher

验证:
  curl http://<worker_ip>:5099/launcher/health
  应返回 {"status": "ok", ...}

master 与 worker 分别在 Windows / Ubuntu 混合部署时，master 端只是发起
HTTP 请求，不关心对方操作系统 —— 同一套 master 代码可同时管理 Windows
和 Linux 上的 worker.exe / launcher，无需额外区分。

安全提醒
--------
- Launcher 具备"远程启动任意进程"的能力（局限于配置文件里写死的 worker_exe_path），
  只应在内网/可信 LAN 环境使用，不要暴露到公网。
- 建议配置 auth_token，master 端调用时携带 X-Launcher-Token 请求头做简单校验。
- worker_exe_path 硬编码在 launcher 的 config.json 里，不接受外部请求传入路径，
  避免被利用去启动任意程序。
