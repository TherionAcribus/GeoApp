require("Wherigo")
ZonePoint = Wherigo.ZonePoint
Distance = Wherigo.Distance
Player = Wherigo.Player

function _NsWY(str)
  local res = ""
  local dtable = "~;0J}l|$m@\vh6i)St\022CI\fb\"\000/\027^#d`RH\023\a2kxfc\030OBNwEa1e \002\024\016*{]L5(\r\003AWGvVFp\n?rQ\001K87uX\0143\031>\005\015o\006\019n\t\026+z%\b\0189\021\017\004PT=\028,<jU[-&My\020_:\029s\\4YgZ.q!\025D'"
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
_fiw = Wherigo.ZCartridge()
_VvfM8 = Wherigo.ZMedia(_fiw)
_VvfM8.Id = "bfb925bb-9883-4806-a966-181b3c5c7172"
_VvfM8.Name = _NsWY("\016.\006[\022LFx1\016$o\006\014W0")
_VvfM8.Description = ""
_VvfM8.AltText = ""
_VvfM8.Resources = {
  {
    Type = "jpg",
    Filename = "sbg1.jpg",
    Directives = {}
  }
}
_Hgml = Wherigo.ZMedia(_fiw)
_Hgml.Id = "ce701a63-e002-48d7-ab68-9e808383aa34"
_Hgml.Name = _NsWY("\016.\006[\022LFx1\t\014\0171\016.\006[.'\f")
_Hgml.Description = ""
_Hgml.AltText = ""
_Hgml.Resources = {
  {
    Type = "jpg",
    Filename = "sbg2.jpg",
    Directives = {}
  }
}
_GnU = Wherigo.ZMedia(_fiw)
_GnU.Id = "76063a3f-5cfc-4edf-8c7f-67ee8f17acb8"
_GnU.Name = _NsWY("nT[.F\017t1?0\022LF\017t\f.Lt")
_GnU.Description = ""
_GnU.AltText = ""
_GnU.Resources = {
  {
    Type = "jpg",
    Filename = "mozart.jpg",
    Directives = {}
  }
}
_d2gCv = Wherigo.ZMedia(_fiw)
_d2gCv.Id = "9b772973-74ad-4018-97e0-e7a76a825ab0"
_d2gCv.Name = _NsWY(">T\006&0F\0061\031.\f\t0W")
_d2gCv.Description = ""
_d2gCv.AltText = ""
_d2gCv.Resources = {
  {
    Type = "jpg",
    Filename = "wolferlrahmen.jpg",
    Directives = {}
  }
}
_1log = Wherigo.ZMedia(_fiw)
_1log.Id = "0f22448d-1ec5-4b29-83c0-51c7cd82d9d5"
_1log.Name = _NsWY("*.$0Fo")
_1log.Description = ""
_1log.AltText = ""
_1log.Resources = {
  {
    Type = "jpg",
    Filename = "baeckerei.jpg",
    Directives = {}
  }
}
_5Z66 = Wherigo.ZMedia(_fiw)
_5Z66.Id = "b6bbe9e2-01c2-484f-88ac-8ec615cc76e6"
_5Z66.Name = _NsWY(">T\006&0F\0061FLW")
_5Z66.Description = ""
_5Z66.AltText = ""
_5Z66.Resources = {
  {
    Type = "jpg",
    Filename = "wolferlrun.jpg",
    Directives = {}
  }
}
_lh_u = Wherigo.ZMedia(_fiw)
_lh_u.Id = "108b1e66-1a9d-46cc-a53f-4368fe7c33ff"
_lh_u.Name = _NsWY("*L0Fx0FtC\014\017.\0061t\t.\006\006")
_lh_u.Description = ""
_lh_u.AltText = ""
_lh_u.Resources = {
  {
    Type = "jpg",
    Filename = "spitalsmall.jpg",
    Directives = {}
  }
}
_py3vw = Wherigo.ZMedia(_fiw)
_py3vw.Id = "f872c3bb-2bdd-4add-a709-15a73894fb4c"
_py3vw.Name = _NsWY("*L0Fx0FtC\014\017.\006")
_py3vw.Description = ""
_py3vw.AltText = ""
_py3vw.Resources = {
  {
    Type = "jpg",
    Filename = "spitalbig.jpg",
    Directives = {}
  }
}
_dzu = Wherigo.ZMedia(_fiw)
_dzu.Id = "0a63e3aa-d186-4d02-8d0e-7619516fd699"
_dzu.Name = _NsWY(">T\006&0F\006CTF\017F.\014\017")
_dzu.Description = ""
_dzu.AltText = ""
_dzu.Resources = {
  {
    Type = "jpg",
    Filename = "wolferlportraet.jpg",
    Directives = {}
  }
}
_eb1 = Wherigo.ZMedia(_fiw)
_eb1.Id = "b776b55f-c09b-42de-a4a0-360eeffd7874"
_eb1.Name = _NsWY(">T\006&0F\0061\006\014\017\017\0060")
_eb1.Description = ""
_eb1.AltText = ""
_eb1.Resources = {
  {
    Type = "jpg",
    Filename = "walittle.jpg",
    Directives = {}
  }
}
_pc6 = Wherigo.ZMedia(_fiw)
_pc6.Id = "70feed52-d29d-44ff-aeaa-2e7b39b536e5"
_pc6.Name = _NsWY(",T\006&0F\00610FWt\017")
_pc6.Description = ""
_pc6.AltText = ""
_pc6.Resources = {
  {
    Type = "jpg",
    Filename = "wolferlernst.jpg",
    Directives = {}
  }
}
_s7k3 = Wherigo.ZMedia(_fiw)
_s7k3.Id = "a20680eb-0a75-42bc-9ff6-e7dc492e10a9"
_s7k3.Name = _NsWY(">T\006&0F\0061+T\0170W")
_s7k3.Description = ""
_s7k3.AltText = ""
_s7k3.Resources = {
  {
    Type = "jpg",
    Filename = "wolferlnoten.jpg",
    Directives = {}
  }
}
_ICSl = Wherigo.ZMedia(_fiw)
_ICSl.Id = "f2a2f122-b335-4278-b8e8-2162fb7b950f"
_ICSl.Name = _NsWY("B\014Wx0F")
_ICSl.Description = ""
_ICSl.AltText = ""
_ICSl.Resources = {
  {
    Type = "jpg",
    Filename = "fingersmall.jpg",
    Directives = {}
  }
}
_U6y = Wherigo.ZMedia(_fiw)
_U6y.Id = "5729eb28-bad8-4326-86d6-42e3d5aa32e4"
_U6y.Name = _NsWY("n.F\014.")
_U6y.Description = ""
_U6y.AltText = ""
_U6y.Resources = {
  {
    Type = "jpg",
    Filename = "maria.jpg",
    Directives = {}
  }
}
_ArY = Wherigo.ZMedia(_fiw)
_ArY.Id = "6ecb6886-e4b2-44a1-919f-71ed5279d276"
_ArY.Name = _NsWY("y\014F$0\006,\014F\017")
_ArY.Description = ""
_ArY.AltText = ""
_ArY.Resources = {
  {
    Type = "jpg",
    Filename = "zirkelwirt.jpg",
    Directives = {}
  }
}
_og0x = Wherigo.ZMedia(_fiw)
_og0x.Id = "5141d4fb-97e1-4c5c-b77f-ed873d1f2c0b"
_og0x.Name = _NsWY("=\006\0170F1n.F$\017")
_og0x.Description = ""
_og0x.AltText = ""
_og0x.Resources = {
  {
    Type = "jpg",
    Filename = "tinyhouse.jpg",
    Directives = {}
  }
}
_W50v3 = Wherigo.ZMedia(_fiw)
_W50v3.Id = "c7b379c9-ec8d-453c-8844-4226c11c4ab1"
_W50v3.Name = _NsWY(">T\006&0F\0061I\006.@\0140F")
_W50v3.Description = ""
_W50v3.AltText = ""
_W50v3.Resources = {
  {
    Type = "jpg",
    Filename = "amadeusklavier.jpg",
    Directives = {}
  }
}
_QQzrF = Wherigo.ZMedia(_fiw)
_QQzrF.Id = "972f4c96-0511-48f0-8253-455e3667f545"
_QQzrF.Name = _NsWY(",\014\006\029\t.W")
_QQzrF.Description = ""
_QQzrF.AltText = ""
_QQzrF.Resources = {
  {
    Type = "jpg",
    Filename = "wildmansmall.jpg",
    Directives = {}
  }
}
_yHy4u = Wherigo.ZMedia(_fiw)
_yHy4u.Id = "695697a0-fefc-46e9-bed3-aad790a958eb"
_yHy4u.Name = _NsWY("\f0FF0Wx.tt0")
_yHy4u.Description = ""
_yHy4u.AltText = ""
_yHy4u.Resources = {
  {
    Type = "JPG",
    Filename = "herrengassesmall.JPG",
    Directives = {}
  }
}
_PbWPA = Wherigo.ZMedia(_fiw)
_PbWPA.Id = "32606b85-0f67-401c-a2aa-c0d8d5348437"
_PbWPA.Name = _NsWY("~T\tC\006.\017[")
_PbWPA.Description = ""
_PbWPA.AltText = ""
_PbWPA.Resources = {
  {
    Type = "JPG",
    Filename = "domplatz.JPG",
    Directives = {}
  }
}
_1MIBX = Wherigo.ZMedia(_fiw)
_1MIBX.Id = "caa99268-986a-46d0-bcab-64b2f953c3b6"
_1MIBX.Name = _NsWY("jW\014")
_1MIBX.Description = ""
_1MIBX.AltText = ""
_1MIBX.Resources = {
  {
    Type = "jpg",
    Filename = "uninew.jpg",
    Directives = {}
  }
}
_YN6jy = Wherigo.ZMedia(_fiw)
_YN6jy.Id = "1ebde7a6-286e-4373-8e7a-7eab938a634c"
_YN6jy.Name = _NsWY(" T&t\017.\006\006x.tt0")
_YN6jy.Description = ""
_YN6jy.AltText = ""
_YN6jy.Resources = {
  {
    Type = "jpg",
    Filename = "hofstallgasse.jpg",
    Directives = {}
  }
}
_GnLTF = Wherigo.ZMedia(_fiw)
_GnLTF.Id = "63a5273c-a71d-48af-b6eb-5d3395af7f06"
_GnLTF.Name = _NsWY(">T\006&0F\0061B\006ox0\006")
_GnLTF.Description = ""
_GnLTF.AltText = ""
_GnLTF.Resources = {
  {
    Type = "jpg",
    Filename = "wolferlflygel.jpg",
    Directives = {}
  }
}
_vO4H = Wherigo.ZMedia(_fiw)
_vO4H.Id = "a7a9ddca-f971-4d57-979c-f1b29d71fd53"
_vO4H.Name = _NsWY("\t.C\f0FF0Wx.tt0")
_vO4H.Description = ""
_vO4H.AltText = ""
_vO4H.Resources = {
  {
    Type = "jpg",
    Filename = "mapherrengasse.jpg",
    Directives = {}
  }
}
_VAJ = Wherigo.ZMedia(_fiw)
_VAJ.Id = "38b2a6af-37fe-4abf-8d58-ae357678a1ec"
_VAJ.Name = _NsWY("\t.C$FT\017.'\fx.tt0")
_VAJ.Description = ""
_VAJ.AltText = ""
_VAJ.Resources = {
  {
    Type = "jpg",
    Filename = "mapkrotachgasse.jpg",
    Directives = {}
  }
}
_ouvbh = Wherigo.ZMedia(_fiw)
_ouvbh.Id = "c8ab8be6-513c-497e-a958-5ad1e1cd2926"
_ouvbh.Name = _NsWY("\t.C.\006\0170F\t.F$\017")
_ouvbh.Description = ""
_ouvbh.AltText = ""
_ouvbh.Resources = {
  {
    Type = "jpg",
    Filename = "mapaltermarkt.jpg",
    Directives = {}
  }
}
_pFqA = Wherigo.ZMedia(_fiw)
_pFqA.Id = "e355cb45-9613-488e-b33f-39bbae6e19eb"
_pFqA.Name = _NsWY("\t.Cx0\022LF\017t\f.Lt")
_pFqA.Description = ""
_pFqA.AltText = ""
_pFqA.Resources = {
  {
    Type = "jpg",
    Filename = "geburtshaus.jpg",
    Directives = {}
  }
}
_5LD = Wherigo.ZMedia(_fiw)
_5LD.Id = "b9269065-777a-4b4b-8e48-3bd970698e39"
_5LD.Name = _NsWY("\t.CtC\014\017.\006")
_5LD.Description = ""
_5LD.AltText = ""
_5LD.Resources = {
  {
    Type = "jpg",
    Filename = "mapspital.jpg",
    Directives = {}
  }
}
_XpiBx = Wherigo.ZMedia(_fiw)
_XpiBx.Id = "e3f78310-f048-4134-a92a-e99bbebf782c"
_XpiBx.Name = _NsWY("\022\014$0tCT\014\0060F")
_XpiBx.Description = ""
_XpiBx.AltText = ""
_XpiBx.Resources = {
  {
    Type = "jpg",
    Filename = "radlspoiler.jpg",
    Directives = {}
  }
}
_s7H = Wherigo.ZMedia(_fiw)
_s7H.Id = "75c8b592-1af1-4155-9ebd-c81522767c39"
_s7H.Name = _NsWY("&\014W.\006tCT\014\0060F")
_s7H.Description = ""
_s7H.AltText = ""
_s7H.Resources = {
  {
    Type = "jpg",
    Filename = "finalspoiler.jpg",
    Directives = {}
  }
}
_fiw.Id = "b262e667-a798-4e86-829a-2b28fa84426f"
_fiw.Name = "MOZARTS SALZBURG"
_fiw.Description = "A Wherigo-Cache, created by mobilekirk, lsoeve, Antheringer and M.Yoda (c) 2012"
_fiw.Visible = true
_fiw.Activity = "Geocache"
_fiw.StartingLocationDescription = "The Starting Location can be reached with car (see the parking coordinates at www.geocaching.com) and also perfect per bus, because there is a busstop."
_fiw.StartingLocation = Wherigo.INVALID_ZONEPOINT
_fiw.Version = "2.1"
_fiw.Company = ""
_fiw.Author = "mobilekirk, lsoeve, Antheringer, M.Yoda"
_fiw.BuilderVersion = "URWIGO 1.21.5528.18461"
_fiw.CreateDate = "05/25/2012 16:34:53"
_fiw.PublishDate = "1/1/0001 12:00:00 AM"
_fiw.UpdateDate = "06/07/2015 00:20:29"
_fiw.LastPlayedDate = "1/1/0001 12:00:00 AM"
_fiw.TargetDevice = "PocketPC"
_fiw.TargetDeviceVersion = "0"
_fiw.StateId = "1"
_fiw.CountryId = "2"
_fiw.Complete = false
_fiw.UseLogging = true
_fiw.Media = _VvfM8
_fiw.Icon = _Hgml
_tX2 = Wherigo.Zone(_fiw)
_tX2.Id = "3d84f99d-8dc7-4f69-a64a-2a661c7eec03"
_tX2.Name = _NsWY(">\014\006\0291n.W")
_tX2.Description = ""
_tX2.Visible = true
_tX2.Media = _QQzrF
_tX2.Commands = {}
_tX2.DistanceRange = Distance(-1, "feet")
_tX2.ShowObjects = "OnEnter"
_tX2.ProximityRange = Distance(60, "meters")
_tX2.AllowSetPositionTo = false
_tX2.Active = false
_tX2.Points = {
  ZonePoint(47.7985161548886, 13.0425700707967, 0),
  ZonePoint(47.7983323764227, 13.0422696633871, 0),
  ZonePoint(47.7984521928492, 13.0420832498605, 0),
  ZonePoint(47.7986404752469, 13.0423729284341, 0)
}
_tX2.OriginalPoint = ZonePoint(47.7984852998518, 13.0423239781196, 0)
_tX2.DistanceRangeUOM = "Feet"
_tX2.ProximityRangeUOM = "Meters"
_tX2.OutOfRangeName = ""
_tX2.InRangeName = ""
_KYa = Wherigo.Zone(_fiw)
_KYa.Id = "24d4fa47-c099-4ef9-9ec4-f4408a7fb45a"
_KYa.Name = _NsWY("BF.W[\014t$.W0F")
_KYa.Description = ""
_KYa.Visible = true
_KYa.Media = _ICSl
_KYa.Commands = {}
_KYa.DistanceRange = Distance(-1, "feet")
_KYa.ShowObjects = "OnEnter"
_KYa.ProximityRange = Distance(5, "meters")
_KYa.AllowSetPositionTo = false
_KYa.Active = false
_KYa.Points = {
  ZonePoint(47.7983203293769, 13.0435866280134, 0),
  ZonePoint(47.7982975733322, 13.0438910587367, 0),
  ZonePoint(47.7981185765577, 13.0438682599599, 0),
  ZonePoint(47.7981619733525, 13.0435289605197, 0)
}
_KYa.OriginalPoint = ZonePoint(47.7982246131548, 13.0437187268074, 0)
_KYa.DistanceRangeUOM = "Feet"
_KYa.ProximityRangeUOM = "Meters"
_KYa.OutOfRangeName = ""
_KYa.InRangeName = ""
_6Ks = Wherigo.Zone(_fiw)
_6Ks.Id = "b8b8bf5d-aa63-4d1f-948e-9d4f79e45101"
_6Ks.Name = _NsWY("~T\tC\006.\017[")
_6Ks.Description = ""
_6Ks.Visible = true
_6Ks.Media = _PbWPA
_6Ks.Commands = {}
_6Ks.DistanceRange = Distance(-1, "feet")
_6Ks.ShowObjects = "OnEnter"
_6Ks.ProximityRange = Distance(10, "meters")
_6Ks.AllowSetPositionTo = false
_6Ks.Active = false
_6Ks.Points = {
  ZonePoint(47.7981159955298, 13.0446970625457, 0),
  ZonePoint(47.7980612119114, 13.0449585779246, 0),
  ZonePoint(47.7978729274145, 13.0449344380435, 0),
  ZonePoint(47.7978397007597, 13.04467158156, 0)
}
_6Ks.OriginalPoint = ZonePoint(47.7979724589039, 13.0448154150184, 0)
_6Ks.DistanceRangeUOM = "Feet"
_6Ks.ProximityRangeUOM = "Meters"
_6Ks.OutOfRangeName = ""
_6Ks.InRangeName = ""
_hrDq = Wherigo.Zone(_fiw)
_hrDq.Id = "7b7f3cc5-4659-4159-aa00-d1ab10f6accb"
_hrDq.Name = _NsWY(" 0FF0Wx.tt0")
_hrDq.Description = ""
_hrDq.Visible = true
_hrDq.Media = _yHy4u
_hrDq.Commands = {}
_hrDq.DistanceRange = Distance(-1, "feet")
_hrDq.ShowObjects = "OnEnter"
_hrDq.ProximityRange = Distance(60, "meters")
_hrDq.AllowSetPositionTo = false
_hrDq.Active = false
_hrDq.Points = {
  ZonePoint(47.7966125748635, 13.048540668064, 0),
  ZonePoint(47.7963963569147, 13.0485326214369, 0),
  ZonePoint(47.7964062669237, 13.0486720963057, 0),
  ZonePoint(47.7966152775822, 13.0486989183959, 0)
}
_hrDq.OriginalPoint = ZonePoint(47.796507619071, 13.0486110760506, 0)
_hrDq.DistanceRangeUOM = "Feet"
_hrDq.ProximityRangeUOM = "Meters"
_hrDq.OutOfRangeName = ""
_hrDq.InRangeName = ""
_utpTV = Wherigo.Zone(_fiw)
_utpTV.Id = "bc80c3e9-0c66-4821-9497-802f9254cd5c"
_utpTV.Name = _NsWY("cL\022")
_utpTV.Description = ""
_utpTV.Visible = true
_utpTV.Media = _ArY
_utpTV.Commands = {}
_utpTV.DistanceRange = Distance(-1, "feet")
_utpTV.ShowObjects = "OnEnter"
_utpTV.ProximityRange = Distance(60, "meters")
_utpTV.AllowSetPositionTo = false
_utpTV.Active = false
_utpTV.Points = {
  ZonePoint(47.7980571579467, 13.0493795289334, 0),
  ZonePoint(47.7982274242141, 13.0495860590275, 0),
  ZonePoint(47.7982886838987, 13.0493822111424, 0),
  ZonePoint(47.798172470612, 13.0492185963925, 0)
}
_utpTV.OriginalPoint = ZonePoint(47.7981864341679, 13.0493915988739, 0)
_utpTV.DistanceRangeUOM = "Feet"
_utpTV.ProximityRangeUOM = "Meters"
_utpTV.OutOfRangeName = ""
_utpTV.InRangeName = ""
_aVX = Wherigo.Zone(_fiw)
_aVX.Id = "3baf971a-256e-4d36-8dd1-eff93c93e2e0"
_aVX.Name = _NsWY("=\006\0170F1n.F$\017")
_aVX.Description = ""
_aVX.Visible = true
_aVX.Media = _og0x
_aVX.Commands = {}
_aVX.DistanceRange = Distance(-1, "feet")
_aVX.ShowObjects = "OnEnter"
_aVX.ProximityRange = Distance(10, "meters")
_aVX.AllowSetPositionTo = false
_aVX.Active = false
_aVX.Points = {
  ZonePoint(47.7994309836101, 13.0449257208641, 0),
  ZonePoint(47.7994093630285, 13.0451242043312, 0),
  ZonePoint(47.7992805402104, 13.0450826300914, 0),
  ZonePoint(47.7993688244139, 13.0448948754604, 0)
}
_aVX.OriginalPoint = ZonePoint(47.7993724278157, 13.0450068576868, 0)
_aVX.DistanceRangeUOM = "Feet"
_aVX.ProximityRangeUOM = "Meters"
_aVX.OutOfRangeName = ""
_aVX.InRangeName = ""
_0mX7 = Wherigo.Zone(_fiw)
_0mX7.Id = "7204e32d-62e8-48bb-9850-b22495ddcbd6"
_0mX7.Name = _NsWY("nT[.F\017t1?0\022LF\017t\f.Lt")
_0mX7.Description = ""
_0mX7.Visible = true
_0mX7.Media = _GnU
_0mX7.Commands = {}
_0mX7.DistanceRange = Distance(-1, "feet")
_0mX7.ShowObjects = "OnEnter"
_0mX7.ProximityRange = Distance(10, "meters")
_0mX7.AllowSetPositionTo = false
_0mX7.Active = false
_0mX7.Points = {
  ZonePoint(47.8002444514527, 13.0433485819633, 0),
  ZonePoint(47.8002399472362, 13.0436583771045, 0),
  ZonePoint(47.7999678918323, 13.0436154617603, 0),
  ZonePoint(47.7999940164197, 13.0433271242912, 0)
}
_0mX7.OriginalPoint = ZonePoint(47.8001115767352, 13.0434873862798, 0)
_0mX7.DistanceRangeUOM = "Feet"
_0mX7.ProximityRangeUOM = "Meters"
_0mX7.OutOfRangeName = ""
_0mX7.InRangeName = ""
_Z3YS = Wherigo.Zone(_fiw)
_Z3YS.Id = "80760185-906f-416d-af04-a20b3fd4d558"
_Z3YS.Name = _NsWY("*.$0Fo")
_Z3YS.Description = ""
_Z3YS.Visible = true
_Z3YS.Media = _1log
_Z3YS.Commands = {}
_Z3YS.DistanceRange = Distance(-1, "feet")
_Z3YS.ShowObjects = "OnEnter"
_Z3YS.ProximityRange = Distance(5, "meters")
_Z3YS.AllowSetPositionTo = false
_Z3YS.Active = false
_Z3YS.Points = {
  ZonePoint(47.8004412853344, 13.039111362272, 0),
  ZonePoint(47.8003223743371, 13.0392226739461, 0),
  ZonePoint(47.800548034748, 13.0396162881191, 0),
  ZonePoint(47.8006514058065, 13.039489218467, 0)
}
_Z3YS.OriginalPoint = ZonePoint(47.8004907750565, 13.039359885701, 0)
_Z3YS.DistanceRangeUOM = "Feet"
_Z3YS.ProximityRangeUOM = "Meters"
_Z3YS.OutOfRangeName = ""
_Z3YS.InRangeName = ""
_mRNo = Wherigo.Zone(_fiw)
_mRNo.Id = "874fb788-93ac-4853-9ec0-e01b89fdbfec"
_mRNo.Name = _NsWY("*L0Fx0FtC\014\017.\006")
_mRNo.Description = ""
_mRNo.Visible = true
_mRNo.Media = _py3vw
_mRNo.Commands = {}
_mRNo.DistanceRange = Distance(-1, "feet")
_mRNo.ShowObjects = "OnEnter"
_mRNo.ProximityRange = Distance(10, "meters")
_mRNo.AllowSetPositionTo = false
_mRNo.Active = false
_mRNo.Points = {
  ZonePoint(47.7997832176505, 13.0395224108036, 0),
  ZonePoint(47.7998868154431, 13.0399327887828, 0),
  ZonePoint(47.7997012401204, 13.0400400771434, 0),
  ZonePoint(47.7995399872386, 13.0396913899715, 0)
}
_mRNo.OriginalPoint = ZonePoint(47.7997278151132, 13.0397966666753, 0)
_mRNo.DistanceRangeUOM = "Feet"
_mRNo.ProximityRangeUOM = "Meters"
_mRNo.OutOfRangeName = ""
_mRNo.InRangeName = ""
_R5Kn = Wherigo.Zone(_fiw)
_R5Kn.Id = "e3808a91-c734-4bb1-b1c0-2d074a5a3469"
_R5Kn.Name = _NsWY("jW\014")
_R5Kn.Description = ""
_R5Kn.Visible = true
_R5Kn.Media = _YN6jy
_R5Kn.Commands = {}
_R5Kn.DistanceRange = Distance(-1, "feet")
_R5Kn.ShowObjects = "OnEnter"
_R5Kn.ProximityRange = Distance(60, "meters")
_R5Kn.AllowSetPositionTo = false
_R5Kn.Active = false
_R5Kn.Points = {
  ZonePoint(47.7988712943519, 13.0418445332582, 0),
  ZonePoint(47.7986508686089, 13.0415052338178, 0),
  ZonePoint(47.7989178105964, 13.0411505116756, 0),
  ZonePoint(47.7991241945552, 13.0414576246078, 0)
}
_R5Kn.OriginalPoint = ZonePoint(47.7988910420281, 13.0414894758398, 0)
_R5Kn.DistanceRangeUOM = "Feet"
_R5Kn.ProximityRangeUOM = "Meters"
_R5Kn.OutOfRangeName = ""
_R5Kn.InRangeName = ""
_39g = Wherigo.Zone(_fiw)
_39g.Id = "00d082a9-102e-40fe-98a2-d5c87163f9ec"
_39g.Name = _NsWY("B\014W.\006")
_39g.Description = ""
_39g.Visible = true
_39g.Media = _s7H
_39g.Commands = {}
_39g.DistanceRange = Distance(-1, "feet")
_39g.ShowObjects = "OnEnter"
_39g.ProximityRange = Distance(60, "meters")
_39g.AllowSetPositionTo = false
_39g.Active = false
_39g.Points = {
  ZonePoint(47.8026847848293, 13.0388049198921, 0),
  ZonePoint(47.8025859837687, 13.0389846278961, 0),
  ZonePoint(47.8024520931882, 13.0389095260437, 0),
  ZonePoint(47.8025138710204, 13.0387271358306, 0)
}
_39g.OriginalPoint = ZonePoint(47.8025591832017, 13.0388565524156, 0)
_39g.DistanceRangeUOM = "Feet"
_39g.ProximityRangeUOM = "Meters"
_39g.OutOfRangeName = ""
_39g.InRangeName = ""
_9NrB = Wherigo.ZItem(_fiw)
_9NrB.Id = "0b2a1a36-9eb0-431b-89d5-0e3ff8f07ef2"
_9NrB.Name = _NsWY("n.C1#1 0FF0Wx.tt0")
_9NrB.Description = ""
_9NrB.Visible = true
_9NrB.Media = _vO4H
_9NrB.Commands = {}
_9NrB.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_9NrB.Locked = false
_9NrB.Opened = true
_M1IX = Wherigo.ZItem(_fiw)
_M1IX.Id = "305fa196-24d8-4b26-bf2e-fa35a9184749"
_M1IX.Name = _NsWY("n.C1#1cL\022")
_M1IX.Description = ""
_M1IX.Visible = true
_M1IX.Media = _VAJ
_M1IX.Commands = {}
_M1IX.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_M1IX.Locked = false
_M1IX.Opened = true
_cbh = Wherigo.ZItem(_fiw)
_cbh.Id = "be9318a8-bf1b-4753-97f2-c6e0731cde3a"
_cbh.Name = _NsWY("n.C1#1=\006\0170F1n.F$\017")
_cbh.Description = ""
_cbh.Visible = true
_cbh.Media = _ouvbh
_cbh.Commands = {}
_cbh.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_cbh.Locked = false
_cbh.Opened = true
_4VqD = Wherigo.ZItem(_fiw)
_4VqD.Id = "9751de2d-8074-4428-8d24-d7b1fd4e08ee"
_4VqD.Name = _NsWY("n.C1#1nT[.F\017t1 TLt0")
_4VqD.Description = ""
_4VqD.Visible = true
_4VqD.Media = _pFqA
_4VqD.Commands = {}
_4VqD.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_4VqD.Locked = false
_4VqD.Opened = true
_3GOQa = Wherigo.ZItem(_fiw)
_3GOQa.Id = "ea1aa92e-5e31-4f91-be6d-7c276c6b0255"
_3GOQa.Name = _NsWY("n.C1#1\016C\014\017.\006")
_3GOQa.Description = ""
_3GOQa.Visible = true
_3GOQa.Media = _5LD
_3GOQa.Commands = {}
_3GOQa.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_3GOQa.Locked = false
_3GOQa.Opened = true
_eqB = _NsWY(" 0\006\006T1")
_PUag = _NsWY("|h*\031Q>T\006&x.Wx1=\t.\0290Lt1nT[.F\0171CFT\022.\022\006o1\014t1\017\f01xF0.\0170t\0171tTW1T&1\017\f01\017T,W1T&1\016.\006[\022LFxz1 \014t1W.\t01\014t1T\tW\014CF0t0W\0171.\006\0061T@0F1\017\f01C\006.'0z1*L\0171\tTt\0171T&1\017\f01t\014x\f\017t1\017\f.\0171.F01WT,.\029.ot1.ttT'\014.\0170\0291,\014\017\f1nT[.F\0171\029\014\029W\127\01710%\014t\0171,\f0W1\f01\006\014@0\0291\014W1\017\f01/J\017\f1'0W\017LFoz1d\fTLx\f1\017\f0F01.F01t\017\014\006\0061tT\t01\014W\0170F0t\017\014Wx1tCT\017t1\017\f.\0171nT[.F\0171\t.o\02201@\014t\014\0170\0291,\f0W1\f01t\017FT\006\0060\0291\017\fFTLx\f1\017\f01\017T,W1#9\0031o0.Ft1.xTzh*\031Q80\0171Lt1\017.$01oTL1TW1.1\017TLF1\017\fFTLx\f1nT[.F\017t1\016.\006[\022LFx1,\014\017\f1tT\t01\f\014\029\0290W1\0220.L\017\0140t1.W\0291.1t\017TFo1\017\f.\0171\014tW\127\0171.\006,.ot1\017\f.\0171t0F\014TLtz")
_9XIB = ""
_fKO = ""
_AmNJp = _NsWY("q\017M#")
_C3zmp = _NsWY("\029L\t\to")
_u8qyD = _NsWY("q_+F*")
_zaiC = _NsWY("\029L\t\to")
_7UR = _NsWY("qW/W")
_r3Uq = _NsWY("\029L\t\to")
_fiw.ZVariables = {
  _eqB = _NsWY(" 0\006\006T1"),
  _PUag = _NsWY("|h*\031Q>T\006&x.Wx1=\t.\0290Lt1nT[.F\0171CFT\022.\022\006o1\014t1\017\f01xF0.\0170t\0171tTW1T&1\017\f01\017T,W1T&1\016.\006[\022LFxz1 \014t1W.\t01\014t1T\tW\014CF0t0W\0171.\006\0061T@0F1\017\f01C\006.'0z1*L\0171\tTt\0171T&1\017\f01t\014x\f\017t1\017\f.\0171.F01WT,.\029.ot1.ttT'\014.\0170\0291,\014\017\f1nT[.F\0171\029\014\029W\127\01710%\014t\0171,\f0W1\f01\006\014@0\0291\014W1\017\f01/J\017\f1'0W\017LFoz1d\fTLx\f1\017\f0F01.F01t\017\014\006\0061tT\t01\014W\0170F0t\017\014Wx1tCT\017t1\017\f.\0171nT[.F\0171\t.o\02201@\014t\014\0170\0291,\f0W1\f01t\017FT\006\0060\0291\017\fFTLx\f1\017\f01\017T,W1#9\0031o0.Ft1.xTzh*\031Q80\0171Lt1\017.$01oTL1TW1.1\017TLF1\017\fFTLx\f1nT[.F\017t1\016.\006[\022LFx1,\014\017\f1tT\t01\f\014\029\0290W1\0220.L\017\0140t1.W\0291.1t\017TFo1\017\f.\0171\014tW\127\0171.\006,.ot1\017\f.\0171t0F\014TLtz"),
  _9XIB = "",
  _fKO = "",
  _AmNJp = _NsWY("q\017M#"),
  _C3zmp = _NsWY("\029L\t\to"),
  _u8qyD = _NsWY("q_+F*"),
  _zaiC = _NsWY("\029L\t\to"),
  _7UR = _NsWY("qW/W"),
  _r3Uq = _NsWY("\029L\t\to")
}
_n1n = Wherigo.ZInput(_fiw)
_n1n.Id = "58af453d-455b-4a61-9da1-118f6f2cac43"
_n1n.Name = _NsWY("*FLWW0W&F.x0")
_n1n.Description = ""
_n1n.Visible = true
_n1n.Choices = {
  "ELEFANT",
  "FACE",
  "COLLUMN"
}
_n1n.InputType = "MultipleChoice"
_n1n.Text = _NsWY("=\0171,\f.\0171\029\014\0291\017\f0o1\022.Wx1TWEh*\031Q=W1-8-B=+dg1.1B=\019-1TF1.1\019)88jn+E")
_AGbUf = Wherigo.ZInput(_fiw)
_AGbUf.Id = "790fe0ce-927a-4ac6-9d57-228548bb4e4f"
_AGbUf.Name = _NsWY("jW\014&F.x0")
_AGbUf.Description = ""
_AGbUf.Visible = true
_AGbUf.Media = _GnLTF
_AGbUf.InputType = "Text"
_AGbUf.Text = _NsWY("c\0060.t010W\0170F1WT,1\017\f01WL\t\0220F1/9|")
_vY2DO = Wherigo.ZInput(_fiw)
_vY2DO.Id = "22a97607-66d5-43a0-8dc7-e6287a53544a"
_vY2DO.Name = _NsWY("8.L&\f.Lt&F.x0")
_vY2DO.Description = ""
_vY2DO.Visible = true
_vY2DO.Media = _dzu
_vY2DO.InputType = "Text"
_vY2DO.Text = _NsWY("=Wo,.oz1d0\006\0061\t01,\f0W1\017\f\014t10t\017.\022\006\014t\f\t0W\0171,.t1&TLW\0290\0291.W\0291,01xT1TWz1")
_rdXVl = Wherigo.ZInput(_fiw)
_rdXVl.Id = "043a8e13-8a35-4a0e-826c-0ac4cce5294e"
_rdXVl.Name = _NsWY("y\014F$0\006,\014F\017&F.x0")
_rdXVl.Description = ""
_rdXVl.Visible = true
_rdXVl.Media = _dzu
_rdXVl.Choices = {
  "EYE",
  "ANGLE",
  "CIRCLE"
}
_rdXVl.InputType = "MultipleChoice"
_rdXVl.Text = _NsWY("=\022T@01\017\f01\029TTF1oTL1'.W1t001TLF1t\014xWz1>\f.\0171\014t1\014\017E")
_W0lS = Wherigo.ZInput(_fiw)
_W0lS.Id = "d8ddc14a-76e3-47f8-a722-ee3a515f518e"
_W0lS.Name = _NsWY("nT[.F\017/")
_W0lS.Description = ""
_W0lS.Visible = true
_W0lS.Media = _dzu
_W0lS.InputType = "Text"
_W0lS.Text = _NsWY(">01\006\014@01\014W1\017\f01\017\f\014F\0291&\006TTF1.W\0291\0201'.W\127\0171F0\t0\t\0220F1,\f\014'\f1\0220\006\0061\014\0171,.tz1\019TLW\0171&FT\t1\017\f01\0060&\017z")
_JLpcm = Wherigo.ZInput(_fiw)
_JLpcm.Id = "6bf24ff1-0d8b-453b-aa01-30ff6f9e093e"
_JLpcm.Name = _NsWY("nT[.F\017#")
_JLpcm.Description = ""
_JLpcm.Visible = true
_JLpcm.Media = _dzu
_JLpcm.InputType = "Text"
_JLpcm.Text = _NsWY("d\f.\017\127t1oTLF1\006.t\0171\017.t$1\017T1&\014W\0291\017\f01\017F0.tLF0|1\016T1\0170\006\0061\t01WT,1\017\f01WL\t\0220F1oTL1&TLW\029r")
_9cKR = Wherigo.ZInput(_fiw)
_9cKR.Id = "1b2e501f-973a-4827-b9e7-e77de1c1215b"
_9cKR.Name = _NsWY("jW\014&F.x01-\014Wx.Wx")
_9cKR.Description = ""
_9cKR.Visible = true
_9cKR.Media = _1MIBX
_9cKR.Choices = {
  "Yes - it's OPEN",
  "No - it`s CLOSED"
}
_9cKR.InputType = "MultipleChoice"
_9cKR.Text = _NsWY("+T,1\006TT$1\0060&\0171\017T1&\014W\0291\017\f\014t1-W\017Foz1\020t1\014\0171TC0WE")
_99uP = Wherigo.ZInput(_fiw)
_99uP.Id = "0b2a0089-ef35-42bb-b663-8f3312ad4f70"
_99uP.Name = _NsWY("jW\014&F.x01*L'\ft\017.\0220W")
_99uP.Description = ""
_99uP.Visible = true
_99uP.Media = _GnLTF
_99uP.InputType = "Text"
_99uP.Text = _NsWY("=\0171\017\f\014t1CT\014W\0171\0141\f.@01.1\006\014\017\01701\017.t$1&TF1oTLz1\016T1C\0060.t01'TLW\0171\017\f01\0060\017\0170Ft1T&1\017\f01,TF\0291.\022T@01\017\f01'\006Tt0\02910W\017Fo1.W\0291\017oC01\014W1oTLF1F0tL\006\0171\f0F0r")

