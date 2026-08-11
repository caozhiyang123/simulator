nohup python3 app.py > output.log 2>&1 &

cd worker
pip install pyinstaller
pyinstaller --onefile app.py

cd worker
pyinstaller worker.spec
