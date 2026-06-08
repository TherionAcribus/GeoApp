require("Wherigo")
ZonePoint = Wherigo.ZonePoint
Distance = Wherigo.Distance
Player = Wherigo.Player

function _m9REO(str)
  local res = ""
  local dtable = "mE6LANC~\0042r)qOj\0215Z$9cDn\0178>\0314I!}\t\006x\025h[\019\023\n' lk\022y\a\0140`s\f\026=\005]vf\030\002%\029d\rF^\000#o\027.b3\024\003t1Y,zU\001BpX-R?\vVi/\b\"Qg+J@P\028T7&aKG{\015\016S\\:(wM_|eH\018<*u\020;W"
  for i = 1, #str do
    local b = str:byte(i)
    if 0 < b and b <= 127 then
      res = res .. string.char(dtable:byte(b))
    else
      res = res .. string.char(b)
    end
  end
  return res
end

require("table")
require("math")
math.randomseed(os.time())
math.random()
math.random()
math.random()
_Urwigo = {}
_Urwigo.InlineRequireLoaded = {}
_Urwigo.InlineRequireRes = {}

function _Urwigo.InlineRequire(moduleName)
  local res
  if _Urwigo.InlineRequireLoaded[moduleName] == nil then
    res = _Urwigo.InlineModuleFunc[moduleName]()
    _Urwigo.InlineRequireLoaded[moduleName] = 1
    _Urwigo.InlineRequireRes[moduleName] = res
  else
    res = _Urwigo.InlineRequireRes[moduleName]
  end
  return res
end

function _Urwigo.Round(num, idp)
  local mult = 10 ^ (idp or 0)
  return math.floor(num * mult + 0.5) / mult
end

function _Urwigo.Ceil(num, idp)
  local mult = 10 ^ (idp or 0)
  return math.ceil(num * mult) / mult
end

function _Urwigo.Floor(num, idp)
  local mult = 10 ^ (idp or 0)
  return math.floor(num * mult) / mult
end

_Urwigo.DialogQueue = {}

function _Urwigo.RunDialogs(callback)
  local dialogs = _Urwigo.DialogQueue
  local lastCallback
  _Urwigo.DialogQueue = {}
  local msgcb = {}
  
  function msgcb(action)
    if action ~= nil then
      if lastCallback ~= nil then
        lastCallback(action)
      end
      local entry = table.remove(dialogs, 1)
      if entry ~= nil then
        lastCallback = entry.Callback
        if entry.Text ~= nil then
          Wherigo.MessageBox({
            Text = entry.Text,
            Media = entry.Media,
            Buttons = entry.Buttons,
            Callback = msgcb
          })
        else
          msgcb(action)
        end
      elseif callback ~= nil then
        callback()
      end
    end
  end
  
  msgcb(true)
end

function _Urwigo.MessageBox(tbl)
  _Urwigo.RunDialogs(function()
    Wherigo.MessageBox(tbl)
  end)
end

function _Urwigo.OldDialog(tbl)
  _Urwigo.RunDialogs(function()
    Wherigo.Dialog(tbl)
  end)
end

function _Urwigo.Dialog(buffered, tbl, callback)
  for k, v in ipairs(tbl) do
    table.insert(_Urwigo.DialogQueue, v)
  end
  if callback ~= nil then
    table.insert(_Urwigo.DialogQueue, {Callback = callback})
  end
  if not buffered then
    _Urwigo.RunDialogs(nil)
  end
end

function _Urwigo.Hash(str)
  local b = 378551
  local a = 63689
  local hash = 0
  for i = 1, #str do
    hash = hash * a + string.byte(str, i)
    hash = math.fmod(hash, 65535)
    a = a * b
    a = math.fmod(a, 65535)
  end
  return hash
end

_Urwigo.DaysInMonth = {
  31,
  28,
  31,
  30,
  31,
  30,
  31,
  31,
  30,
  31,
  30,
  31
}

function _Urwigo_Date_IsLeapYear(year)
  if year % 400 == 0 then
    return true
  elseif year % 100 == 0 then
    return false
  elseif year % 4 == 0 then
    return true
  else
    return false
  end
end

function _Urwigo.Date_DaysInMonth(year, month)
  if month ~= 2 then
    return _Urwigo.DaysInMonth[month]
  elseif _Urwigo_Date_IsLeapYear(year) then
    return 29
  else
    return 28
  end