function _fiw:OnStart()
  if _G[_NsWY("-W@")][_NsWY("c\006.\017&TF\t")] == _NsWY(">\014WO#") or _G[_NsWY("-W@")][_NsWY("~0@\014'0\020~")] == _NsWY("~0t$\017TC") then
    for k, v in pairs(_G[_NsWY("q&\014,")][_NsWY("=\006\006y)\022i0'\017t")]) do
      v[_NsWY("A\014t\014\022\0060")] = false
      v[_NsWY("='\017\014@0")] = false
    end
    _Urwigo.MessageBox({
      Text = tostring(_NsWY("\016TFFo1l1\017\f\014t1'.F\017F\014\029x01'.W1TW\006o1\02201C\006.o0\0291\014W1F0.\006\014\017o|")),
      Callback = function(action)
        if action ~= nil then
          _G[_NsWY(">\f0F\014xT")][_NsWY("\019T\t\t.W\029")](_NsWY("\016.@0\019\006Tt0"))
        end
      end
    })
    return
  end
  _9XIB = Player.Name
  _fKO = (_eqB .. _9XIB) .. _PUag
  _Urwigo.Dialog(false, {
    {Text = _fKO}
  }, function(action)
    _Z3YS.Active = true
    _Z3YS.Visible = true
    _Urwigo.MessageBox({
      Text = _NsWY(" 0\006\006T|h*\031Q\020\127\t1>T\006&0F\006|1+TF\t.\006\006o1\014\017\127t1WT\0171\to1\022Lt\014W0tt1\017T1xL\014\02901\017TLF\014t\017t1.FTLW\0291\to1\fT\t0\017T,Wz1\0201CF0&0F1\017T1,F\014\01701tTWxt1.\022TL\0171\t0W1\014W1\022\014F\0291'Tt\017L\t0t1TF1\f.@01.1t\014C1\014W1TW01T&1\017\f01\t.Wo1\022F0,0F\0140tz1*L\0171\017T\029.o1\0201\t.$01.W10%'0C\017\014TWz1\016T1&T\006\006T,1\t01.W\0291\029TW\127\0171\f.Wx1\0220\f\014W\029|h*\031Q"),
      Media = _d2gCv,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.MessageBox({
            Text = _NsWY("B\014Ft\0171T&1.\006\006g1\to1\017L\t\to1xFT,\006tz1\016T1\0060\017t1xT1.1&0,1\t0\0170Ft1.W\0291t\017TC1.\0171\017\f01&\014Ft\0171\014W\0170F0t\017\014Wx1CT\014W\0171\0141,.W\0171oTL1\017T1t\fT,1.W\0291xF.\0221\017\f0F01.1\006\014\017\017\00601tW.'$|"),
            Media = _5Z66,
            Callback = function(action)
              if action ~= nil then
                Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _Z3YS)
              end
            end
          })
        end
      end
    })
  end)
