@echo off
REM deploy-original.bat - Yeni kodu KURULU (orijinal) Harley'e entegre eder.
REM Sadece resources\app.asar guncellenir; exe'ye DOKUNULMAZ (Smart App Control icin guvenli).
REM Kullanim: proje kokunden cift tikla / cmd'de calistir.
setlocal
cd /d "%~dp0app"

echo [1/4] Derleniyor (win-unpacked)...
call npx electron-builder --win dir >nul 2>&1
if errorlevel 1 (
  echo   Derleme HATASI. Detay icin: npx electron-builder --win dir
  pause
  exit /b 1
)

echo [2/4] Harley kapatiliyor...
taskkill /im Harley.exe /f >nul 2>&1
timeout /t 2 /nobreak >nul

echo [3/4] app.asar guncelleniyor...
if not exist "%USERPROFILE%\Harley\resources" (
  echo   HATA: Kurulu Harley bulunamadi: %USERPROFILE%\Harley
  pause
  exit /b 1
)
copy /y "dist\win-unpacked\resources\app.asar" "%USERPROFILE%\Harley\resources\app.asar" >nul
if errorlevel 1 (
  echo   Kopyalama HATASI (dosya kilitli olabilir - Harley kapali mi?).
  pause
  exit /b 1
)

echo [4/4] Harley baslatiliyor...
start "" "%USERPROFILE%\Harley\Harley.exe"
echo.
echo Bitti - orijinal Harley yeni kodla guncellendi.
pause
exit /b 0