end

function _Urwigo.Date_DayInYear(t)
  local res = t.day
  for month = 1, t.month - 1 do
    res = res + _Urwigo.Date_DaysInMonth(t.year, month)
  end
  return res
end

function _Urwigo.Date_HourInWeek(t)
  return t.hour + (t.wday - 1) * 24
end

function _Urwigo.Date_HourInMonth(t)
  return t.hour + t.day * 24
end

function _Urwigo.Date_HourInYear(t)
  return t.hour + (_Urwigo.Date_DayInYear(t) - 1) * 24
end

function _Urwigo.Date_MinuteInDay(t)
  return t.min + t.hour * 60
end

function _Urwigo.Date_MinuteInWeek(t)
  return t.min + t.hour * 60 + (t.wday - 1) * 1440
end

function _Urwigo.Date_MinuteInMonth(t)
  return t.min + t.hour * 60 + (t.day - 1) * 1440
end

function _Urwigo.Date_MinuteInYear(t)
  return t.min + t.hour * 60 + (_Urwigo.Date_DayInYear(t) - 1) * 1440
end

function _Urwigo.Date_SecondInHour(t)
  return t.sec + t.min * 60
end

function _Urwigo.Date_SecondInDay(t)
  return t.sec + t.min * 60 + t.hour * 3600
end

function _Urwigo.Date_SecondInWeek(t)
  return t.sec + t.min * 60 + t.hour * 3600 + (t.wday - 1) * 86400
end

function _Urwigo.Date_SecondInMonth(t)
  return t.sec + t.min * 60 + t.hour * 3600 + (t.day - 1) * 86400
end

function _Urwigo.Date_SecondInYear(t)
  return t.sec + t.min * 60 + t.hour * 3600 + (_Urwigo.Date_DayInYear(t) - 1) * 86400
end

