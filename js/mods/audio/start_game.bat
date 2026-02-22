@echo off
setlocal

REM Переходим в папку, где лежит этот .bat
cd /d "%~dp0"

REM Порт (можно поменять)
set PORT=3001

REM Запускаем сервер в отдельном окне
start "Symbiochi audoi Server" cmd /k npx serve . -l %PORT%

REM Ждём чуть-чуть, чтобы сервер успел подняться
timeout /t 1 /nobreak >nul

REM Открываем браузер
start "" "http://localhost:%PORT%"

endlocal