end

function _fiw:OnRestore()
end

function _tX2:OnEnter()
  _AmNJp = _NsWY("q\017M#")
  _fiw:RequestSync()
  _tX2.Visible = false
  _tX2.Active = false
  _Urwigo.MessageBox({
    Text = _NsWY(">.\014\0171.1t0'TW\0291.W\0291\006TT$1TW1oTLF1F\014x\f\0171\f.W\0291t\014\0290z1~\014\0291\0201\t0W\017\014TWg1\017\f.\0171\020\127\t1&.\tTLt1\014W1\017\f\014t1\017T,WE1d\f0o10@0W1W.\t0\0291\017\f\014t1&0t\017\014@.\0061\f.\006\006g1\022L\014\006\0291\014W1#\003\003\rg1.&\0170F1\t0|1)W1\017\f01T\017\f0F1t\014\0290g1\0220\f\014W\0291oTLg1t\017.W\029t1\017\f01\023,\014\006\0291\t.W\023z1>\f0W1\0201,.t1\022TFWg1\017\f01,\fT\00601&TLW\017.\014W1t\017TT\0291\014W1&FTW\0171T&1\017\f01\fTLt0g1\t01.W\0291\to1C.F0W\017t1,0F01\006\014@\014Wx1\014Wz"),
    Media = _dzu,
    Callback = function(action)
      if action ~= nil then
        _KYa.Active = true
        _KYa.Visible = true
        _Urwigo.MessageBox({
          Text = _NsWY("8TT$1TL\017|1wTL1,0F01W0.F\006o1FLW1T@0F1\022o1.1cF\014tTWl'T.'\f|1d\f0t01\029F\014@0Ft1.F01'F.[og1,\f0W1\017\f0o1\022F\014Wx1\017\f01CF\014tTW0Ft1\017T1\017\f01x.\006\006T,1TW1\017\f01T\017\f0F1t\014\02901T&1\017\f01F\014@0Fz1=W\0291\0201t\fT,1oTL1,\foz1BT\006\006T,1\t0|"),
          Media = _dzu,
          Callback = function(action)
            if action ~= nil then
              Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _KYa)
            end
          end
        })
      end
    end
  })