_Urwigo.InlineModuleFunc = {}
_6SJ = Wherigo.ZCartridge()
_z2Mh = Wherigo.ZMedia(_6SJ)
_z2Mh.Id = "e82728a7-ee21-450a-b769-b1738c6d79fb"
_z2Mh.Name = _m9REO("\021[3wi|")
_z2Mh.Description = ""
_z2Mh.AltText = ""
_z2Mh.Resources = {
  {
    Type = "png",
    Filename = "ciseau.png",
    Directives = {}
  }
}
_BFG = Wherigo.ZMedia(_6SJ)
_BFG.Id = "e7de3505-e88d-483a-91c2-0b3b2309940e"
_BFG.Name = _m9REO("T[w\v\vw")
_BFG.Description = ""
_BFG.AltText = ""
_BFG.Resources = {
  {
    Type = "png",
    Filename = "pierre.png",
    Directives = {}
  }
}
_i_eb = Wherigo.ZMedia(_6SJ)
_i_eb.Id = "b70d3417-167b-4263-9305-1495ec8e15c0"
_i_eb.Name = _m9REO("TiT[w\v")
_i_eb.Description = ""
_i_eb.AltText = ""
_i_eb.Resources = {
  {
    Type = "png",
    Filename = "papier.png",
    Directives = {}
  }
}
_IVUHL = Wherigo.ZMedia(_6SJ)
_IVUHL.Id = "2595a056-b251-4897-b8af-b678a4f22c49"
_IVUHL.Name = _m9REO("Ti`w*?w*`i\v?w")
_IVUHL.Description = ""
_IVUHL.AltText = ""
_IVUHL.Resources = {
  {
    Type = "jpeg",
    Filename = "image.jpeg",
    Directives = {}
  }
}
_94060 = Wherigo.ZMedia(_6SJ)
_94060.Id = "19d6f311-f8b6-440b-9abb-7acbb0b5b2ba"
_94060.Name = _m9REO("\006i\001w")
_94060.Description = ""
_94060.AltText = ""
_94060.Resources = {
  {
    Type = "png",
    Filename = "pbatp.png",
    Directives = {}
  }
}
_kCx = Wherigo.ZMedia(_6SJ)
_kCx.Id = "42c98dad-9a9c-4790-b327-11c97bc0b6d8"
_kCx.Name = _m9REO("\006i\001w")
_kCx.Description = ""
_kCx.AltText = ""
_kCx.Resources = {
  {
    Type = "png",
    Filename = "pbatc.png",
    Directives = {}
  }
}
_h2oP = Wherigo.ZMedia(_6SJ)
_h2oP.Id = "bc4a82a8-1cb1-4cf1-ab71-7f7381d21155"
_h2oP.Name = _m9REO("\006i\001w")
_h2oP.Description = ""
_h2oP.AltText = ""
_h2oP.Resources = {
  {
    Type = "png",
    Filename = "cbatp.png",
    Directives = {}
  }
}
_tlay = Wherigo.ZMedia(_6SJ)
_tlay.Id = "213596e7-d710-480b-9284-df6d67589032"
_tlay.Name = _m9REO(":[\023i+w")
_tlay.Description = ""
_tlay.AltText = ""
_tlay.Resources = {
  {
    Type = "jpg",
    Filename = "finale.jpg",
    Directives = {}
  }
}
_6SJ.Id = "0642526b-6f8d-4cfc-9c1e-14f92622ddb5"
_6SJ.Name = "Caillou couteau chiffon"
_6SJ.Description = "Jeu du pierre papier ciseau"
_6SJ.Visible = true
_6SJ.Activity = "Fiction"
_6SJ.StartingLocationDescription = ""
_6SJ.StartingLocation = ZonePoint(44.682567, -1.016117, 0)
_6SJ.Version = "1"
_6SJ.Company = ""
_6SJ.Author = "tichivi"
_6SJ.BuilderVersion = "URWIGO 1.22.5798.37755"
_6SJ.CreateDate = "02/14/2016 10:57:47"
_6SJ.PublishDate = "1/1/0001 12:00:00 AM"
_6SJ.UpdateDate = "02/27/2016 17:50:03"
_6SJ.LastPlayedDate = "1/1/0001 12:00:00 AM"
_6SJ.TargetDevice = "PocketPC"
_6SJ.TargetDeviceVersion = "0"
_6SJ.StateId = "1"
_6SJ.CountryId = "2"
_6SJ.Complete = false
_6SJ.UseLogging = true
_6SJ.Media = _IVUHL
_6SJ.Icon = _IVUHL
finboite = Wherigo.Zone(_6SJ)
finboite.Id = "6f0da61b-8e5e-42ef-87ed-8497cf3f9b49"
finboite.Name = _m9REO(":[\023i+w")
finboite.Description = _m9REO("HE[Lw")
finboite.Visible = false
finboite.Commands = {}
finboite.DistanceRange = Distance(-1, "feet")
finboite.ShowObjects = "OnEnter"
finboite.ProximityRange = Distance(60, "meters")
finboite.AllowSetPositionTo = false
finboite.Active = false
finboite.Points = {
  ZonePoint(44.6812248830934, -1.01498863755379, 0),
  ZonePoint(44.6812668724738, -1.01477121025029, 0),
  ZonePoint(44.6810912803169, -1.01462894300231, 0),
  ZonePoint(44.6810531080384, -1.01491347749827, 0)
}
finboite.OriginalPoint = ZonePoint(44.6811590359806, -1.01482556707617, 0)
finboite.DistanceRangeUOM = "Feet"
finboite.ProximityRangeUOM = "Meters"
finboite.OutOfRangeName = ""
finboite.InRangeName = ""
zone3 = Wherigo.Zone(_6SJ)
zone3.Id = "1b5a9552-5a21-46fd-aa7b-e6a725f33293"
zone3.Name = _m9REO("\aE|Lwi|")
zone3.Description = _m9REO("PE\023wI")
zone3.Visible = false
zone3.Media = _z2Mh
zone3.Commands = {}
zone3.DistanceRange = Distance(-1, "feet")
zone3.ShowObjects = "OnEnter"
zone3.ProximityRange = Distance(56, "meters")
zone3.AllowSetPositionTo = false
zone3.Active = false
zone3.Points = {
  ZonePoint(44.6816067771056, -1.0173126401254, 0),
  ZonePoint(44.6816402673577, -1.0173780912479, 0),
  ZonePoint(44.6811974013762, -1.01739419952745, 0),
  ZonePoint(44.6811935835512, -1.01730828870291, 0),
  ZonePoint(44.6813653854228, -1.01731365812946, 0),
  ZonePoint(44.6813711121429, -1.01724654029774, 0),
  ZonePoint(44.6814341060286, -1.01722774730488, 0),
  ZonePoint(44.6815009176508, -1.01723043201819, 0),
  ZonePoint(44.6815524579924, -1.01725727915085, 0)
}
zone3.OriginalPoint = ZonePoint(44.6814291120698, -1.01729654183386, 0)
zone3.DistanceRangeUOM = "Feet"
zone3.ProximityRangeUOM = "Meters"
zone3.OutOfRangeName = ""
zone3.InRangeName = ""
zone2 = Wherigo.Zone(_6SJ)
zone2.Id = "db648188-02df-4779-bfb0-98a5e6848ba4"
zone2.Name = _m9REO("\a$[::E\023")
zone2.Description = _m9REO("PE\023w\n")
zone2.Visible = false
zone2.Media = _i_eb
zone2.Commands = {}
zone2.DistanceRange = Distance(-1, "feet")
zone2.ShowObjects = "OnEnter"
zone2.ProximityRange = Distance(60, "meters")
zone2.AllowSetPositionTo = false
zone2.Active = false
zone2.Points = {
  ZonePoint(44.6823631599476, -1.01670000000001, 0),
  ZonePoint(44.6822909454101, -1.01685651284303, 0),
  ZonePoint(44.6821263967764, -1.01671391649153, 0),
  ZonePoint(44.6822144885273, -1.0165549566243, 0)
}
zone2.OriginalPoint = ZonePoint(44.6822487476653, -1.01670634648972, 0)
zone2.DistanceRangeUOM = "Feet"
zone2.ProximityRangeUOM = "Meters"
zone2.OutOfRangeName = ""
zone2.InRangeName = ""
zone1 = Wherigo.Zone(_6SJ)
zone1.Id = "3e6a0c9c-4515-47f0-88f2-4ce9b80a810d"
zone1.Name = _m9REO("\ai[++E|")
zone1.Description = _m9REO("PE\023wM")
zone1.Visible = false
zone1.Media = _BFG
zone1.Commands = {}
zone1.DistanceRange = Distance(-1, "feet")
zone1.ShowObjects = "OnEnter"
zone1.ProximityRange = Distance(57, "meters")
zone1.AllowSetPositionTo = false
zone1.Active = false
zone1.Points = {
  ZonePoint(44.6816961022658, -1.01545701658109, 0),
  ZonePoint(44.6816848998909, -1.01557459101554, 0),
  ZonePoint(44.6816350102738, -1.01563657081547, 0),
  ZonePoint(44.6815568497872, -1.0156447568267, 0),
  ZonePoint(44.6814836781723, -1.01554418583063, 0),
  ZonePoint(44.6815028025805, -1.01544010654394, 0),
  ZonePoint(44.6815593442724, -1.01540853192898, 0),
  ZonePoint(44.6815693222123, -1.01531965523478, 0),
  ZonePoint(44.6816300213097, -1.01528106403858, 0),
  ZonePoint(44.6816973722884, -1.01534421326866, 0)
}
zone1.OriginalPoint = ZonePoint(44.6816015403053, -1.01546506920844, 0)
zone1.DistanceRangeUOM = "Feet"
zone1.ProximityRangeUOM = "Meters"
zone1.OutOfRangeName = ""
zone1.InRangeName = ""
itemciseau = Wherigo.ZItem(_6SJ)
itemciseau.Id = "99965103-239f-4194-aa2d-8b8331fd5fbd"
itemciseau.Name = _m9REO("\a[3wi|")
itemciseau.Description = ""
itemciseau.Visible = true
itemciseau.Commands = {}
itemciseau.ObjectLocation = Wherigo.INVALID_ZONEPOINT
itemciseau.Locked = false
itemciseau.Opened = false
itempapier = Wherigo.ZItem(_6SJ)
itempapier.Id = "83467973-d716-4b82-a492-89ff63d23d09"
itempapier.Name = _m9REO("diT[w\v")
itempapier.Description = ""
itempapier.Visible = true
itempapier.Commands = {}
itempapier.ObjectLocation = Wherigo.INVALID_ZONEPOINT
itempapier.Locked = false
itempapier.Opened = false
itempierre = Wherigo.ZItem(_6SJ)
itempierre.Id = "e3763cc3-0965-4b79-b7fa-cac6cf7e0b33"
itempierre.Name = _m9REO("d[w\v\vw")
itempierre.Description = ""
itempierre.Visible = true
itempierre.Commands = {}
itempierre.ObjectLocation = Wherigo.INVALID_ZONEPOINT
itempierre.Locked = false
itempierre.Opened = false
_Jum = Wherigo.ZItem(_6SJ)
_Jum.Id = "3b84358d-745c-439c-9b35-648faa27244c"
_Jum.Name = _m9REO("\021E\001T+wL[E\023*\021E?w")
_Jum.Description = ""
_Jum.Visible = true
_Jum.Commands = {}
_Jum.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_Jum.Locked = false
_Jum.Opened = false
_Yh8 = 1
_74Cyg = 2
_RG3Si = 3
_rcjab = 0
_2xw = 0
_KUi = _m9REO(":[\023HE[Lw")
_hNR3 = _m9REO("?|\001\001.")
_3qw = _m9REO("[Lw\001\021[3wi|")
_ElTV = _m9REO("?|\001\001.")
_9bBD = _m9REO("u\aQk++")
_PrJ = _m9REO("?|\001\001.")
_6SJ.ZVariables = {
  _Yh8 = 1,
  _74Cyg = 2,
  _RG3Si = 3,
  _rcjab = 0,
  _2xw = 0,
  _KUi = _m9REO(":[\023HE[Lw"),
  _hNR3 = _m9REO("?|\001\001."),
  _3qw = _m9REO("[Lw\001\021[3wi|"),
  _ElTV = _m9REO("?|\001\001."),
  _9bBD = _m9REO("u\aQk++"),
  _PrJ = _m9REO("?|\001\001.")
}
_CUGll = Wherigo.ZInput(_6SJ)
_CUGll.Id = "17c5ebbd-a2b9-4c3e-a1f7-8320b862a9b8"
_CUGll.Name = _m9REO("i?9w\v3i[\vw*T[w\v\vw")
_CUGll.Description = ""
_CUGll.Visible = true
_CUGll.Choices = {"OUI", "NON"}
_CUGll.InputType = "MultipleChoice"
_CUGll.Text = _m9REO("ZE|+wP*9E|3*9E|3*\001w3|\vw\v*i*+|[*X")
_RtTq = Wherigo.ZInput(_6SJ)
_RtTq.Id = "4929ee20-ef08-4502-8928-86ebf92b321e"
_RtTq.Name = _m9REO("i?9w\v3i[\vw*\021[3wi|")
_RtTq.Description = ""
_RtTq.Visible = true
_RtTq.Choices = {"OUI", "NON"}
_RtTq.InputType = "MultipleChoice"
_RtTq.Text = _m9REO("ZE|+wP*9E|3*9E|3*\001w3|\vw\v*i*+|[*X")
_UdZa = Wherigo.ZInput(_6SJ)
_UdZa.Id = "bfb2fa4c-9dd3-4208-a947-341eedce3731"
_UdZa.Name = _m9REO("i?9w\v3i[\vw*TiT[w\v")
_UdZa.Description = ""
_UdZa.Visible = true
_UdZa.Choices = {"OUI", "NON"}
_UdZa.InputType = "MultipleChoice"
_UdZa.Text = _m9REO("ZE|+wP*9E|3*9E|3*\001w3|\vw\v*i*+|[*X")

