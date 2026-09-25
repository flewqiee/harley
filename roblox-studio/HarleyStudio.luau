-- Harley Studio — Roblox Studio ↔ Harley köprüsü
-- Bu eklenti, Harley uygulamasının (yerel 59333 portu) kuyruğunu saniyede bir
-- poll eder; görev gelince Luau çalıştırır / script okur-yazar / proje yapısını
-- döndürür ve sonucu Harley'ye iletir. Böylece Harley senin Studio'nda çalışır.
--
-- KURULUM (tek seferlik, ~2 dk):
--   1) Roblox Studio'yu aç, Dosya → Game Settings → Security → "Allow HTTP Requests" aç.
--   2) Eklentiler (Plugins) sekmesi → Eklenti Yöneticisi (Plugin Manager) → Yeni Eklenti.
--   3) Açılan script düzenleyicisine BU DOSYANIN TAMAMINI yapıştır ve kaydet
--      (Ctrl+S). Eklenti listesinde "HarleyStudio" görünür.
--   4) Harley uygulaması açıkken Eklentiler araç çubuğundaki "Harley Bağla"
--      düğmesine bas. Artık Harley'ye "Roblox oyunuma X ekle" diyebilirsin.
--
-- GÜVENLİK: Bu köprü yalnızca 127.0.0.1 (kendi bilgisayarın) ile konuşur.
-- Eklenti kodu, Harley'den gelen kodu Studio'nda çalıştırır — Harley yalnızca
-- sana özel çalıştığı için bu güvenlidir. İstersen eklentiyi kaldırabilirsin.

local HttpService = game:GetService("HttpService")

local BASE = "http://127.0.0.1:59333/studio"
local AGENT = HttpService:GenerateGUID(false)
local CONNECTED = false
local BUSY = false

-- Araç çubuğu düğmesi (ikon: varsayılan; istersen bir rbxassetid kullanabilirsin)
local toolbar = plugin:CreateToolbar("Harley")
local btn = toolbar:CreateButton(
	"Harley Bağla",
	"Harley ile Studio arasında köprü kur (Harley uygulaması açık olmalı)",
	""
)
btn:SetActive(false)

local function post(path, body)
	return HttpService:PostAsync(BASE .. path, HttpService:JSONEncode(body), Enum.HttpContentType.ApplicationJson)
end

local function findScript(name)
	for _, obj in ipairs(game:GetDescendants()) do
		if obj:IsA("LuaSourceContainer") and (obj.Name == name or obj:GetFullName() == name) then
			return obj
		end
	end
	return nil
end

local function structure(node, depth, budget)
	if depth > 6 or budget.n <= 0 or not node then
		return nil
	end
	local out = { name = node.Name, class = node.ClassName }
	if node:IsA("LuaSourceContainer") then
		out.script = true
		out.sourceLen = #(node.Source or "")
	end
	local kids = {}
	for _, c in ipairs(node:GetChildren()) do
		if budget.n <= 0 then
			break
		end
		budget.n = budget.n - 1
		local k = structure(c, depth + 1, budget)
		if k then
			table.insert(kids, k)
		end
	end
	if #kids > 0 then
		out.children = kids
	end
	return out
end

local function runTask(t)
	local ok, out = pcall(function()
		if t.type == "exec" then
			local fn = assert(loadstring(t.arg or "", "harley-studio"))
			local ret = fn()
			return (ret == nil) and "Tamamlandı" or tostring(ret)
		elseif t.type == "structure" then
			local budget = { n = 400 }
			local tree = {
				name = "Oyun",
				class = "DataModel",
				children = {
					structure(game:GetService("Workspace"), 1, budget),
					structure(game:GetService("ServerScriptService"), 1, budget),
					structure(game:GetService("ReplicatedStorage"), 1, budget),
					structure(game:GetService("StarterGui"), 1, budget),
					structure(game:GetService("ServerStorage"), 1, budget),
				},
			}
			return HttpService:JSONEncode(tree)
		elseif t.type == "get_source" then
			local s = findScript(t.arg or "")
			if not s then
				local names = {}
				for _, o in ipairs(game:GetDescendants()) do
					if o:IsA("LuaSourceContainer") then
						table.insert(names, o:GetFullName())
					end
				end
				return ("Script bulunamadı: %s\nMevcut scriptler:\n%s"):format(t.arg or "", table.concat(names, "\n"))
			end
			return ("--- %s ---\n%s"):format(s:GetFullName(), s.Source)
		elseif t.type == "set_source" then
			local spec = HttpService:JSONDecode(t.arg or "{}")
			local s = findScript(spec.name or "")
			if not s then
				return "Script bulunamadı: " .. tostring(spec.name)
			end
			s.Source = spec.source or ""
			return "Kaynak güncellendi: " .. s:GetFullName() .. " (" .. #s.Source .. " karakter)"
		end
		return "Bilinmeyen görev türü: " .. tostring(t.type)
	end)

	local res = {
		id = t.id,
		ok = ok,
		output = ok and tostring(out) or ("HATA: " .. tostring(out)),
	}
	local sent = pcall(function()
		post("/result?agent=" .. AGENT, res)
	end)
	if not sent then
		warn("[Harley] sonuç gönderilemedi — Harley uygulaması kapalı olabilir")
	end
end

-- Poll döngüsü: saniyede bir kuyruğu kontrol et
task.spawn(function()
	while true do
		task.wait(1)
		if CONNECTED and not BUSY then
			BUSY = true
			local ok, body = pcall(function()
				return HttpService:GetAsync(BASE .. "/poll?agent=" .. AGENT)
			end)
			if ok and body then
				local ok2, t = pcall(function()
					return HttpService:JSONDecode(body)
				end)
				if ok2 and t and t.task then
					task.spawn(runTask, t.task)
				end
			end
			BUSY = false
		end
	end
end)

btn.Click:Connect(function()
	CONNECTED = not CONNECTED
	btn:SetActive(CONNECTED)
	if CONNECTED then
		local ok, err = pcall(function()
			HttpService:GetAsync(BASE .. "/hello?agent=" .. AGENT)
		end)
		if ok then
			print("[Harley] Studio bağlandı — artık Harley'ye istediklerini söyleyebilirsin.")
		else
			warn("[Harley] Harley uygulamasına ulaşılamadı. Uygulamanın açık olduğundan emin ol: " .. tostring(err))
		end
	else
		print("[Harley] Bağlantı kesildi.")
	end
end)
