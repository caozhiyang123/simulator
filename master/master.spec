# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('templates', 'templates'),
        ('static', 'static'),
        ('config.json', '.'),
        ('users.json', '.'),
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
    hiddenimports=['psutil', 'pypdf'],
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