function _6SJ:OnStart()
  _Urwigo.MessageBox({
    Text = Player.Name .. _m9REO("*O*H[w\0239w\023|w*i|*h\023H3T~d[w\v\vw*diT[w\v*\a[3wi|GzSW\026\029+*9E|3*:i|L*\vw\001TE\vLw\v*\n*\001i\023\021$w3*TE|\v*+i*\021i\021$wG"),
    Media = _IVUHL,
    Callback = function(action)
      if action ~= nil then
        zone1.Active = true
        zone1.Visible = true
        zone2.Active = true
        zone2.Visible = true
        zone3.Active = true
        zone3.Visible = true
      end
    end
  })
end

function _6SJ:OnRestore()
end

function finboite:OnEnter()
  _KUi = _m9REO(":[\023HE[Lw")
  zone1.Active = false
  zone1.Visible = false
  zone2.Active = false
  zone2.Visible = false
  zone3.Active = false
  zone3.Visible = false
  _Jum.Description = _m9REO("\021E\001T+wL[E\023*\021E?w") .. string.sub(Player.CompletionCode, 1, 15)
  _Jum:MoveTo(Player)
  _Urwigo.MessageBox({
    Text = _m9REO("\004i*HE[Lw*3w*L\vE|9w*w\023*qzSW\026\006*\028\028?\0281G\025g1)zSW\026\127*1M?11G\025\020I)zSW\026"),
    Media = _tlay,
    Callback = function(action)
      if action ~= nil then
        _6SJ:RequestSync()
      end
    end
  })
