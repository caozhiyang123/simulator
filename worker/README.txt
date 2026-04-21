cd worker
pip install pyinstaller
pyinstaller --onefile app.py

cd worker
pyinstaller worker.spec