end

function _KYa:OnProximity()
  _AmNJp = _NsWY("qIw.")
  _fiw:RequestSync()
  _KYa.Visible = false
  _KYa.Active = false
  _Urwigo.MessageBox({
    Text = _NsWY("d\f01\0060x0W\0291t.otg1\017\f.\0171.1'TW@\014'\0171\014t1&F001\014&1\f01TF1t\f01'.W1\017TL'\f1\017\f0t01&\014Wx0Ft1W0%\0171\017T1\017\f010W\017F.W'01T&1\017\f01BF.W[\014t$.W0F1'\fLF'\fz1*L\0171\017\f01'T.'\f\t0W1\t.$01\014\0171\014\tCTtt\014\022\00601.t1\017\f0o1FLt\f1\017\fFTLx\f1\017\f\014t1\006\014\017\01701t\017F00\017z1*o1\017\f01,.o1l1\017\f\014t1'\fLF'\f1\014t1T\006\0290F1\017\f.W1\017\f01'.\017\f0\029F.\006g1,\f\014'\f1\014t1\017\f01W0%\0171t\017TC1TW1TLF1\017TLFz"),
    Media = _ICSl,
    Callback = function(action)
      if action ~= nil then
        _6Ks.Active = true
        _6Ks.Visible = true
        _Urwigo.MessageBox({
          Text = _NsWY("\016T1'T\t01TW1\017\f\014t1,.o|"),
          Media = _5Z66,
          Callback = function(action)
            if action ~= nil then
              Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _6Ks)
            end
          end
        })
      end
    end
  })
