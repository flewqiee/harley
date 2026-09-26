@echo off
setlocal
title Harley - Temiz Kaldirma

echo ============================================
echo    Harley  -  Temiz Kaldirma
echo ============================================
echo.
echo Bu islem Harley'in TUM yerel verilerini siler:
echo    - %USERPROFILE%\HarleyDosyalar
echo    - %APPDATA%\harley
echo    - %USERPROFILE%\HarleySes   (yerel ses)
echo    - %USERPROFILE%\HarleyMCP   (Roblox koprusu)
echo    - %USERPROFILE%\Harley      (kurulu surum klasoru)
echo.
echo NOT: Harley kurulum/servis/kayit defteri girdisi BIRAKMAZ.
echo      Indirdigin Harley-*.exe dosyasini ayrica elle sil.
echo.

set /p CONFIRM=Devam edilsin mi? (E/H): 
if /I not "%CONFIRM%"=="E" (
  echo Iptal edildi.
  pause
  exit /b 0
)

echo.
echo Harley kapatiliyor...
taskkill /IM Harley.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo Veriler siliniyor...
if exist "%USERPROFILE%\HarleyDosyalar" rmdir /s /q "%USERPROFILE%\HarleyDosyalar"
if exist "%APPDATA%\harley" rmdir /s /q "%APPDATA%\harley"
if exist "%APPDATA%\privacy-assistant-app" rmdir /s /q "%APPDATA%\privacy-assistant-app"
if exist "%USERPROFILE%\HarleySes" rmdir /s /q "%USERPROFILE%\HarleySes"
if exist "%USERPROFILE%\HarleyMCP" rmdir /s /q "%USERPROFILE%\HarleyMCP"
if exist "%USERPROFILE%\Harley" rmdir /s /q "%USERPROFILE%\Harley"

echo.
set /p CODE=HarleyKod klasoru de silinsin mi? (kendi scriptlerin olabilir) (E/H): 
if /I "%CODE%"=="E" (
  if exist "%USERPROFILE%\HarleyKod" rmdir /s /q "%USERPROFILE%\HarleyKod"
)

echo.
echo Bitti. Harley verileri temizlendi.
echo (Kaynaktan kullandiysan proje klasorunu de sil.)
pause
exit /b 0