end

function zone3:OnEnter()
  _KUi = _m9REO("PE\023wI")
  _Urwigo.MessageBox({
    Text = _m9REO("ZE|3*wLw3*?i\0233*+i*PE\023w*?|*\021E|Lwi|O*9E|3*`i`\023w\vwP*i9w\021*+w*\021i[++E|*wL*Tw\v?\vwP*i9w\021*+w*\021$[::E\023*O*\r|w*+w3*?w3*3E[w\023L*\015wLLw3GGG"),
    Media = _z2Mh,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_RtTq)
        end)
      end
    end
  })
end

function zone2:OnEnter()
  _KUi = _m9REO("PE\023w\n")
  _Urwigo.MessageBox({
    Text = _m9REO("ZE|3*wLw3*?i\0233*+i*PE\023w*?|*\021$[::E\023O*9E|3*`i`\023w\vwP*i9w\021*+w*\021E|Lwi|*wL*Tw\v?\vwP*i9w\021*+w*\021i[++E|O*\r|w*+w3*?w3*3E[w\023L*\015wLLw3GGG"),
    Media = _i_eb,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_UdZa)
        end)
      end
    end
  })
end

function zone1:OnEnter()
  _KUi = _m9REO("PE\023wM")
  _Urwigo.MessageBox({
    Text = _m9REO("ZE|3*wLw3*?i\0233*+i*PE\023w*?|*\021i[++E|*O*9E|3*`i`\023w\vwP*i9w\021*+w*\021$[::E\023*wL*Tw\v?\vwP*i9w\021*+w*\021E|Lwi|O*\r|w*+w3*?w3*3E[w\023L*\015wLLw3GGG"),
    Media = _BFG,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_CUGll)
        end)
      end
    end
  })