end

function _6Ks:OnProximity()
  _AmNJp = _NsWY("q\rIt")
  _fiw:RequestSync()
  _6Ks.Visible = false
  _6Ks.Active = false
  _Urwigo.MessageBox({
    Text = _NsWY(")\fg1\020\127@01W0.F\006o1&TFxT\017\0170W1\017T1t\fT,1oTL1.1W\014'01\006\014\017\017\00601\0290\017.\014\006z1>.\006$1\017\fFTLx\f1\017\f01.F'\f1\014W1\017\f01\t\014\029\029\00601.W\0291t\017TC1.CCFT%\014\t.\0170\006o1.\0171\017\f01\029L'\0171'T@0Fz1+T,1\006TT$1.\0171\017\f01\f0.\0291T&1\017\f01n.F\014.1t\017.\017L0z1\019.W1oTL1t001,\f.\0171\f.CC0WtE1w0t|1\020\0171\006TT$t1\006\014$01t\f01\f.t1\017\f01'FT,W1TW1\f0F1\f0.\029z"),
    Media = _U6y,
    Callback = function(action)
      if action ~= nil then
        _hrDq.Active = true
        _hrDq.Visible = true
        _9NrB:MoveTo(Player)
        _Urwigo.MessageBox({
          Text = _NsWY("\020\127\t1WT\0171F0.\006\006o1.1&.W1T&1'\fLF'\f0tz1=W\0291\020\127\t1\017\014F0\0291T&1,.\006$\014Wxz1>\f.\0171\029T1oTL1\017\f\014W$1.\022TL\0171F0'F0.\017\014TWE1\0201$WT,1\017\f01C0F&0'\0171C\006.'01&TF1\014\017z"),
          Media = _dzu,
          Callback = function(action)
            if action ~= nil then
              Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _hrDq)
            end
          end
        })
      end
    end
  })
