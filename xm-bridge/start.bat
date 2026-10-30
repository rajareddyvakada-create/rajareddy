@echo off
rem One-click start for the XM bridge. Double-click this file on the Windows PC
rem that has MetaTrader 5 installed and logged into your XM account.
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo.
  echo   .env is missing.
  echo   Copy .env.example to .env in this folder, then fill in your MT5 login,
  echo   password, server and an API key. Open .env.example to see the format.
  echo.
  pause
  exit /b 1
)

cd backend

if not exist ".venv" (
  echo   Setting up Python for the first time. This takes a minute...
  python -m venv .venv
  if errorlevel 1 goto :nopython
)

call .venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
if errorlevel 1 goto :pipfail

echo.
echo   ===========================================================
echo    On this PC:   http://localhost:8000
echo    On the phone: use one of these addresses, port 8000
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do echo        http://%%A:8000
echo.
echo    Make sure MT5 is running and Algo Trading is ON (green).
echo    Press Ctrl+C in this window to stop the server.
echo   ===========================================================
echo.

python -m uvicorn server:app --host 0.0.0.0 --port 8000
pause
exit /b 0

:nopython
echo.
echo   Python was not found, or it failed to create the environment.
echo   Install 64-bit Python 3.10, 3.11 or 3.12 from python.org and tick
echo   "Add python.exe to PATH" during the install. 32-bit Python cannot
echo   talk to the 64-bit MT5 terminal.
echo.
pause
exit /b 1

:pipfail
echo.
echo   Installing the Python packages failed. Check the messages above.
echo   The most common cause is 32-bit Python: the MetaTrader5 package
echo   only installs on 64-bit Python.
echo.
pause
exit /b 1