end

function _CUGll:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 10539 then
    _rcjab = math.random(1, 4)
    if _rcjab == 1 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021i[++E|*O*\021)w3L*\001iL\021$*\023|+GzSW\026di3*?w*TE[\023LG"),
        Media = _BFG,
        Callback = function(action)
          if action ~= nil then
            zone1.Active = false
            zone2.Active = true
            zone3.Active = true
          end
        end
      })
    elseif _rcjab >= 3 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021$[::E\023O*9E|3*w\0239w+ETTwP*+w*\021i[++E|O*\021)w3L*`i`\023w*GzSW\026M*TE[\023LGzSW\026"),
        Media = _94060,
        Callback = function(action)
          if action ~= nil then
            _2xw = _2xw + 1
            if _2xw == 2 then
              _Urwigo.MessageBox({
                Text = _m9REO("\a)w3L*`i`\023w*O*+i*\021i\021$w*w3L*TE|\v*9E|3*GGG"),
                Callback = function(action)
                  if action ~= nil then
                    Wherigo.ShowScreen(Wherigo.DETAILSCREEN, finboite)
                    finboite.Active = true
                    finboite.Visible = true
                    zone1.Active = false
                    zone1.Visible = false
                    zone2.Active = false
                    zone2.Visible = false
                    zone3.Active = false
                    zone3.Visible = false
                  end
                end
              })
            else
              zone3.Active = true
              zone2.Active = true
              zone1.Active = false
            end
          end
        end
      })
    elseif _rcjab == 2 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021E|Lwi|*\r|w*+w*\021i[++E|*\021i33wO*\021)w3L*Tw\v?|GzSW\026di3*?w*TE[\023LG"),
        Media = _kCx,
        Callback = function(action)
          if action ~= nil then
            zone1.Active = false
            zone2.Active = true
            zone3.Active = true
          end
        end
      })
    end
  elseif _Urwigo.Hash(string.lower(input)) == 27264 then
    zone1.Active = false
    zone2.Active = true
    zone2.Visible = true
    zone3.Active = true
    zone3.Visible = true
  end
end

