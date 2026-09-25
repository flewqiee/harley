// spotify.js — Minimalist Spotify durum + kontrol.
// Modern Spotify'da eski yerel HTTP API (port 440) kaldırıldı; bunun yerine
// Windows'un kendi SMTC (System Media Transport Controls) API'sini kullanıyoruz:
// şarkı adı, sanatçı, albüm, kapak, pozisyon, çalma durumu — sistem seviyesinde,
// Spotify dahil tüm medya uygulamaları için çalışır.
// Kontroller: Windows media key'leri (play/pause, next, prev).

const { execFile } = require('child_process');

// ---------- PowerShell WinRT helper (SMTC erişimi) ----------
const SMTC_HEAD = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\u00601' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait() | Out-Null
  $netTask.Result
}
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $manager.GetCurrentSession()
`;

// Spotify çalışıyor mu?
function isSpotifyRunning() {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-Process -Name Spotify -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count',
    ], { windowsHide: true }, (err, out) => {
      resolve(!err && parseInt(String(out || '').trim(), 10) > 0);
    });
  });
}

// SMTC'den durum: title/artist/album/status/pos/dur (kısa önbellek — renderer 2sn'de bir sorar)
let statusCache = { ts: 0, val: null };
function clearCache() { statusCache = { ts: 0, val: null }; }
function getSpotifyStatus() {
  const now = Date.now();
  if (statusCache.val && now - statusCache.ts < 1200) return Promise.resolve(statusCache.val);
  return new Promise(async (resolve) => {
    const finish = (v) => { statusCache.val = v; statusCache.ts = Date.now(); resolve(v); };
    const running = await isSpotifyRunning();
    if (!running) return finish({ running: false, playing: false, track: null, artist: null, album: null, position: 0, duration: 0 });

    const ps = SMTC_HEAD + `
if ($null -eq $session) { Write-Output 'NO_SESSION'; exit }
$source = '' + $session.SourceAppUserModelId
$props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$play = $session.GetPlaybackInfo()
$tl = $session.GetTimelineProperties()
Write-Output ('source=' + $source)
Write-Output ('title=' + $props.Title)
Write-Output ('artist=' + $props.Artist)
Write-Output ('album=' + $props.AlbumTitle)
Write-Output ('status=' + $play.PlaybackStatus)
Write-Output ('pos=' + [math]::Round($tl.Position.TotalSeconds))
Write-Output ('dur=' + [math]::Round($tl.EndTime.TotalSeconds))
`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err || !out) return finish({ running: true, playing: false, track: null, artist: null, album: null, position: 0, duration: 0 });
      const d = {};
      for (const line of out.split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) d[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      // Kaynak filtresi: çalan medya Spotify değilse (Chrome/YouTube vb.)
      // Spotify çubuğuna onun bilgisini koyma — "Spotify açık, şarkı yok" göster.
      const isSpotifySource = /spotify/i.test(d.source || '');
      if (d.title === undefined || d.title === 'NO_SESSION' || !isSpotifySource) {
        return finish({ running: true, playing: false, track: null, artist: null, album: null, position: 0, duration: 0 });
      }
      finish({
        running: true,
        playing: String(d.status || '').toLowerCase() === 'playing',
        track: d.title || null,
        artist: d.artist || null,
        album: d.album || null,
        position: parseFloat(d.pos) || 0,
        duration: parseFloat(d.dur) || 0,
      });
    });
  });
}

// ---------- kapak (album art) ----------
// iTunes Search API (https, ücretsiz, anahtarsız) — şarkı başına bir kez, önbellekli.
const coverCache = new Map(); // "sanatçı — şarkı" -> { dataUrl, ts }
function getCover(artist, track) {
  return new Promise((resolve) => {
    const key = String(artist || '') + ' — ' + String(track || '');
    if (!track) return resolve(null);
    const hit = coverCache.get(key);
    if (hit && Date.now() - hit.ts < 10 * 60000) return resolve(hit.dataUrl);

    const https = require('https');
    const q = encodeURIComponent(String(artist || '') + ' ' + track).replace(/%20/g, '+');
    const req = https.get({ hostname: 'itunes.apple.com', path: '/search?term=' + q + '&entity=song&limit=1', timeout: 5000 }, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => {
        try {
          const j = JSON.parse(data);
          const url = j.results && j.results[0] && j.results[0].artworkUrl100
            ? j.results[0].artworkUrl100.replace('100x100', '160x160')
            : null;
          if (url) coverCache.set(key, { dataUrl: url, ts: Date.now() });
          resolve(url);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Windows media key gönder (play/pause, next, prev)
function sendMediaKey(key) {
  const codes = {
    play: 0xB3,  // VK_MEDIA_PLAY_PAUSE
    next: 0xB0,  // VK_MEDIA_NEXT_TRACK
    prev: 0xB1,  // VK_MEDIA_PREV_TRACK
    stop: 0xB2,  // VK_MEDIA_STOP
  };
  const code = codes[key];
  if (!code) return Promise.resolve(false);
  const ps = `
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class MediaKeys {
      [DllImport("user32.dll")]
      public static extern void keybd_event(byte bKey, byte bScan, int dwFlags, int dwExtraInfo);
    }
"@
    [MediaKeys]::keybd_event(${code}, 0, 0, 0)
    [MediaKeys]::keybd_event(${code}, 0, 2, 0)
  `;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

// Belirli saniyeye atla (SMTC TryChangePlaybackPositionAsync)
function seek(seconds) {
  return new Promise((resolve) => {
    const ps = SMTC_HEAD + `
if ($null -eq $session) { exit }
$ts = [TimeSpan]::FromSeconds(${Math.max(0, Math.floor(seconds))})
$null = Await ($session.TryChangePlaybackPositionAsync($ts)) ([boolean])
Write-Output 'ok'
`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err) => resolve(!err));
  });
}

// Spotify'ı başlat (çalışmıyorsa)
function startSpotify() {
  return new Promise((resolve) => {
    const paths = [
      process.env.APPDATA + '/Spotify/spotify.exe',
      process.env.LOCALAPPDATA + '/Spotify/spotify.exe',
    ];
    for (const p of paths) {
      try {
        const { spawn } = require('child_process');
        spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath '${p}'`], { windowsHide: true });
        resolve(true);
        return;
      } catch { /* dene */ }
    }
    resolve(false);
  });
}

module.exports = {
  isSpotifyRunning,
  sendMediaKey,
  startSpotify,
  getSpotifyStatus,
  getCover,
  seek,
  clearCache,
};