end

function _hrDq:OnEnter()
  _AmNJp = _NsWY("q\fF~{")
  _fiw:RequestSync()
  _9NrB:MoveTo(_hrDq)
  _hrDq.Visible = false
  _hrDq.Active = false
  _Urwigo.MessageBox({
    Text = _NsWY("w0t1\014\0171\014t|1~TW\127\0171\02201tT1CFL\0290|1d\f.\017t1\017\f01T\006\0290t\0171\022FT\017\f0\0061\014W1\017T,Wz1-@0W1\017\f01.\006\0060o1\014t1W.\t0\0291.&\0170F1\014\0171l1\017\f01 0FF0Wx.tt0g1,\f\014'\f1\t0.Wt1\017\f01n0Wt.\006\0060oz1=W\0291\0220\f\014W\0291\017\f01,.\006\0061TW1\017\f01TCCTt\014\01701t\014\02901,.t1\017\f01CF\0140t\017t\fTLt0z1?L0tt1,\fT1,\f0F01\017\f01\0220t\0171'\006\0140W\017t1\f0F0zzzz1wTL1\029TW\127\0171\f.@010WTLx\f1\tTW0o1,\014\017\f1oTLE1>\f.\0171.1t\f.\t0|"),
    Media = _dzu,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_vY2DO)
        end)
      end
    end
  })
end

function _utpTV:OnEnter()
  _AmNJp = _NsWY("qL\017CdA")
  _fiw:RequestSync()
  _M1IX:MoveTo(_utpTV)
  _utpTV.Visible = false
  _utpTV.Active = false
  _Urwigo.MessageBox({
    Text = _NsWY("\020\127\006\0061\0170\006\0061oTL1.1t0'F0\017r1\020\127\t1.1\t0\t\0220F1T&1.1t0'F0\0171tT'\0140\017o1\014W1\016.\006[\022LFxg1\017\f01&F001\t.tTWz1=W\0291\017\f\014t1\014t1TLF1\t00\017\014Wx1\f.\006\006z"),
    Media = _dzu,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_rdXVl)
        end)
      end
    end
  })
end

function _aVX:OnProximity()
  _AmNJp = _NsWY("q.AM")
  _cbh:MoveTo(_aVX)
  _0mX7.Active = true
  _0mX7.Visible = true
  _fiw:RequestSync()
  _4VqD:MoveTo(Player)
  _Urwigo.MessageBox({
    Text = _NsWY("\020\127\006\0061\02201\029.\tW0\029|1d\f0o1F0.\006\006o1\022L\014\006\0171.1\fTLt01\014W1\017\f\014t1\017\014Wo1.\006\0060oz1d\f\014t1,.t1\to1&.@TF\014\01701t\fTF\017'L\0171\017T1\017\f01?0\017F0\014\0290x.tt0z1=W\0291WT,1\014\0171\tLt\0171\02201\017\f01t\t.\006\0060t\0171\fTLt01\014W1\017T,W|1\016T1\017\f0Wg1\017LFW1F\014x\f\0171.W\0291.\0171\017\f01W0%\0171'TFW0F1\017LFW1\0060&\017z1"),
    Media = _dzu,
    Callback = function(action)
      if action ~= nil then
        Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _0mX7)
      end
    end
  })
  _aVX.Visible = false
  _aVX.Active = false
end

function _0mX7:OnProximity()
  _AmNJp = _NsWY("q\003\tMK")
  _fiw:RequestSync()
  _Urwigo.MessageBox({
    Text = _NsWY(" 0F01,01.F01l1.W\0291\0201\f.@01.1\006.t\0171{L0t\017\014TW1&TF1oTLz"),
    Media = _W50v3,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_W0lS)
        end)
      end
    end
  })
end

function _Z3YS:OnProximity()
  _AmNJp = _NsWY("qyOw\016")
  _fiw:RequestSync()
  _Z3YS.Visible = false
  _Z3YS.Active = false
  _Urwigo.MessageBox({
    Text = _NsWY("wTL\127F01t\017.W\029\014Wx1\014W1&FTW\0171T&1TW01T&1\017\f01T\006\0290t\0171\022.$0F\0140t1\014W1\017T,Wz1d\f01TW01\014W1\016\017z1c0\0170F1\014t1T\006\0290Fg1\022L\0171\017\f01\022F0.\029FT\006\006t1l1TLF1\0160\t\t0F\0061l1.F01\022o1&.F1\0220\017\0170F1\f0F0z1\016\017.F'\f0\0291WT,1,01'.W1\f.@01.1\006TT$1\fT,1\014t1\to1&.\017\f0Fz1 01\014t1\014W1\fTtC\014\017.\006z"),
    Media = _1log,
    Callback = function(action)
      if action ~= nil then
        _3GOQa:MoveTo(Player)
        _mRNo.Active = true
        _mRNo.Visible = true
        _Urwigo.MessageBox({
          Text = _NsWY("dT1F0.'\f1\017\f01\fTtC\014\017.\006g1oTL1,\014\006\0061\f.@01\017T1C.tt1.1x.\0170|"),
          Media = _lh_u,
          Callback = function(action)
            if action ~= nil then
              Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _mRNo)
            end
          end
        })
      end
    end
  })
end

function _mRNo:OnProximity()
  _AmNJp = _NsWY("q\t\031+T")
  _fiw:RequestSync()
  _Urwigo.MessageBox({
    Text = _NsWY("d\f01*L0Fx0FtC\014\017.\0061,.t1\022L\014\006\0171\014W1/O#K1.W\0291t\014W'01\017\f0W1\014\017\127t1\017\f01C\006.'01\017T1\02201\014&1oTL\127@010.\0170W1\017\f\014t1FT\017\0170W1&\014t\f1\006\014$01\to1&.\017\f0Fz1*L\0171.1t\fTF\0171,.@01\014t10WTLx\f1&TF1\t01\017T1t001\017\f.\0171\f0\127t1,0\006\006z1\016T1\020\127\006\0061iLt\0171,.t\f1\to1\f.W\029t1.W\029zz1)jd\019 |1\0201\fLF\0171\to1\017T0t1.\0171\017\f01&TLW\017.\014Wz"),
    Media = _dzu,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.RunDialogs(function()
          Wherigo.GetInput(_n1n)
        end)
      end
    end
  })
