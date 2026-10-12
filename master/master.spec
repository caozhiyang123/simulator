# -*- mode: python ; coding: utf-8 -*-

import os

from PyInstaller.utils.hooks import collect_submodules

# 源码目录(运行 `pyinstaller master.spec` 时的当前目录,即 master/)。
_src_dir = os.path.abspath(os.getcwd())

# 需要在运行时可被 import 的一方(first-party)包。
# 注意:把它们放进 datas 无效——datas 只是普通数据文件,不会加入模块搜索路径,
# 所以 `import services` 依然会报 ModuleNotFoundError。必须用 hiddenimports 收集。
_local_packages = ['services', 'blueprints']
_local_hiddenimports = []
for _pkg in _local_packages:
    _local_hiddenimports += collect_submodules(_pkg)

a = Analysis(
    ['app.py'],
    pathex=[_src_dir],
    binaries=[],
    datas=[
        ('templates', 'templates'),
        ('static', 'static'),
        ('config.json', '.'),
        ('iam', 'iam'),
        ('data/machine', 'data/machine'),
        ('config.py', '.'),
        ('task_splitter.py', '.'),
        ('poller.py', '.'),
        ('merger.py', '.'),
        ('simulator_runner.py', '.'),
        ('file_sync.py', '.'),
        ('result_parser.py', '.'),
        ('progress_store.py', '.'),
        ('history_store.py', '.'),
    ],
    hiddenimports=['psutil', 'pypdf'] + _local_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='master',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
