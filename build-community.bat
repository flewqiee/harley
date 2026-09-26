@echo off
REM build-community.bat - TOPLULUK (public / GPL) surumunu derler.
REM Premium modulu (app\premium\) DAHIL EDILMEZ; boylece GitHub surumunde premium ozellikler olmaz.
REM Kullanim: proje kokunden cift tikla.
setlocal
cd /d "%~dp0app"

if exist "premium" (
  echo [1/3] Premium modul gecici olarak cikariliyor...
  move "premium" "..\premium_private_tmp" >nul
)

echo [2/3] Derleniyor (topluluk)...
call npx electron-builder --win >nul 2>&1
set RC=%errorlevel%

if exist "..\premium_private_tmp" (
  move "..\premium_private_tmp" "premium" >nul
)

if not "%RC%"=="0" (
  echo Derleme HATASI. Detay: cd app ^&^& npx electron-builder --win
  pause
  exit /b 1
)

echo [3/3] Bitti - TOPLULUK surumu: app\dist\Harley-^<surum^>.exe  (premium YOK)
echo Bu .exe'yi GitHub Release'e yukle.
pause
exit /b 0