end

function _R5Kn:OnEnter()
  _AmNJp = _NsWY("q\0319IW")
  _fiw:RequestSync()
  _R5Kn.Visible = false
  _R5Kn.Active = false
  _Urwigo.RunDialogs(function()
    Wherigo.GetInput(_9cKR)
  end)
end

function _39g:OnEnter()
  _AmNJp = _NsWY("qO_x")
  _Urwigo.MessageBox({
    Text = _NsWY("wTL1.F01WT,1@0Fo1'\006Tt01\017T1\017\f01\022T%1l1\017\f010%.'\0171'TTF\029\014W.\0170t1.F0rh*\031Q+1mW\022tC\002vK1vJz/9/h*\031Q-1\003/O1\003#zOv/h*\031Q*L\0171,.\017'\f\014Wx1\017\f01tCT\014\0060FC\014'\017LF0g1\014\0171t\fTL\006\0291\022010.to1\017T1&\014W\0291\017\f01'TW\017.\014W0Fz"),
    Media = _s7H,
    Callback = function(action)
      if action ~= nil then
        _Urwigo.MessageBox({
          Text = _NsWY("d\f.W$1oTL1&TF1C\006.o\014Wx1\017\f\014t1>\f0F\014xT|1d\f0F01,\014\006\0061\02201WT1'T\tC\0060\017\014TWl'T\02901'F0.\0170\029g1\022L\0171C\0060.t01\029TW\0171&TFx0\0171\017T1\006Tx1\017\f01'.'\f01WT\0171TW\006o1TW1,,,zx0T'.'\f\014Wxz'T\t1\022L\0171.\006tT1TW1,,,z,\f0F\014xTz'T\tz"),
          Media = _VvfM8,
          Callback = function(action)
            if action ~= nil then
              Wherigo.Command("SaveClose")
            end
          end
        })
      end
    end
  })
end

function _n1n:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 19552 then
    _3GOQa:MoveTo(_mRNo)
    _mRNo.Visible = false
    _mRNo.Active = false
    _Urwigo.Dialog(false, {
      {
        Text = _NsWY("c0F&0'\0171l1\017\f.\017t1F\014x\f\017|"),
        Media = _eb1
      }
    }, function(action)
      _R5Kn.Active = true
      _R5Kn.Visible = true
      _Urwigo.MessageBox({
        Text = _NsWY("\020\127\t1WT\0171.1t\014ttog1tT1\0060\017\127t1xT1TW1\017T1\017\f01jW\014@0Ft\014\017o1l1\017\f0F01oTL\127F01\006TT$\014Wx1&TF1.1'.'\f0z1d\f01WL\t\0220F1\014W1\014\0171\022F\014Wxt1oTL1\017T1TLF1W0%\0171t\014x\f\017z"),
        Media = _5Z66,
        Callback = function(action)
          if action ~= nil then
            Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _R5Kn)
          end
        end
      })
    end)
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1,FTWx1.Wt,0F|1c\0060.t01\017Fo1\014\0171.x.\014Wz"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_n1n)
          end)
        end
      end
    })
  end
end

function _AGbUf:OnGetInput(input)
  input = tonumber(input)
  if input == nil then
    return
  end
  if input == 15 then
    _tX2.Active = true
    _tX2.Visible = true
    _Urwigo.MessageBox({
      Text = _NsWY("\019TWxF.\017t|1wTL\127@01&TLW\0291\017\f01\022T%1.W\0291\017\f01WL\t\0220F|1~TW\127\0171t\017.o1\f0F01\017TT1\006TWxz1d\f0F0\127t1t\017\014\006\0061.1\006T\0171\017T1t00|1?T1\022.'$1\017T1\017\f01&0t\017\014@.\0061\f.\006\006t1.W\0291\017LFW1\0060&\017z"),
      Media = _eb1,
      Callback = function(action)
        if action ~= nil then
          Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _tX2)
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1,FTWx1.Wt,0F1l1C\0060.t01\017Fo1\014\0171.x.\014W|"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_AGbUf)
          end)
        end
      end
    })
  end
end

function _vY2DO:OnGetInput(input)
  input = tonumber(input)
  if input == nil then
    return
  end
  if input == 1501 then
    _utpTV.Active = true
    _utpTV.Visible = true
    _M1IX:MoveTo(Player)
    _Urwigo.MessageBox({
      Text = _NsWY("\016T1\017\f0Wg1\0060\017t1xT|1>01,.\006$1\017\fFTLx\f1\017\f01IFT\017.'\fx.tt01\017T1\to1&.@TF\014\01701CL\022z1"),
      Media = _eb1,
      Callback = function(action)
        if action ~= nil then
          Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _utpTV)
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1,FTWx1.Wt,0F|1c\0060.t01\017Fo1\014\0171.x.\014Wz"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_vY2DO)
          end)
        end
      end
    })
  end
end

function _rdXVl:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 33554 then
    _aVX.Active = true
    _aVX.Visible = true
    _cbh:MoveTo(Player)
    _Urwigo.MessageBox({
      Text = _NsWY(">0\006\0061\029TW0|1>\f.\0171\029T1oTL1\017\f\014W$1.\022TL\0171.1\029F\014W$1\014W1\to1\fT\t0E1\020\127\t1tLF0g1\to1,\014&01\014t1.\0171\fT\t0z1"),
      Media = _eb1,
      Callback = function(action)
        if action ~= nil then
          Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _aVX)
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1,FTWx1.Wt,0F|18TT$1.x.\014W1.1\017.$01.1t0'TW\0291\017Fo|"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_rdXVl)
          end)
        end
      end
    })
  end
end

function _W0lS:OnGetInput(input)
  input = tonumber(input)
  if input == nil then
    return
  end
  if input == 2 then
    _4VqD:MoveTo(_0mX7)
    _0mX7.Visible = false
    _0mX7.Active = false
    _Urwigo.MessageBox({
      Text = _NsWY("c0F&0'\017|h*\031Q*0&TF01\0141,\014\006\0061\0170\006\0061oTL1\017\f01'TTF\029\014W.\0170t1&TF1\017\f01&\014W.\006g1\0141\f.@01.1\006\014\017\01701\017\014C1&TF1oTL1lmx\017\0021iLt\0171.1&0,1\t0\0170Ft1&FT\t1\f0F01oTL1'.W1&\014W\0291.WT\017\f0F1\017F.\029\014\017\014TW.\0061'.'\f01l1\017\f01?\019On+v_1mW\022tC\002l1n0x.l\016\0170.\006\017\f1\tT\02901\014t1F0{L\014F0\029|"),
      Media = _eb1,
      Callback = function(action)
        if action ~= nil then
          _fiw:RequestSync()
          _39g.Active = true
          _39g.Visible = true
          _Urwigo.MessageBox({
            Text = _NsWY("\020\0171,.t1.1C\006.tLF01&TF1\t01\017T1t\fT,1oTL1\to1\017T,Wz1wTL\127\006\0061&\014W\0291,\f.\0171oTL\127F01\006TT$\014Wx1&TF1.\017r1h*\031Q+1mW\022tC\002vK1vJz/9/h*\031Q-1\003/O1\003#zOv/h*\031Q\0201,\014\006\0061WT,1xL\014\02901oTL1W0.F1\017\f01&\014W.\0061\0290t\017\014W.\017\014TW1.W\0291t\fT,1oTL1.1tCT\014\0060FC\014'\017LF0z"),
            Media = _d2gCv,
            Callback = function(action)
              if action ~= nil then
                Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _39g)
              end
            end
          })
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1,FTWx1.Wt,0F1l1\017Fo1\014\0171.x.\014W|"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_W0lS)
          end)
        end
      end
    })
  end
end

function _JLpcm:OnGetInput(input)
  input = tonumber(input)
  if input == nil then
    return
  end
  if input == 3 then
    _0mX7.Visible = false
    _0mX7.Active = false
    _Urwigo.MessageBox({
      Text = _NsWY(">0\006\0061\029TW0z1\020\0171,.t1.1C\006.tLF01&TF1\t01\017T1t\fT,1oTL1\to1\017T,Wzh*\031QwTL\127\006\0061&\014W\0291,\f.\0171oTL\127F01\006TT$\014Wx1&TF1.\017r1h*\031Q+vK1EEzEEEh*\031Q-/O1EzEEE"),
      Media = _eb1,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.MessageBox({
            Text = _NsWY("c\0060.t01\029TW\0171&TFx0\0171\017T1\006Tx1\017\f01'.'\f01WT\0171TW\006o1TW1,,,zx0T'.'\f\014Wxz'T\t1\022L\0171.\006tT1TW1,,,z,\f0F\014xTz'T\t"),
            Media = _VvfM8,
            Callback = function(action)
              if action ~= nil then
                Wherigo.Command("SaveClose")
              end
            end
          })
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1,FTWx1.Wt,0F|1c\0060.t01\017Fo1\014\0171.x.\014Wz"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_JLpcm)
          end)
        end
      end
    })
  end