function _RtTq:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 10539 then
    _rcjab = math.random(1, 4)
    if _rcjab == 1 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021E|Lwi|*O*\021)w3L*\001iL\021$*\023|+GzSW\026di3*?w*TE[\023LG"),
        Media = _z2Mh,
        Callback = function(action)
          if action ~= nil then
            zone1.Active = true
            zone3.Active = false
            zone2.Active = true
          end
        end
      })
    elseif _rcjab >= 3 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021i[++E|*\r|[*\021i33w*+w*\021E|Lwi|O*\021)w3L*`i`\023w*GzSW\026M*TE[\023LGzSW\026"),
        Media = _kCx,
        Callback = function(action)
          if action ~= nil then
            _2xw = _2xw + 1
            if _2xw == 2 then
              _Urwigo.MessageBox({
                Text = _m9REO("\a)w3L*`i`\023w*O*+i*\021i\021$w*w3L*TE|\v*9E|3*GGG"),
                Callback = function(action)
                  if action ~= nil then
                    Wherigo.ShowScreen(Wherigo.DETAILSCREEN, finboite)
                    finboite.Active = true
                    finboite.Visible = true
                    zone1.Active = false
                    zone1.Visible = false
                    zone2.Active = false
                    zone2.Visible = false
                    zone3.Active = false
                    zone3.Visible = false
                  end
                end
              })
            else
              zone2.Active = true
              zone3.Active = false
              zone1.Active = true
            end
          end
        end
      })
    elseif _rcjab == 2 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021$[::E\023*\r|w*+w*\021E|Lwi|*\021E|Tw*O*\021)w3L*Tw\v?|GzSW\026di3*?w*TE[\023LG"),
        Media = _h2oP,
        Callback = function(action)
          if action ~= nil then
            zone1.Active = true
            zone3.Active = false
            zone2.Active = true
          end
        end
      })
    end
  elseif _Urwigo.Hash(string.lower(input)) == 27264 then
    zone1.Active = true
    zone1.Visible = true
    zone2.Active = true
    zone2.Visible = true
    zone3.Active = false
  end
end

function _UdZa:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 10539 then
    _rcjab = math.random(1, 4)
    if _rcjab == 1 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021$[::E\023*O*\021)w3L*\001iL\021$*\023|+GzSW\026di3*?w*TE[\023LG"),
        Media = _i_eb,
        Callback = function(action)
          if action ~= nil then
            zone2.Active = false
            zone1.Active = true
            zone3.Active = true
          end
        end
      })
    elseif _rcjab >= 3 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021E|Lwi|*\r|[*\021E|Tw*+w*\021$[::E\023O*\021)w3L*`i`\023w*GzSW\026M*TE[\023LG"),
        Media = _h2oP,
        Callback = function(action)
          if action ~= nil then
            _2xw = _2xw + 1
            if _2xw == 2 then
              _Urwigo.MessageBox({
                Text = _m9REO("\a)w3L*`i`\023w*O*+i*\021i\021$w*w3L*TE|\v*9E|3*GGG"),
                Callback = function(action)
                  if action ~= nil then
                    Wherigo.ShowScreen(Wherigo.DETAILSCREEN, finboite)
                    finboite.Active = true
                    finboite.Visible = true
                    zone1.Active = false
                    zone1.Visible = false
                    zone2.Active = false
                    zone2.Visible = false
                    zone3.Active = false
                    zone3.Visible = false
                  end
                end
              })
            else
              zone3.Active = true
              zone1.Active = true
              zone2.Active = false
            end
          end
        end
      })
    elseif _rcjab == 2 then
      _Urwigo.MessageBox({
        Text = _m9REO("\004w*3E\vL*i*\021$E[3[*+w*\021i[++E|O*+w*\021$[::E\023*w\0239w+ETTw*+w*\021i[++E|O*\021)w3L*Tw\v?|*GzSW\026di3*?w*TE[\023LG"),
        Media = _94060,
        Callback = function(action)
          if action ~= nil then
            zone2.Active = false
            zone1.Active = true
            zone3.Active = true
          end
        end
      })
    end
  elseif _Urwigo.Hash(string.lower(input)) == 27264 then
    zone1.Active = true
    zone1.Visible = true
    zone2.Active = false
    zone3.Active = true
    zone3.Visible = true
  end
end

return _6SJ
