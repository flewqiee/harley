@echo off
REM build-premium.bat - PREMIUM surumu derler (premium modul DAHIL).
REM Cikti: app\dist\Harley-Premium-<surum>.exe
REM Bu .exe'yi SATISA cikar (mağazaya yukle). GitHub'a YUKLEME.
setlocal
cd /d "%~dp0app"

if not exist "premium\index.js" (
  echo HATA: app\premium\index.js bulunamadi - premium modul yok.
  pause
  exit /b 1
)

echo [1/2] Premium surum derleniyor...
call npx electron-builder --win >nul 2>&1
if errorlevel 1 (
  echo Derleme HATASI. Detay: cd app ^&^& npx electron-builder --win
  pause
  exit /b 1
)

echo [2/2] Dosya adi duzenleniyor...
for %%f in ("dist\Harley-*.exe") do (
  copy /y "%%f" "dist\Harley-Premium-%%~nf.exe" >nul
)
echo.
echo Bitti - PREMIUM surum: app\dist\Harley-Premium-<surum>.exe
echo Bu dosyayi magazaya (Shopier/LemonSqueezy) yukle. GitHub'a YUKLEME.
pause
exit /b 0