end

function _9cKR:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 62856 then
    _Urwigo.MessageBox({
      Text = _NsWY("B\014W01l1tT1C\0060.t010W\0170Fz1 0F01oTL1'TL\006\0291&\014W\0291\017\f01\019.'\f01?\019OnnAv1l1\022L\0171iLt\0171\017\014\006\0061n.o1#\003/9z1>01.F01tTFFo1.\022TL\0171\017\f.\017g1\022L\0171\014\0171\014t1WT\0171CTtt\014\022\00601\017T1\f\014\02901\017\f\014t1'.'\f01\f0F01.\0171\017\f01\tT\t0W\0171l1,01,\014\006\0061t001,\f.\0171\017\f01&L\017LF01,\014\006\0061\022F\014Wx1r\015"),
      Media = _XpiBx,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.MessageBox({
            Text = _NsWY("wTL\127F01t\017.W\029\014Wx1\014W1\017\f01\t\014\029\029\00601T&1TW01T&1\017\f01T\006\0290t\0171C.F\017t1T&1\017\f01\016.\006[\022LFx1jW\014@0Ft\014\017oz1d\f01c.F\014t18T\029FTW1jW\014@0Ft\014\017o1\014W1\016.\006[\022LFx1,.t1&TLW\0290\0291\022o1cF\014W'01=F'\f\022\014t\fTC1c.F\014t18T\029FTW1\014W1/\r##z1\020\0171,.t1.W1.\029\029\014\017\014TW1\017T1.1\023?o\tW.t\014L\t\023g1.1t0'TW\029.Fo1t'\fTT\0061\017\f.\0171\f.\0291\02200W1&TLW\0290\0291\014W1/\r/Kzh*\031Q"),
            Media = _dzu,
            Callback = function(action)
              if action ~= nil then
                _Urwigo.MessageBox({
                  Text = _NsWY("d\f01jW\014@0Ft\014\017o1,.t1\014W\014\017\014.\006\006o1t0\0171LC1.W\0291\t.\014W\017.\014W0\0291\022o1.1&0\0290F.\017\014TW1T&1*0W0\029\014'\017\014W01.\022\0220ot1&FT\t1\016.\006[\022LFxg1\016,\014\017[0F\006.W\029g1*.@.F\014.1.W\0291=Lt\017F\014.z1\020W1\017\f010.F\006o1o0.Ftg1\017\f01'TLFt0t1\017.Lx\f\0171,0F01\017\f0T\006Txog1\029\014@\014W\014\017og1C\f\014\006TtTC\fo1.t1,0\006\0061.t1\006.,1.W\0291\t0\029\014'\014W0z1h*\031Q=\022T@01oTL1TW1\017\f01&\014Ft\0171&\006TTF1\014t1\017\f01\023?FTtt01=L\006.\0231l1\017\f01T&&\014'\014.\0061'0F0\tTWo1\f.\006\0061T&1\017\f01jW\014@0Ft\014\017oz1\020W1/K\r/g1.\0171\017\f01.x01T&1TW\006o191o0.Ftg1\0141C\006.o0\0291.1\029.W'\014Wx1&TT\029\022To1\014W1\023\016\014x\014t\tLW\029Lt1 LWx.F\014.01\0310%\023z1=W\0291\014W1/K\rK1\017\f01CF0\t\0140F01T&1\to1TC0F.1\023=CT\006\006T10\0171 o.'\014W\017\fTt\0231:IA1OJ\0151,.t1\017.$\014Wx1C\006.'01LC1\017\f0F01l1\0201\tot0\006&1C\006.o0\0291\017\f01C\014.WT1l1\0141,.t1TW\006o1//1o0.Ft1T\006\029z"),
                  Callback = function(action)
                    if action ~= nil then
                      _Urwigo.MessageBox({
                        Text = _NsWY(" 0F01oTL1'.W1t001\017\f01tCT\014\0060F1T&1\017\f01T\006\0291dF.\029\0141\017\f.\0171,.t1\f\014\029\0290W1\f0F01\017\014\006\0061n.o1#\003/91\002\0151\020\0171,.t1.W1T\006\0291*\014'o'\00601\002\015"),
                        Media = _XpiBx,
                        Callback = function(action)
                          if action ~= nil then
                            _Urwigo.RunDialogs(function()
                              Wherigo.GetInput(_AGbUf)
                            end)
                          end
                        end
                      })
                    end
                  end
                })
              end
            end
          })
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY(")I1mW\022tC\002\029T0t1WT\0171F0.\006\006o1\t.\017\0170Fz1\0201,\014\006\0061\0170\006\0061oTL1tT\t0\017\f\014Wx1.\022TL\0171\017\f01\016.\006[\022LFx1jW\014@0Ft\014\017o1.Wo,.ozh*\031Qd\f01c.F\014t18T\029FTW1jW\014@0Ft\014\017o1\014W1\016.\006[\022LFx1,.t1&TLW\0290\0291\022o1cF\014W'01=F'\f\022\014t\fTC1c.F\014t18T\029FTW1\014W1/\r##z1\020\0171,.t1.W1.\029\029\014\017\014TW1\017T1.1\023?o\tW.t\014L\t\023g1.1t0'TW\029.Fo1t'\fTT\0061\017\f.\0171\f.\0291\02200W1&TLW\0290\0291\014W1/\r/Kzh*\031Q"),
      Media = _dzu,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.MessageBox({
            Text = _NsWY("d\f01jW\014@0Ft\014\017o1,.t1\014W\014\017\014.\006\006o1t0\0171LC1.W\0291\t.\014W\017.\014W0\0291\022o1.1&0\0290F.\017\014TW1T&1*0W0\029\014'\017\014W01.\022\0220ot1&FT\t1\016.\006[\022LFxg1\016,\014\017[0F\006.W\029g1*.@.F\014.1.W\0291=Lt\017F\014.z1\020W1\017\f010.F\006o1o0.Ftg1\017\f01'TLFt0t1\017.Lx\f\0171,0F01\017\f0T\006Txog1\029\014@\014W\014\017og1C\f\014\006TtTC\fo1.t1,0\006\0061.t1\006.,1.W\0291\t0\029\014'\014W0z1h*\031QjCt\017.\014Ft1TW1\017\f01&\014Ft\0171&\006TTF1\014t1\017\f01\023?FTtt01=L\006.\0231l1\017\f01T&&\014'\014.\0061'0F0\tTWo1\f.\006\0061T&1\017\f01jW\014@0Ft\014\017oz1\020W1/K\r/g1.\0171\017\f01.x01T&1TW\006o191o0.Ftg1\0141C\006.o0\0291.1\029.W'\014Wx1&TT\029\022To1\014W1\023\016\014x\014t\tLW\029Lt1 LWx.F\014.01\0310%\023z1=W\0291\014W1/K\rK1\017\f01CF0\t\0140F01T&1\to1TC0F.1\023=CT\006\006T10\0171 o.'\014W\017\fTt\0231:IA1OJ\0151,.t1\017.$\014Wx1C\006.'01LC1\017\f0F01l1\0201\tot0\006&1C\006.o0\0291\017\f01C\014.WT1l1\0141,.t1TW\006o1//1o0.Ft1T\006\029z"),
            Callback = function(action)
              if action ~= nil then
                _Urwigo.RunDialogs(function()
                  Wherigo.GetInput(_99uP)
                end)
              end
            end
          })
        end
      end
    })
  end
end

function _99uP:OnGetInput(input)
  input = tonumber(input)
  if input == nil then
    return
  end
  if input == 22 then
    _tX2.Active = true
    _tX2.Visible = true
    _Urwigo.MessageBox({
      Text = _NsWY("w0t1l1\017\f.\017t1\017\f01F\014x\f\0171.Wt,0Fz1*L\0171\029TW\127\0171t\017.o1\f0F01\017TT1\006TWxz1d\f0F0\127t1t\017\014\006\0061.1\006T\0171\017T1t00|1\019TW\017\014WL01\017\f\014t1,.o1\017T1TLF1W0%\0171tCT\017z"),
      Media = _eb1,
      Callback = function(action)
        if action ~= nil then
          Wherigo.ShowScreen(Wherigo.DETAILSCREEN, _tX2)
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = _NsWY("\016TFFo1l1C\0060.t01\017Fo1\014\0171.x.\014W|"),
      Media = _pc6,
      Callback = function(action)
        if action ~= nil then
          _Urwigo.RunDialogs(function()
            Wherigo.GetInput(_99uP)
          end)
        end
      end
    })
  end
end

return _fiw
