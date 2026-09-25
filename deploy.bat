@echo off
REM deploy.bat - Harley'yi derler ve %USERPROFILE%\Harley konumuna dagitir.
REM Tum win-unpacked kopyalanir (exe metadata'si duzelir).
REM Kullanim: deploy.bat  (proje kokunden calistir)
setlocal
cd /d "%~dp0app"

echo [1/3] Derleniyor (electron-builder)...
call npx electron-builder --win >nul 2>&1
if errorlevel 1 (
  echo Derleme HATASI - electron-builder ciktisini gormek icin: npx electron-builder --win
  exit /b 1
)

echo [2/3] Eski uygulama durduruluyor + win-unpacked kopyalaniyor...
taskkill /f /im Harley.exe >nul 2>&1
timeout /t 2 /nobreak >nul
xcopy /e /i /y "dist\win-unpacked" "%USERPROFILE%\Harley" >nul 2>&1
if errorlevel 1 (
  echo win-unpacked kopyalanamadi!
  exit /b 1
)

echo [3/3] Harley baslatiliyor...
start "" "%USERPROFILE%\Harley\Harley.exe"
exit /b 0
