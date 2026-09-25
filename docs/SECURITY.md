# Security Hardening — Personal AI Assistant

Everything runs on localhost. The goal: keep it that way, and add defense in depth.

## Already done (by codebuff)

- ✅ **Model params fixed** — were stored as `=qwen3:4b` (a broken expression); now plain values.
- ✅ **Chat webhooks enabled** with `mode: embedded` + `public: true` — the app talks only to `/webhook/<id>/chat`, never to the n8n API or your Google tokens.
- ✅ **Two isolated workflows** (4b / 8b) — each active, each with its own webhook URL.
- ✅ **n8n API key stored only in a local file** (`n8n-api-key.txt`) — never hardcoded in the app or any shipped code. The desktop app does **not** receive the API key at all.

## Do these once (your actions)

1. **n8n account password** — make sure your n8n login has a strong password (Settings → Users). This protects the editor and the management API.
2. **Rotate the API key** — Settings → n8n API → delete `codebuff` key, create a new one, update `n8n-api-key.txt`. Do this if the key ever leaks (it's been in a chat transcript).
3. **Firewall** — block inbound connections on ports `5678` (n8n) and `11434` (Ollama) for anything except localhost. Windows Defender Firewall → inbound rules. Ollama binds to 127.0.0.1 by default; verify: `ollama serve` shows `127.0.0.1:11434`, not `0.0.0.0`.
4. **Google OAuth, minimal scopes** — in Google Cloud Console, your OAuth consent screen should have **only your own email** as a test user, and scopes limited to what the tools use (Gmail read, Calendar read, Drive, Sheets). Never publish the app to "External → production". Use "Testing" (or Internal if you have Workspace).
5. **Never expose n8n to the internet.** If you ever want remote access, put it behind a reverse proxy with TLS + auth — but for a personal localhost assistant, keep it off the network entirely.

## Done (v0.7.16)

- ✅ **Basic auth on the chat endpoint** — 4 sohbet workflow'unun Chat Trigger'ına `httpBasicAuth` credential'ı bağlandı (kullanıcı `harley`, şifre `HarleyDosyalar/n8n-webhook-auth.txt` içinde). App `Authorization: Basic` gönderir; auth'suz istek 401 döner (canlı doğrulandı).
- ✅ **Yerel 59333 API token'ı** — app ilk açılışta `HarleyDosyalar/harley-token.txt` içine rastgele token üretir; `/pc`, `/ozet`, `/remind`, `/screen-analyze`, `/studio/mcp`, `/studio/exec` gibi uçlar `X-Harley-Token` ister (401 doğrulandı). Studio eklentisinin kullandığı `/studio/poll`, `/studio/result`, `/studio/hello` ve salt-okunur `/studio/status` açık kalır (Luau eklentisi token gönderemez). n8n'deki 6 araç token'ı dosyadan okuyup başlıkla gönderir; `tool-healthcheck.js` de aynı şekilde güncellendi.

## Optional hardening (defense in depth)

- ~~**Basic auth on the chat endpoint**~~ (tamamlandı — yukarıya bak)
- **API key scoping** — n8n 2.x lets you create project-scoped API keys; scope the key to the relevant project(s) only.
- **Persistent memory** — replace Window Buffer Memory (in-RAM) with Postgres/Redis memory so conversation history survives n8n restarts. (Postgres runs locally.)

## Threat model notes

- The chat webhook on localhost is reachable by **any local process/user on this machine** unless you add basic auth — that's why item 6 exists.
- The desktop app never stores Google credentials or the n8n API key — it only POSTs messages to the chat webhook.
- Ollama serves the model on localhost only; the model itself never leaves the machine.
- Prompt injection is already mitigated in the assistant's system prompt (external content is treated as data, not instructions).
