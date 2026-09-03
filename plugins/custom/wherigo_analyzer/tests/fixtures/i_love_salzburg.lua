require("Wherigo")
ZonePoint = Wherigo.ZonePoint
Distance = Wherigo.Distance
Player = Wherigo.Player

function _pJ4N(str)
  local res = ""
  local dtable = ".ZnW)\015\016shx8%#'\t|\019\030\021\f2UoL/\001M1ap6\004\023\018Q5PJvm!\003*\022KjEge\031\b\n\017{u$(G\000\026^FBT\v \025`w\020k_X\029:@l<\014V;DC\aqI>brO?\0063-7fN0A\002tYd\024&]S,y9c\028\027\"R=4\r\005H~z+[i\\}"
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
i_love_Salzburg = Wherigo.ZCartridge()
_1Gkxa = Wherigo.ZMedia(i_love_Salzburg)
_1Gkxa.Id = "16906152-88ec-47f8-a9a7-30df3948be8b"
_1Gkxa.Name = _pJ4N(">}\003\029M")
_1Gkxa.Description = _pJ4N("\027}\003g1\be\029\003z\029\tMBg1YB%7\003Ge1B1YY1}o\te\001")
_1Gkxa.AltText = ""
_1Gkxa.Resources = {
  {
    Type = "jpg",
    Filename = "Final.jpg",
    Directives = {}
  }
}
_keAY = Wherigo.ZMedia(i_love_Salzburg)
_keAY.Id = "417a25c5-4e4f-4037-8c36-a457e7e84a4a"
_keAY.Name = _pJ4N("cMe1\bB\027\023z\029Ye17(")
_keAY.Description = _pJ4N("R\029\bB}\beBg\029\bB\029Me1B\027\023z\029Ye17(\001")
_keAY.AltText = ""
_keAY.Resources = {
  {
    Type = "jpg",
    Filename = "14.jpg",
    Directives = {}
  }
}
_5yrc = Wherigo.ZMedia(i_love_Salzburg)
_5yrc.Id = "7b1d7812-540a-4e52-a6aa-356ec77b6fbd"
_5yrc.Name = _pJ4N("c7\b\b}o\teB(]\021")
_5yrc.Description = _pJ4N("R\029\bB}\beBg}1Bc7\b\b}o\teB(]\021\001")
_5yrc.AltText = ""
_5yrc.Resources = {
  {
    Type = "jpg",
    Filename = "4.jpg",
    Directives = {}
  }
}
_F0zPg = Wherigo.ZMedia(i_love_Salzburg)
_F0zPg.Id = "95963aad-3a0c-4a73-9629-ef96a3c6cd5b"
_F0zPg.Name = _pJ4N("?1\0031g}Ge}\0031YB-M\023\be1YBa\023\003\003X1Y0")
_F0zPg.Description = _pJ4N("R\029\bB}\beBg\029\bB?1\0031g}Ge}\0031YB-M\023\be1YBa\023\003\003X1Y0\001")
_F0zPg.AltText = ""
_F0zPg.Resources = {
  {
    Type = "jpg",
    Filename = "5.jpg",
    Directives = {}
  }
}
_6DNlu = Wherigo.ZMedia(i_love_Salzburg)
_6DNlu.Id = "f6e75f8c-16dc-4cd7-80b8-e2d33408cd73"
_6DNlu.Name = _pJ4N("?71Y01Y0\029Yg1")
_6DNlu.Description = _pJ4N("R\029\bB}\beBg}1B?71Y01Y0\029Yg1\001")
_6DNlu.AltText = ""
_6DNlu.Resources = {
  {
    Type = "jpg",
    Filename = "6.jpg",
    Directives = {}
  }
}
_XrQi = Wherigo.ZMedia(i_love_Salzburg)
_XrQi.Id = "9b072d2a-d100-4114-95a9-730123d3dc3a"
_XrQi.Name = _pJ4N("R\023(")
_XrQi.Description = _pJ4N("R\029\bB}\beBg1YBR\023(\001")
_XrQi.AltText = ""
_XrQi.Resources = {
  {
    Type = "jpg",
    Filename = "7.jpg",
    Directives = {}
  }
}
_IpEun = Wherigo.ZMedia(i_love_Salzburg)
_IpEun.Id = "39f1ae42-dfe2-4c10-826b-823083ae0c84"
_IpEun.Name = _pJ4N("/\00301ME}Ye\bXY7\003\0031\003")
_IpEun.Description = _pJ4N("R\029\bB}\beBg1YB/\00301ME}Ye\bXY7\003\0031\003\001")
_IpEun.AltText = ""
_IpEun.Resources = {
  {
    Type = "jpg",
    Filename = "28.jpg",
    Directives = {}
  }
}
_W4LCs = Wherigo.ZMedia(i_love_Salzburg)
_W4LCs.Id = "3dcf335a-cf16-490c-8a9c-484ffe04e9c0"
_W4LCs.Name = _pJ4N("/Y\t\029YgG}Yo\t1")
_W4LCs.Description = _pJ4N("R\029\bB}\beBg}1B/Y\t\029YgG}Yo\t1\001")
_W4LCs.AltText = ""
_W4LCs.Resources = {
  {
    Type = "jpg",
    Filename = "26.jpg",
    Directives = {}
  }
}
_CLIzB = Wherigo.ZMedia(i_love_Salzburg)
_CLIzB.Id = "181459aa-cb85-4ae1-affd-89ed73c32bd0"
_CLIzB.Name = _pJ4N(">1\be\b\030}1M\t\0297\b")
_CLIzB.Description = _pJ4N("R\029\bB}\beBg\029\bB>1\be\b\030}1M\t\0297\b\001")
_CLIzB.AltText = ""
_CLIzB.Resources = {
  {
    Type = "jpg",
    Filename = "8.jpg",
    Directives = {}
  }
}
_6nb = Wherigo.ZMedia(i_love_Salzburg)
_6nb.Id = "728d75ad-299a-4660-88c9-3aa2906b382b"
_6nb.Name = _pJ4N(">}\bo\tB-Y}10")
_6nb.Description = _pJ4N("R\029\bB}\beBg1YB>}\bo\tB-Y}10\001")
_6nb.AltText = ""
_6nb.Resources = {
  {
    Type = "jpg",
    Filename = "2.jpg",
    Directives = {}
  }
}
_8MSV = Wherigo.ZMedia(i_love_Salzburg)
_8MSV.Id = "406f990e-8599-4315-bd40-23dc2f52f7e1"
_8MSV.Name = _pJ4N(">M\023Y}\029\003}XY7\003\0031\003")
_8MSV.Description = _pJ4N("R\029\bB}\beBg1YB>M\023Y}\029\003}XY7\003\0031\003\001")
_8MSV.AltText = ""
_8MSV.Resources = {
  {
    Type = "jpg",
    Filename = "10.jpg",
    Directives = {}
  }
}
_dXrih = Wherigo.ZMedia(i_love_Salzburg)
_dXrih.Id = "4cfe8087-34c7-4a0d-841e-3196fc2c4175"
_dXrih.Name = _pJ4N(">Y\029\003z}\bG\029\0031YG}Yo\t1")
_dXrih.Description = _pJ4N("R\029\bB}\beBg}1B>Y\029\003z}\bG\029\0031YG}Yo\t1\001")
_dXrih.AltText = ""
_dXrih.Resources = {
  {
    Type = "jpg",
    Filename = "9.jpg",
    Directives = {}
  }
}
_l1c = Wherigo.ZMedia(i_love_Salzburg)
_l1c.Id = "a61f4a58-f2bb-4d04-8782-010134c5f877"
_l1c.Name = _pJ4N(">Y\029\003z}\bG}\bo\tM\0231\b\bM")
_l1c.Description = _pJ4N("R\029\bB}\beBg\029\bB>Y\029\003z}\bG}\bo\tM\0231\b\bM\001")
_l1c.AltText = ""
_l1c.Resources = {
  {
    Type = "jpg",
    Filename = "11.jpg",
    Directives = {}
  }
}
_FrfO = Wherigo.ZMedia(i_love_Salzburg)
_FrfO.Id = "2a054151-014e-43cf-90ae-4dfe37602545"
_FrfO.Name = _pJ4N(">Y1}\b\029\029M")
_FrfO.Description = _pJ4N("R\029\bB}\beBko\tM\023\b\bB>Y1}\b\029\029M\001")
_FrfO.AltText = ""
_FrfO.Resources = {
  {
    Type = "jpg",
    Filename = "31.jpg",
    Directives = {}
  }
}
_GBMIl = Wherigo.ZMedia(i_love_Salzburg)
_GBMIl.Id = "c7e2dd8b-af07-4978-baea-a4a690936ca2"
_GBMIl.Name = _pJ4N("x\023e1MBk\029o\t1Y")
_GBMIl.Description = _pJ4N("R\029\bB}\beBg\029\bBx\023e1MBk\029o\t1Y\001")
_GBMIl.AltText = ""
_GBMIl.Resources = {
  {
    Type = "jpg",
    Filename = "12.jpg",
    Directives = {}
  }
}
_W0wn = Wherigo.ZMedia(i_love_Salzburg)
_W0wn.Id = "8728158e-65b5-424c-bbdb-a177be11b7e4"
_W0wn.Name = _pJ4N("V\003\0031Y1\bB\024}\003z1Ye\023Y")
_W0wn.Description = _pJ4N("R\029\bB}\beBg\029\bBV\003\0031Y1B\024}\003z1Ye\023Y\001")
_W0wn.AltText = ""
_W0wn.Resources = {
  {
    Type = "jpg",
    Filename = "17.jpg",
    Directives = {}
  }
}
_6R4s4 = Wherigo.ZMedia(i_love_Salzburg)
_6R4s4.Id = "bfc1cbe0-e80d-4e95-9abb-cb301fcf0e34"
_6R4s4.Name = _pJ4N("V\003\0031Y1\bBke1}\003e\023Y")
_6R4s4.Description = _pJ4N("R\029\bB}\beBg\029\bBV\003\0031Y1Bke1}\003e\023Y\001")
_6R4s4.AltText = ""
_6R4s4.Resources = {
  {
    Type = "jpg",
    Filename = "29.jpg",
    Directives = {}
  }
}
_DdSg = Wherigo.ZMedia(i_love_Salzburg)
_DdSg.Id = "04212ee7-de72-469c-81f2-467a268f2143"
_DdSg.Name = _pJ4N("&7\be}z01X\02917g1")
_DdSg.Description = _pJ4N("R\029\bB}\beBg\029\bB&7\be}z01X\02917g1\001")
_DdSg.AltText = ""
_DdSg.Resources = {
  {
    Type = "jpg",
    Filename = "16.jpg",
    Directives = {}
  }
}
_tkL = Wherigo.ZMedia(i_love_Salzburg)
_tkL.Id = "4d7abbcb-4c14-4ba6-b019-5d9b69a29240"
_tkL.Name = _pJ4N("-\029\030}e1M\bo\tE\0291((1")
_tkL.Description = _pJ4N("R\029\bB}\beBg}1B-\029\030}e1M\bo\tE\0291((1\001")
_tkL.AltText = ""
_tkL.Resources = {
  {
    Type = "jpg",
    Filename = "15.jpg",
    Directives = {}
  }
}
_VG2 = Wherigo.ZMedia(i_love_Salzburg)
_VG2.Id = "07f5872d-5761-43e9-bb7f-797489a8ee1f"
_VG2.Name = _pJ4N("-\029e\029G\023(X1\003")
_VG2.Description = _pJ4N("R\029\bB\b}\003gBg}1B-\029e\029G\023(X1\003\001")
_VG2.AltText = ""
_VG2.Resources = {
  {
    Type = "jpg",
    Filename = "18.jpg",
    Directives = {}
  }
}
_WZJpj = Wherigo.ZMedia(i_love_Salzburg)
_WZJpj.Id = "66ff10bb-7f69-4fb1-a42c-1e2b68511962"
_WZJpj.Name = _pJ4N("-M\0297\b1\003e\023Y")
_WZJpj.Description = _pJ4N("R\029\bB}\beBg\029\bB-M\0297\b1\003e\023Y\001")
_WZJpj.AltText = ""
_WZJpj.Resources = {
  {
    Type = "jpg",
    Filename = "19.jpg",
    Directives = {}
  }
}
__jJo = Wherigo.ZMedia(i_love_Salzburg)
__jJo.Id = "36c69e23-4b38-4a80-a608-2f67ed5dd579"
__jJo.Name = _pJ4N("-\023MM10}1\003G}Yo\t1")
__jJo.Description = _pJ4N("R\029\bB}\beBg}1B-\023MM10}1\003G}Yo\t1\001")
__jJo.AltText = ""
__jJo.Resources = {
  {
    Type = "jpg",
    Filename = "20.jpg",
    Directives = {}
  }
}
_Y76 = Wherigo.ZMedia(i_love_Salzburg)
_Y76.Id = "cdb96efd-f373-4524-a2ce-317f9b4ffbb3"
_Y76.Name = _pJ4N("\024\029\003g1\be\t1\029e1Y")
_Y76.Description = _pJ4N("R\029\bB}\beBg\029\bB\024\029\003g1\be\t1\029e1Y\001")
_Y76.AltText = ""
_Y76.Resources = {
  {
    Type = "jpg",
    Filename = "21.jpg",
    Directives = {}
  }
}
_zF9U = Wherigo.ZMedia(i_love_Salzburg)
_zF9U.Id = "dcdc11dd-be44-4092-bbb2-704466d1f9a8"
_zF9U.Name = _pJ4N("x\023(\02901B\029\003B\027\023z\029Ye")
_zF9U.Description = _pJ4N("R\029\bB}\beBg}1Bx\023(\02901B\029\003B\027\023z\029Ye\001")
_zF9U.AltText = ""
_zF9U.Resources = {
  {
    Type = "jpg",
    Filename = "22.jpg",
    Directives = {}
  }
}
_4Zc8Q = Wherigo.ZMedia(i_love_Salzburg)
_4Zc8Q.Id = "28318a16-d34a-463b-930a-805bb1c44bb9"
_4Zc8Q.Name = _pJ4N("\027\029Y}\023\0031ee1\003e\t1\029e1Y")
_4Zc8Q.Description = _pJ4N("R\029\bB}\beBg\029\bB\027\029Y}\023\0031ee1\003e\t1\029e1Y\001")
_4Zc8Q.AltText = ""
_4Zc8Q.Resources = {
  {
    Type = "jpg",
    Filename = "13.jpg",
    Directives = {}
  }
}
_iC8 = Wherigo.ZMedia(i_love_Salzburg)
_iC8.Id = "1438ddaf-f0c9-4e2a-88b9-c970d24dd5fe"
_iC8.Name = _pJ4N("\027\029YG\023B>1}\0030\023MgBke10")
_iC8.Description = _pJ4N("R\029\bB}\beBg1YB\027\029YG\023B>1}\0030\023MgBke10\001")
_iC8.AltText = ""
_iC8.Resources = {
  {
    Type = "jpg",
    Filename = "1.jpg",
    Directives = {}
  }
}
_1qhzC = Wherigo.ZMedia(i_love_Salzburg)
_1qhzC.Id = "6da751ca-8928-40a7-a31e-bc65f3d437f0"
_1qhzC.Name = _pJ4N("\027\023z\029YeB:1X7Ye\b\t\0297\b")
_1qhzC.Description = _pJ4N("R\029\bB}\beB\027\023z\029Ye\bB:1X7Ye\b\t\0297\b\001")
_1qhzC.AltText = ""
_1qhzC.Resources = {
  {
    Type = "jpg",
    Filename = "3.jpg",
    Directives = {}
  }
}
_wBUX4 = Wherigo.ZMedia(i_love_Salzburg)
_wBUX4.Id = "f5491544-96b1-4026-a7a6-3b2d8e42deb1"
_wBUX4.Name = _pJ4N("\027\023z\029YeB\004\023\t\003\t\0297\b")
_wBUX4.Description = _pJ4N("R\029\bB}\beB\027\023z\029Ye\bB\004\023\t\003\t\0297\b\001")
_wBUX4.AltText = ""
_wBUX4.Resources = {
  {
    Type = "jpg",
    Filename = "23.jpg",
    Directives = {}
  }
}
_6ZAs = Wherigo.ZMedia(i_love_Salzburg)
_6ZAs.Id = "bc9f07fb-ade5-4621-8711-715edb88b681"
_6ZAs.Name = _pJ4N("\027\023z\029Ye\be\029e71")
_6ZAs.Description = _pJ4N("R\029\bB}\beBg}1B\027\023z\029Ye\be\029e71\001")
_6ZAs.AltText = ""
_6ZAs.Resources = {
  {
    Type = "jpg",
    Filename = "24.jpg",
    Directives = {}
  }
}
_yYlW = Wherigo.ZMedia(i_love_Salzburg)
_yYlW.Id = "ababd6ad-2cfb-4f68-ad19-848cc7a1378d"
_yYlW.Name = _pJ4N("\02771MM\0031YBke10")
_yYlW.Description = _pJ4N("R\029\bB}\beBg1YB\02771MM\0031YBke10\001")
_yYlW.AltText = ""
_yYlW.Resources = {
  {
    Type = "jpg",
    Filename = "25.jpg",
    Directives = {}
  }
}
_Xke9W = Wherigo.ZMedia(i_love_Salzburg)
_Xke9W.Id = "c2e612e6-4a28-4e77-97be-ab4a7fd4bb87"
_Xke9W.Name = _pJ4N("%\029\030\02901\003\023XY7\003\0031\003")
_Xke9W.Description = _pJ4N("R\029\bB}\beBg1YB%\029\030\02901\003\023XY7\003\0031\003\001")
_Xke9W.AltText = ""
_Xke9W.Resources = {
  {
    Type = "jpg",
    Filename = "40.jpg",
    Directives = {}
  }
}
_K8xI = Wherigo.ZMedia(i_love_Salzburg)
_K8xI.Id = "5dd80f7e-de8e-432e-8056-1fe77dbb609f"
_K8xI.Name = _pJ4N("%10\029\b7\bXY7\003\0031\003")
_K8xI.Description = _pJ4N("R\029\bB}\beBg1YB%10\029\b7\bXY7\003\0031\003\001")
_K8xI.AltText = ""
_K8xI.Resources = {
  {
    Type = "jpg",
    Filename = "39.jpg",
    Directives = {}
  }
}
_Pzb = Wherigo.ZMedia(i_love_Salzburg)
_Pzb.Id = "6bd9017e-ccfb-4ffa-916a-4f64c6600a5b"
_Pzb.Name = _pJ4N("%`1Yg1\bo\tE1((1")
_Pzb.Description = _pJ4N("R\029\bB}\beBg}1B%`1Yg1\bo\tE1((1\001")
_Pzb.AltText = ""
_Pzb.Resources = {
  {
    Type = "jpg",
    Filename = "37.jpg",
    Directives = {}
  }
}
_GDBdd = Wherigo.ZMedia(i_love_Salzburg)
_GDBdd.Id = "b5255293-0fc4-42c7-b828-1f52acbf16db"
_GDBdd.Name = _pJ4N("%M\029ezM")
_GDBdd.Description = _pJ4N("R\029\bB}\beBg\029\bB%M\029ezM\001")
_GDBdd.AltText = ""
_GDBdd.Resources = {
  {
    Type = "jpg",
    Filename = "36.jpg",
    Directives = {}
  }
}
_8Yz = Wherigo.ZMedia(i_love_Salzburg)
_8Yz.Id = "874bf0af-21f5-4cf2-b508-f504a6e86aa6"
_8Yz.Name = _pJ4N("s\029e\t\0297\b")
_8Yz.Description = _pJ4N("R\029\bB}\beBg\029\bBs\029e\t\0297\b\001")
_8Yz.AltText = ""
_8Yz.Resources = {
  {
    Type = "jpg",
    Filename = "35.jpg",
    Directives = {}
  }
}
_oGx1U = Wherigo.ZMedia(i_love_Salzburg)
_oGx1U.Id = "4187904c-2b6b-4ae2-a3fd-4ffc0b35d4c4"
_oGx1U.Name = _pJ4N("ko\tM\023\b\bBx1MMXY7\003\003")
_oGx1U.Description = _pJ4N("R\029\bB}\beBko\tM\023\b\bBx1MMXY7\003\003\001")
_oGx1U.AltText = ""
_oGx1U.Resources = {
  {
    Type = "jpg",
    Filename = "30.jpg",
    Directives = {}
  }
}
_WicD = Wherigo.ZMedia(i_love_Salzburg)
_WicD.Id = "8bb11b37-8c64-469a-b1b3-ec08d7c05141"
_WicD.Name = _pJ4N("k1X\029\be}\029\003\b`Y}1g\t\023`")
_WicD.Description = _pJ4N("R\029\bB}\beBg1YBk1X\029\be}\029\003\b`Y}1g\t\023`\001")
_WicD.AltText = ""
_WicD.Resources = {
  {
    Type = "jpg",
    Filename = "34.jpg",
    Directives = {}
  }
}
_vFkT3 = Wherigo.ZMedia(i_love_Salzburg)
_vFkT3.Id = "9d626748-8adf-4467-a223-1242ffb83bf3"
_vFkT3.Name = _pJ4N("ke\001B%1e1Y")
_vFkT3.Description = _pJ4N("R\029\bB}\beBke\001B%1e1Y\001")
_vFkT3.AltText = ""
_vFkT3.Resources = {
  {
    Type = "jpg",
    Filename = "38.jpg",
    Directives = {}
  }
}
_Avqpz = Wherigo.ZMedia(i_love_Salzburg)
_Avqpz.Id = "7d633bc9-099b-4281-8bcf-1d5016ae8ecf"
_Avqpz.Name = _pJ4N("P\023MG\b0\029Ye1\003")
_Avqpz.Description = _pJ4N("R\029\bB}\beBg1YBP\023MG\b0\029Ye1\003\001")
_Avqpz.AltText = ""
_Avqpz.Resources = {
  {
    Type = "jpg",
    Filename = "27.jpg",
    Directives = {}
  }
}
_M36x = Wherigo.ZMedia(i_love_Salzburg)
_M36x.Id = "69974c20-f71d-48a4-9717-9fc793fdb891"
_M36x.Name = _pJ4N("\002}\be1Y\0031")
_M36x.Description = _pJ4N("R\029\bB}\beBg}1B\002}\be1Y\0031\001")
_M36x.AltText = ""
_M36x.Resources = {
  {
    Type = "jpg",
    Filename = "33.jpg",
    Directives = {}
  }
}
_TJ2 = Wherigo.ZMedia(i_love_Salzburg)
_TJ2.Id = "06751f90-7520-425c-86b2-34de92f783bc"
_TJ2.Name = _pJ4N("\002E1Y01YM0\029Ye1\003")
_TJ2.Description = _pJ4N("R\029\bB}\beBg1YB\002E1Y01YM0\029Ye1\003\001")
_TJ2.AltText = ""
_TJ2.Resources = {
  {
    Type = "jpg",
    Filename = "32.jpg",
    Directives = {}
  }
}
_PdIg = Wherigo.ZMedia(i_love_Salzburg)
_PdIg.Id = "ff600a95-b66e-48c3-a91b-94f6abc8223f"
_PdIg.Name = _pJ4N("k\029MzX7Y0")
_PdIg.Description = _pJ4N("k\029MzX7Y0B?}MgB`71YB/}\003\be}10\001")
_PdIg.AltText = ""
_PdIg.Resources = {
  {
    Type = "jpg",
    Filename = "Salzburg.jpg",
    Directives = {}
  }
}
_gN5 = Wherigo.ZMedia(i_love_Salzburg)
_gN5.Id = "7fb2f60c-75d7-4617-8e70-0968abbd8450"
_gN5.Name = _pJ4N("cM\029Y(")
_gN5.Description = _pJ4N("cM\029Y(X}MgB`7YBk}(7M\029e\023Y\bo\t7ez")
_gN5.AltText = ""
_gN5.Resources = {
  {
    Type = "JPG",
    Filename = "Alarm.JPG",
    Directives = {}
  }
}
i_love_Salzburg.Id = "2d5c1300-190f-49ae-8c5b-513bcc17cc4b"
i_love_Salzburg.Name = "I Love Salzburg"
i_love_Salzburg.Description = [[
<BR>
<BR>
<BR>
Fuer diese Cartridge habe ich 40 verschiedene Sehenswuerdigkeiten in Salzburg definiert. Die meisten findest du in und um die Altstadt, manche etwas weiter weg. Je nach Bekanntheit und Entfernung zum Zentrum erhaeltst du eine Punktezahl zwischen 1 und 3. Sammle insgesamt 20 Punkte (von maximal 69) und die Cartridge wird dir die Finalkoordinaten verraten.<BR>
<BR>
Natuerlich kannst Du die Cartridge danach auch noch bis zum Ende weiterspielen und alle restlichen Sehenswuerdigkeiten suchen. Du erhaeltst weiterhin zusaetzliche Punkte, die allerdings auf den Spielverlauf keine weitere Auswirkung haben.<BR>
<BR>
Bei jeder Sehenswuerdigkeit ist eine grosszuegige Zone (meistens direkt vor dem Gebaeude/Objekt) definiert. Bist du bei einer Sehenswuerdigkeit, von der du glaubst, dass sie im Spiel enthalten ist, starte einfach den Whereigo-Player und schau nach. Das Spiel kann an jedem beliebigen Punkt in Salzburg gestartet werden. Speichere am besten nach jeder gefundenen Zone ab.]]
i_love_Salzburg.Visible = true
i_love_Salzburg.Activity = "TourGuide"
i_love_Salzburg.StartingLocationDescription = ""
i_love_Salzburg.StartingLocation = ZonePoint(47.800667, 13.0445, 0)
i_love_Salzburg.Version = "1.1"
i_love_Salzburg.Company = ""
i_love_Salzburg.Author = "chrisu36, tokope, Shari82"
i_love_Salzburg.BuilderVersion = "URWIGO 1.22.5798.37755"
i_love_Salzburg.CreateDate = "11/26/2024 15:03:57"
i_love_Salzburg.PublishDate = "1/1/0001 12:00:00 AM"
i_love_Salzburg.UpdateDate = "12/13/2024 19:53:31"
i_love_Salzburg.LastPlayedDate = "1/1/0001 12:00:00 AM"
i_love_Salzburg.TargetDevice = "PocketPC"
i_love_Salzburg.TargetDeviceVersion = "0"
i_love_Salzburg.StateId = "1"
i_love_Salzburg.CountryId = "2"
i_love_Salzburg.Complete = false
i_love_Salzburg.UseLogging = true
i_love_Salzburg.Media = _PdIg
_GxJT = Wherigo.Zone(i_love_Salzburg)
_GxJT.Id = "8cdee4ec-777c-4557-903f-d53f0e8b8438"
_GxJT.Name = _pJ4N(">}\003\029MB-\023\023Yg}\003\029e1\003")
_GxJT.Description = _pJ4N("R7B\t\029\beBg}1B\027}\003g1\be\029\003z\029\tMBg1YB%7\003Ge1B1YY1}o\te\001N?sWx}1YB\b}\003gBg}1B-\023\023Yg}\003\029e1\003Bg1\bBP1Y\be1oG\bKN?sWN?sWaBu_Bu\v\001bbuB/Bb\028]Bb\021\001\v\028b")
_GxJT.Visible = false
_GxJT.Media = _1Gkxa
_GxJT.Commands = {}
_GxJT.DistanceRange = Distance(-1, "feet")
_GxJT.ShowObjects = "OnEnter"
_GxJT.ProximityRange = Distance(60, "meters")
_GxJT.AllowSetPositionTo = false
_GxJT.Active = false
_GxJT.Points = {
  ZonePoint(47.8000560287713, 13.0468802645989, 0),
  ZonePoint(47.8000955107909, 13.0467543127487, 0),
  ZonePoint(47.8000432099274, 13.0467146188323, 0),
  ZonePoint(47.8000040159633, 13.0468442350656, 0)
}
_GxJT.OriginalPoint = ZonePoint(47.8000496913632, 13.0467983578114, 0)
_GxJT.DistanceRangeUOM = "Feet"
_GxJT.ProximityRangeUOM = "Meters"
_GxJT.OutOfRangeName = ""
_GxJT.InRangeName = ""
_0qv = Wherigo.Zone(i_love_Salzburg)
_0qv.Id = "1ddb1a78-f78a-4bc1-9b8e-8f44e3bfd002"
_0qv.Name = _pJ4N("cMe1\bB\027\023z\029Ye17(")
_0qv.Description = _pJ4N("c(B\021\021\001Bc\030Y}MB\028\vu\028BE7Yg1B}\003Bk\029MzX7Y0Bg1YB?R\023((7\b}G'1Y1}\003B7\003gB\027\023z\029Ye17(?B\029M\bB-\023\003\b1Y'\029e\023Y}7(B7\003gBz7YBk\029((M7\0030B\029Me1YB\027\023z\029Ye^R\023G7(1\003e1B010Y71\003g1e\001BV(B&\029\tYB\028\v\vbB0}\0030lB\0297\bBg1YB\029\003`\029\0030\bB1}\003`\029o\t1\003Bko\t7M`\023Y(lBg}1B\029(X}e}\023\003}1Ye1Y1BZ1``1\003eM}o\t1B\0277\b}G\bo\t7M1B\027\023z\029Ye17(B\t1Y'\023YlBg}1BP\023YM\02917`1Y}\003Bg1YB\t17e}01\003B-7\003\be\t\023o\t\bo\t7M1\001")
_0qv.Visible = false
_0qv.Media = _keAY
_0qv.Commands = {}
_0qv.DistanceRange = Distance(0, "meters")
_0qv.ShowObjects = "OnEnter"
_0qv.ProximityRange = Distance(60, "meters")
_0qv.AllowSetPositionTo = false
_0qv.Active = true
_0qv.Points = {
  ZonePoint(47.8035160697115, 13.0417566238775, 0),
  ZonePoint(47.8033696520886, 13.0420118219638, 0),
  ZonePoint(47.8033044904513, 13.041917983424, 0),
  ZonePoint(47.8034530685338, 13.0416626755819, 0)
}
_0qv.OriginalPoint = ZonePoint(47.8034108201963, 13.0418372762118, 0)
_0qv.DistanceRangeUOM = "Meters"
_0qv.ProximityRangeUOM = "Meters"
_0qv.OutOfRangeName = ""
_0qv.InRangeName = ""
_BGD = Wherigo.Zone(i_love_Salzburg)
_BGD.Id = "6f11747e-f94e-450c-b9a9-2a841d0d461a"
_BGD.Name = _pJ4N("c7\b\b}o\teB(]\021")
_BGD.Description = _pJ4N("P\023\003B\t}1YB\t\029\beBR7B1}\0031\003Be\023MM1\003Bc7\bXM}oGB7X1YBg}1Bke\029ge\001")
_BGD.Visible = false
_BGD.Media = _5yrc
_BGD.Commands = {}
_BGD.DistanceRange = Distance(0, "meters")
_BGD.ShowObjects = "OnEnter"
_BGD.ProximityRange = Distance(60, "meters")
_BGD.AllowSetPositionTo = false
_BGD.Active = true
_BGD.Points = {
  ZonePoint(47.8009641374818, 13.0386829839988, 0),
  ZonePoint(47.8009638068605, 13.0388972517401, 0),
  ZonePoint(47.8004584775609, 13.0388187488837, 0),
  ZonePoint(47.8004760992267, 13.0386206980737, 0)
}
_BGD.OriginalPoint = ZonePoint(47.8007156302825, 13.0387549206741, 0)
_BGD.DistanceRangeUOM = "Meters"
_BGD.ProximityRangeUOM = "Meters"
_BGD.OutOfRangeName = ""
_BGD.InRangeName = ""
_PZh = Wherigo.Zone(i_love_Salzburg)
_PZh.Id = "0ce995e9-4db4-4627-aceb-ff6acaf298e0"
_PZh.Name = _pJ4N("?1\0031g}Ge}\0031YGM\023\be1YBa\023\003\003X1Y0")
_PZh.Description = _pJ4N("ke}`eBa\023\003\003X1Y0lB\0297o\tB/Y}\003^-M\023\be1YB\003\029o\tBg1YB1Y\be1\003Bc1Xe}\b\b}\003B/Y1\003eY7g}\bB'\023\003Bk\029MzX7Y0lB}\beB1}\0031B?1\0031g}Ge}\0031Y}\003\0031\003\029Xe1}B}\003Bk\029MzX7Y0\001B/\bB}\beBg\029\bB\t17e1BE1MeE1}eB\0291Me1\be1Bo\tY}\beM}o\t1B>Y\02971\003GM\023\be1YB(}eB7\0037\003e1YXY\023o\t1\0031YB@Y\029g}e}\023\003\001N?sWN?sWR}1B:1\b\029(e\029\003M\02901Bke}`eBa\023\003\003X1Y0B(}eB\022((\02971Y7\00301\003B7\003gB\029Yo\t\0291\023M\0230}\bo\t1\003B>7\003g\t\023``\0037\0030\b01X}1e1\003B\be1\teB7\003e1YBR1\003G(\029M\bo\t7ezB7\003gB01\t\023YeBz7(B\022a/kSZ^\0041Me1YX1Bx}\be\023Y}\bo\t1\bB\0021\003eY7(Bg1YBke\029geBk\029MzX7Y0\001B")
_PZh.Visible = false
_PZh.Media = _F0zPg
_PZh.Commands = {}
_PZh.DistanceRange = Distance(0, "meters")
_PZh.ShowObjects = "OnEnter"
_PZh.ProximityRange = Distance(60, "meters")
_PZh.AllowSetPositionTo = false
_PZh.Active = true
_PZh.Points = {
  ZonePoint(47.7961371470877, 13.0517591406705, 0),
  ZonePoint(47.7961754332995, 13.0519890847201, 0),
  ZonePoint(47.7959016884489, 13.0520154641816, 0),
  ZonePoint(47.7958961413437, 13.0518068513387, 0)
}
_PZh.OriginalPoint = ZonePoint(47.7960276025449, 13.0518926352277, 0)
_PZh.DistanceRangeUOM = "Meters"
_PZh.ProximityRangeUOM = "Meters"
_PZh.OutOfRangeName = ""
_PZh.InRangeName = ""
_91rNA = Wherigo.Zone(i_love_Salzburg)
_91rNA.Id = "110b1786-1198-4f8b-8750-8f2160edd070"
_91rNA.Name = _pJ4N("?71Y01Y0\029Yg1")
_91rNA.Description = _pJ4N("R}1B?71Y01Y0\029Yg1Bg1YBke\029geBk\029MzX7Y0BXM}oGeB\0297`B1}\0031B\b1\tYBM\029\00301B:1\bo\t}o\te1B7\003gB@Y\029g}e}\023\003Bz7Y7oG\001N?sW?1Y1}e\bB\028\021\v_BE7Yg1\003Bg1\003B?71Y01Y\003Bk\029MzX7Y0\bB(}eBg1(Bk71\t\0031XY}1`B1Y\be(\029M\bB9\030\023M}e}\bo\t1\005Bs1o\te1Bz701\be\029\003g1\003\001N?sWc(B\021b\001Bc\030Y}MB\028\021\v_B7\003e1Yz1}o\t\0031e1B/YzX}\bo\t\023`Bs7g\023M`BV\001B'\023\003Bx\023\t1\003100Bg1\003B\003\029o\tBg1(Bs\029eBg1\bBk\029MzX7Y0BR\023(G\029\030}e1M\bBz7\be\029\003g1B01G\023((1\0031\003B7\003gB\029M\bBk71\t\0031XY}1`BX1z1}o\t\0031e1\003Bke\029ge`Y}1g1\003\001B/YBz\0230Bg\029(}eB1}\0031\003Bko\tM7\b\b\beY}o\tB7\003e1YBg}1B\b1}eB\028\021\v\031B7(B\b}o\tB0Y1}`1\003g1\003B7\003gBz7M1ezeB(}eB\004\029``1\00301E\029MeB\0297\b01eY\02901\0031\003Bc7\b1}\003\029\003g1Y\b1ez7\00301\003BzE}\bo\t1\003B\029Y(1\003B7\003gBY1}o\t1\003B?71Y01Y\003Bg1YBke\029geBk\029MzX7Y0\001BV(B\021\001B@1}MBg}1\b1\bBke\029ge`Y}1g1\003\bB`}\003g1eB\b}o\tBg\029\bB\0291Me1\be1BX1G\029\003\003e1Bke\029geY1o\teBg1YBke\029geBk\029MzX7Y0\001BR}1\b1YBke\029ge`Y}1g1\003BX1g17e1eB\0297o\tBg}1B:1X7Ye\b\be7\003g1Bg1YB?71Y01Y0\029Yg1lBg}1Bg\029(\029M\bB1}\0031B(}M}e\0291Y}\bo\t1B>7\003Ge}\023\003Bz7(Bko\t7ezBg1YBke\029geB}\003\0031B\t\029ee1\001Bi\003X\b\030Qi\003X\b\030Qi\003X\b\030Q")
_91rNA.Visible = false
_91rNA.Media = _6DNlu
_91rNA.Commands = {}
_91rNA.DistanceRange = Distance(0, "meters")
_91rNA.ShowObjects = "OnEnter"
_91rNA.ProximityRange = Distance(60, "meters")
_91rNA.AllowSetPositionTo = false
_91rNA.Active = true
_91rNA.Points = {
  ZonePoint(47.7987575486356, 13.0380344908552, 0),
  ZonePoint(47.7989024543756, 13.0383124572557, 0),
  ZonePoint(47.7987469810341, 13.0384836921088, 0),
  ZonePoint(47.7986042732828, 13.0382676472141, 0)
}
_91rNA.OriginalPoint = ZonePoint(47.798752814332, 13.0382745718584, 0)
_91rNA.DistanceRangeUOM = "Meters"
_91rNA.ProximityRangeUOM = "Meters"
_91rNA.OutOfRangeName = ""
_91rNA.InRangeName = ""
_NLRB = Wherigo.Zone(i_love_Salzburg)
_NLRB.Id = "5be66f9f-117b-46fd-a678-937f8507f834"
_NLRB.Name = _pJ4N("R\023(")
_NLRB.Description = _pJ4N("R1YB\t17e}01BR\023(B\t\029ee1BzE1}B(}ee1M\029Me1YM}o\t1BP\023Y0\0291\00301YlB'\023\003Bg1\0031\003Bs1\be1B}\003Bg1YB-Ym\030e\029Bz7B\b1\t1\003B\b}\003g\001BR1\003B1Y\be1\003BR\023(BE1}\te1Bg1YB\tM\001BP}Y0}MB}(B&\029\tYB__u\001B\022\003e1YB/YzX}\bo\t\023`Bx\029YeE}0B9nn\028BX}\b\028b\021]\005BE7Yg1Bg}1\b1YB?\0297B1YE1}e1YelB7\003e1YB/YzX}\bo\t\023`B-\023\003Y\029gBV\001B9\028\028b\031BX}\bB\028\028u_\005B(}eBzE1}B\0041\bee71Y(1\003B'1Y\b1\t1\003\001N?sWN?sW\028\028\031_BXY\029\003\003e1Bg1YB}(B-1Y\003B}((1YB\003\023o\tBG\029Y\023M}\0030}\bo\t1BR\023(B\003}1g1Y\001B/YzX}\bo\t\023`B-\023\003Y\029gBVVV\001B9\028\028__BX}\bB\028\028\v]\005BM}1\b\bBg\029Y\0297`\t}\003B1}\0031\003B01E\029Me}01\003lBY\023(\029\003}\bo\t1\003Ba17X\0297B1YY}o\te1\003lBg1YB\028\028bB(BM\029\0030BE\029YlB`71\003`B@71Y(1B\t\029ee1B7\003gBE\023\tMBg1\003BR\023(1\003B}\003B\027\029}\003zB7\003gB\004\023Y(\bB\0291\t\003M}o\t\b\029\t\001Ba\029o\tB1}\0031(BE1}e1Y1\003B'1Y\t11Y1\003g1\003B?Y\029\003gBE7Yg1B\028$n\vB\0297o\tB1YB\029X01Y}\b\b1\003\001BR1\003BcXXY7o\t\029YX1}e1\003B`}1MB\0297o\tBg\029\bBR\023(GM\023\be1YB}(Bk71g1\003Bg1\bBY\023(\029\003}\bo\t1\003BR\023(\bBz7(BZ\030`1YKB\b\023BG\023\003\003e1Bg1YB-\029\030}e1M\030M\029ezB1\003e\be1\t1\003\001BN?sWN?sWR1YB:Y7\003g\be1}\003Bg1\bBX\029Y\023oG1\003BR\023(\bBE7Yg1B\028\031\028uB'\023\003B/YzX}\bo\t\023`B\027\029Yo7\bBk}ee}o7\bB'\023\003Bx\023\t1\0031(\bB9\028\031\028\021BX}\bB\028\031\028n\005B01M10e\001B\028\031\021\vBE7Yg1Bg1YBR\023(Bg7Yo\tB/YzX}\bo\t\023`B%\029Y}\bB\024\023gY\023\003B9\028\031\028nBX}\bB\028\031$]\005B01E1}\telBg\023o\tB1Y\beBY7\003gB'}1Yz}0B&\029\tY1B\b\030\0291e1YBE\029Y1\003Bg}1B@71Y(1B7\003gB\0297o\tBg}1B7(01X1\003g1\003B%M\0291ez1B'\023MM1\003g1e\001")
_NLRB.Visible = false
_NLRB.Media = _XrQi
_NLRB.Commands = {}
_NLRB.DistanceRange = Distance(0, "meters")
_NLRB.ShowObjects = "OnEnter"
_NLRB.ProximityRange = Distance(60, "meters")
_NLRB.AllowSetPositionTo = false
_NLRB.Active = true
_NLRB.Points = {
  ZonePoint(47.7982590092613, 13.0457088960247, 0),
  ZonePoint(47.7981677773447, 13.0472557768448, 0),
  ZonePoint(47.7975403647848, 13.047195066882, 0),
  ZonePoint(47.7976458435079, 13.0456469690497, 0)
}
_NLRB.OriginalPoint = ZonePoint(47.7979032487247, 13.0464516772003, 0)
_NLRB.DistanceRangeUOM = "Meters"
_NLRB.ProximityRangeUOM = "Meters"
_NLRB.OutOfRangeName = ""
_NLRB.InRangeName = ""
_MQRX = Wherigo.Zone(i_love_Salzburg)
_MQRX.Id = "45ab2258-2c1f-49a7-8a76-b8dfe4912842"
_MQRX.Name = _pJ4N("/\00301ME}Ye\bXY7\003\0031\003")
_MQRX.Description = _pJ4N("\028\031n\031BM}1\b\bB>71Y\be1YzX}\bo\t\023`B&\023\t\029\003\003B/Y\003\beB:Y\029`B'\023\003B@\t7\003B7\003gBx\023\t1\003\be1}\003Bg}1\b1\003B?Y7\003\0031\003B\029\003B\b1}\0031(B1Y\be1\003Bke\029\003g\023YeB}\003Bg1YB\024}\003z1YB:\029\b\b1lB/oG1Bz7YBRY1}`\029Me}0G1}e\b0\029\b\b1lBX1}Bg1YB\029Me1\003Bke\001^c\003gY1\029\b^-}Yo\t1B1YX\02971\003\001B\028_$\028BE7Yg1B1YB\029\003B\b1}\0031\003BzE1}e1\003Bke\029\003g\023YeB}\003Bg}1Bke1}\0030\029\b\b1lB\003\029o\t\beBg1(B/\00301ME}YeB'1YM10e\001BR\023YeBE\029YB1YB/\003g1Bg1\bB\028n\001B&\029\tY\t7\003g1Ye\bBg1(B\be1e}0Bz7\0031\t(1\003g1\003BP1YG1\tYlBX1\b\023\003g1Y\bB\bo\tE1Y1\003B>7\tYE1YG1\003lB}(B\004101lB\b\023g\029\b\bB1YB\028\vnbB\029\003B\b1}\0031\003BgY}ee1\003Bke\029\003g\023YeB'1Y\b1ezeBE7Yg1\001B?}\bB1eE\029B\028\v]bB\t\029ee1B\t}1YBg\029\bBc17\b\b1Y1Bke1}\003e\023YB01\be\029\003g1\003\001")
_MQRX.Visible = false
_MQRX.Media = _IpEun
_MQRX.Commands = {}
_MQRX.DistanceRange = Distance(0, "meters")
_MQRX.ShowObjects = "OnEnter"
_MQRX.ProximityRange = Distance(60, "meters")
_MQRX.AllowSetPositionTo = false
_MQRX.Active = true
_MQRX.Points = {
  ZonePoint(47.8002365168566, 13.0532606865385, 0),
  ZonePoint(47.8002473638165, 13.0533850129285, 0),
  ZonePoint(47.8001794639553, 13.053406154025, 0),
  ZonePoint(47.8001670162245, 13.0532732550323, 0)
}
_MQRX.OriginalPoint = ZonePoint(47.8002075902132, 13.0533312771311, 0)
_MQRX.DistanceRangeUOM = "Meters"
_MQRX.ProximityRangeUOM = "Meters"
_MQRX.OutOfRangeName = ""
_MQRX.InRangeName = ""
_1Uc1 = Wherigo.Zone(i_love_Salzburg)
_1Uc1.Id = "bb419714-4d6d-46af-970e-fcba01098953"
_1Uc1.Name = _pJ4N("/Y\t\029YgG}Yo\t1")
_1Uc1.Description = _pJ4N("R}1B`Y71\t1Y1B0\023e}\bo\t1B/Y\t\029YgG\029\0301MM1BE7Yg1B1Y\be(\029M\bB\028ubuB1YE\0291\t\003e\001BR}1B-\029\0301MM1BE\029YB(}eBg1(B\003\0291o\t\beM}101\003g1\003B-Y\029\003G1\003\t\0297\bB'1YX7\003g1\003B7\003gB\b\023Bz71Y\beBE1\b1\003eM}o\tB\029M\bBk\030}e\029M\bG}Yo\t1B01\0037eze\001Bk}1BE\029YBX1Y1}e\bBg1(B\tM\001B/Y\t\029YglBg1(B%\029eY\023\003Bg1YB-Y\029\003G1\003B7\003gBcY(1\003B01E1}\te\001Bk}1BE7Yg1Bz71Y\beB\029M\bBk\030}e\029M\bG}Yo\t1Bg1\bB?1\0031g}Ge}\0031\003^>Y\02971\003\be}`e\bBa\023\003\003X1Y0B01\0037eze\001BR\029\bBk\030}e\029MB}\beB\028]\028bB\003\029o\tE1}\bX\029Y\001")
_1Uc1.Visible = false
_1Uc1.Media = _W4LCs
_1Uc1.Commands = {}
_1Uc1.DistanceRange = Distance(0, "meters")
_1Uc1.ShowObjects = "OnEnter"
_1Uc1.ProximityRange = Distance(60, "meters")
_1Uc1.AllowSetPositionTo = false
_1Uc1.Active = true
_1Uc1.Points = {
  ZonePoint(47.7952733449479, 13.0514655229791, 0),
  ZonePoint(47.7951979588365, 13.0515920398466, 0),
  ZonePoint(47.7949697998804, 13.0512923461727, 0),
  ZonePoint(47.7950429355569, 13.0511575595654, 0)
}
_1Uc1.OriginalPoint = ZonePoint(47.7951210098054, 13.0513768671409, 0)
_1Uc1.DistanceRangeUOM = "Meters"
_1Uc1.ProximityRangeUOM = "Meters"
_1Uc1.OutOfRangeName = ""
_1Uc1.InRangeName = ""
_R8gYH = Wherigo.Zone(i_love_Salzburg)
_R8gYH.Id = "daccba03-afa6-4de5-be0a-f094fea0013e"
_R8gYH.Name = _pJ4N(">1\be\b\030}1M\t\0297\b")
_R8gYH.Description = _pJ4N("R\029\bB:Y\023\b\b1B>1\be\b\030}1M\t\0297\bB01\t\0231Ye1Bz7\b\029((1\003B(}eBg1(Bx\0297\bB`71YB\027\023z\029YeB9}\001B1\001Bg1(B'\023Y(\029M\bB-M1}\0031\003B>1\be\b\030}1M\t\0297\b\005lBg1YB>1M\b1\003Y1}e\bo\t7M1B7\003gBg1(Bke\029ge\b\029\029MBz7Bg1\003B1\t1(\029M}01\003B`71Y\be^1YzX}\bo\t\0231`M}o\t1\003Bx\023`\be\029MM7\00301\003B9x\023`(\029Y\be\029MM\005\001Bk}1BE7Yg1\003B7\003e1YBg1(B/YzX}\bo\t\023`B\004\023M`BR}1eY}o\tB'\023\003Bs\029}e1\003\0297B\028\031b\031B7\003gB\028\031b_B1YX\0297elBz7YBc\003M\02901B01\t\0231Ye1B\0297o\tBg}1B\027\029Y\be\029MM\bo\tE1((1B\029(B\t17e}01\003Bx1YX1Ye^'\023\003^-\029Y\029.\029\003^%M\029ez\001B\028\031\031\021BE7Yg1Bg}1\b1YB?\0297B1YE1}e1YeB7\003gBg}1B\004}\003e1YY1}e\bo\t7M1B1}\00301Y}o\te1elB\029\003Bg1Y1\003Bke1MM1B\b}o\tB\t17e1Bg\029\bBx\0297\bB`71YB\027\023z\029YeBX1`}\003g1e\001B/}\003BE1}e1Y1YBc7\bX\0297B1Y`\023M0e1B7\003e1YB/YzX}\bo\t\023`B&\023\t\029\003\003B/Y\003\beB'\023\003B@\t7\003\001BR}1Bk\023((1YY1}e\bo\t7M1lBg}1B\t17e}01B>1M\b1\003Y1}e\bo\t7M1lB7\003gBg}1B>\029\b\b\029g1Bg1YB\003\0231YgM}o\t1Bko\t(\029M\b1}e1Bz7(Bx1YX1Ye^'\023\003^-\029Y\029.\029\003^%M\029ezB7\003gBz7YB\027\029Y\be\029MM\bo\tE1((1B\t}\003BE7Yg1\003B\003\029o\tB%M\0291\0031\003B'\023\003B&\023\t\029\003\003B?1Y\003\t\029YgB>}\bo\t1YB'\023\003B/YM\029o\tB\028\031n]\025nuB01\be\029Me1e\001B")
_R8gYH.Visible = false
_R8gYH.Media = _CLIzB
_R8gYH.Commands = {}
_R8gYH.DistanceRange = Distance(0, "meters")
_R8gYH.ShowObjects = "OnEnter"
_R8gYH.ProximityRange = Distance(60, "meters")
_R8gYH.AllowSetPositionTo = false
_R8gYH.Active = true
_R8gYH.Points = {
  ZonePoint(47.7987994282297, 13.0417597174407, 0),
  ZonePoint(47.7983564824586, 13.0424440132085, 0),
  ZonePoint(47.798220080394, 13.0422409719982, 0),
  ZonePoint(47.7986678382989, 13.0415502863327, 0)
}
_R8gYH.OriginalPoint = ZonePoint(47.7985109573453, 13.041998747245, 0)
_R8gYH.DistanceRangeUOM = "Meters"
_R8gYH.ProximityRangeUOM = "Meters"
_R8gYH.OutOfRangeName = ""
_R8gYH.InRangeName = ""
_u5G = Wherigo.Zone(i_love_Salzburg)
_u5G.Id = "3e832a3f-7e26-4282-a40f-b85cbe02ccb9"
_u5G.Name = _pJ4N(">}\bo\tB-Y}10")
_u5G.Description = _pJ4N("\028n\021\031BE7Yg1B'\023\003Bg1YBke\029ge01(1}\003g1Bk\029MzX7Y0B1}\003B:1X\02917g1B1YY}o\te1eB7\003gB\029\003Bg}1BX1}g1\003Bg\029(\029M\bBe\0291e}01\003B>}\bo\t\t\0291\003gM1YBk}(\023\003B\004}1\0031YY\023}e\t1YB7\003gB&\023\b1`Bx71XMB'1Y(}1e1e\001Bx17e1B}\beBg}1\b1\bBx\0297\bB\029M\bB?>}\bo\t^-Y}10?BX1G\029\003\003e\001")
_u5G.Visible = false
_u5G.Media = _6nb
_u5G.Commands = {}
_u5G.DistanceRange = Distance(0, "meters")
_u5G.ShowObjects = "OnEnter"
_u5G.ProximityRange = Distance(60, "meters")
_u5G.AllowSetPositionTo = false
_u5G.Active = true
_u5G.Points = {
  ZonePoint(47.8011473318133, 13.0424199639157, 0),
  ZonePoint(47.8010361016481, 13.0427429567982, 0),
  ZonePoint(47.8008841186578, 13.0426326267936, 0),
  ZonePoint(47.8009855016004, 13.0423003048676, 0)
}
_u5G.OriginalPoint = ZonePoint(47.8010132634299, 13.0425239630938, 0)
_u5G.DistanceRangeUOM = "Meters"
_u5G.ProximityRangeUOM = "Meters"
_u5G.OutOfRangeName = ""
_u5G.InRangeName = ""
_T0Bj = Wherigo.Zone(i_love_Salzburg)
_T0Bj.Id = "4eacb086-b03e-406a-9760-51d76edc3500"
_T0Bj.Name = _pJ4N(">M\023Y}\029\003}XY7\003\0031\003")
_T0Bj.Description = _pJ4N("R1YB>M\023Y}\029\003}XY7\003\0031\003B}\beB1}\0031YBg1YB\0291Me1\be1\003B?Y7\003\0031\003B}\003Bg1YBcMe\be\029geB'\023\003Bg1YBke\029geBk\029MzX7Y0B7\003gBz\0291\tMeBz7Bg1\003Bg1\003G(\029M01\bo\t71eze1\003BZX.1Ge1\003B}\003Bg1YBke\029geBk\029MzX7Y0\001BR\029\bB1Y\t\029Me1\0031B\029o\te\b1}e}01B?Y7\003\0031\003X1oG1\003BE7Yg1B\028\031\v$BX}\bB\028\031\v_B'\023\003Bke\029geX\0297(1}\be1YB?\029Ye\t\023M\023(\02917\bB?1Y0\029(}\003B1Y\003171YeB7\003gB}\beBY}\0030\b7(B(}eBzE1}B(\029Y(\023Y\0031\003B@Y1\030\0301\003\be7`1\003B7(01X1\003\001B/\bBX1\b}ezeBcG\029\003e\t7\bB01\bo\t(71oGe1B/oG\030`1}M1YB7\003gBs\023\b1ee1\003B\b\023E}1B1}\003Bz}1YM}o\t1\bBk\030}Y\029M0}ee1YlBg\029\bB\0297`Bg\029\bB\004\029\b\b1YX1oG1\003B\0297`01\b1ezeB}\beB7\003gB'\023\003B\004\023M`B:7\030\0301\003X1Y01YB\028$\v]B01\bo\t\029``1\003BE7Yg1\001BR\029\bB:}ee1YB}\beB(}eB'1Y\bo\t}1g1\0031\003BP1Yz}1Y7\00301\003B01\bo\t(71oGeBE}1B>}07Y1\003B\0297\bB/}\b1\003XM1o\tlBg}1B\004\029\030\0301\003B1}\0031\bB>71Y\be1YzX}\bo\t\023`1\blBg1YBke\029geB7\003gBg1\bB\024\029\003g1\bBk\029MzX7Y0QB1\bB0}XeB`M\023Y\029M1B\027\023e}'1B7\003gB1}\003B'1Y\be1oGe1\bBx7`1}\b1\003B'1YE1}\beB\029M\bB\0027\003`ez1}o\t1\003B\0297`Bg1\003Bko\t(}1glBg1YBg\029\bB:}ee1YB\t1Y01\be1MMeB\t\029ee1\001B")
_T0Bj.Visible = false
_T0Bj.Media = _8MSV
_T0Bj.Commands = {}
_T0Bj.DistanceRange = Distance(0, "meters")
_T0Bj.ShowObjects = "OnEnter"
_T0Bj.ProximityRange = Distance(60, "meters")
_T0Bj.AllowSetPositionTo = false
_T0Bj.Active = true
_T0Bj.Points = {
  ZonePoint(47.7994781416967, 13.0450905160766, 0),
  ZonePoint(47.7994416428348, 13.0453208395222, 0),
  ZonePoint(47.7993019253122, 13.0452803113015, 0),
  ZonePoint(47.7993407131354, 13.0450424767417, 0)
}
_T0Bj.OriginalPoint = ZonePoint(47.7993906057448, 13.0451835359105, 0)
_T0Bj.DistanceRangeUOM = "Meters"
_T0Bj.ProximityRangeUOM = "Meters"
_T0Bj.OutOfRangeName = ""
_T0Bj.InRangeName = ""
_MYf57 = Wherigo.Zone(i_love_Salzburg)
_MYf57.Id = "3b405373-83d4-44ad-a37c-9251623e460c"
_MYf57.Name = _pJ4N(">Y\029\003z}\bG\029\0031YG}Yo\t1")
_MYf57.Description = _pJ4N("R}1B1Y\be1B-}Yo\t1B\002\022B\022ak/s/sB\024V/?/aB>sc\022B}\beB'1Y(7eM}o\tB\0291Me1YB\029M\bBg1YBR\023(X\0297Bg1\bB\t1}M}01\003BP}Y0}M\001Bk}1BE7Yg1B\0297`B1}\0031YB`Y7\to\tY}\beM}o\t1\003B:1X1e\b\be\029ee1B1YY}o\te1e\001B\028$n\021B71X1Y0\029XB\004\023M`BR}1eY}o\tB'\023\003Bs\029}e1\003\0297Bg}1B-}Yo\t1Bg1\003B\00317B}\003\bB\024\029\003gB01Y7`1\0031\003B>Y\029\003z}\bG\029\0031Y\003B\029M\bB-M\023\be1YG}Yo\t1\001B\028\031]$BE7Yg1B\bo\tM}1?M}o\tBg1YBR\023(Bz7YB\003171\003B%`\029YYG}Yo\t1\001")
_MYf57.Visible = false
_MYf57.Media = _dXrih
_MYf57.Commands = {}
_MYf57.DistanceRange = Distance(0, "meters")
_MYf57.ShowObjects = "OnEnter"
_MYf57.ProximityRange = Distance(60, "meters")
_MYf57.AllowSetPositionTo = false
_MYf57.Active = true
_MYf57.Points = {
  ZonePoint(47.7983525825965, 13.0436447452684, 0),
  ZonePoint(47.798335226791, 13.0437841813614, 0),
  ZonePoint(47.7980767119737, 13.0437138956587, 0),
  ZonePoint(47.7980962046555, 13.0435613455489, 0)
}
_MYf57.OriginalPoint = ZonePoint(47.7982151815042, 13.0436760419593, 0)
_MYf57.DistanceRangeUOM = "Meters"
_MYf57.ProximityRangeUOM = "Meters"
_MYf57.OutOfRangeName = ""
_MYf57.InRangeName = ""
_EHO = Wherigo.Zone(i_love_Salzburg)
_EHO.Id = "9970cdd5-2851-40e6-8c40-e3a4a3a6f4d4"
_EHO.Name = _pJ4N(">Y\029\003z}\bG}\bo\tM\0231\b\bM")
_EHO.Description = _pJ4N("/YY}o\te1eBE7Yg1Bg\029\bB>Y\029\003z}\bG}\bo\tM\0231\b\bMB'\023\003B/YzX}\bo\t\023`B%\029Y}\bB'\023\003B\024\023gY\023\003B\028\031\021nB}(BRY1}\b\b}0.\0291\tY}01\003B-Y}10lB\029M\bBk\029MzX7Y0Bg}1BE\023\tMBX1\be'1Ye1}g}0e1Bke\029geB\027}ee1M17Y\023\030\029\bBE\029Y\001B/YX\0297eBE7Yg1B1\bB\029M\bB@1}MBg1YB\0041\tY\029\003M\02901B(}eB\b1}\0031YB1Y\t\029Me1\0031\003B1eE\029B]BG(BM\029\00301\003B>1\be7\0030\b(\02971YB}(Bk71g1\003B7\003gBZ\be1\003lB(}eB:1\bo\t71ezX\029\be}\023\0031\003B}(B\0041\be1\003B7\003gB(}eB\bG\029Y\030}1Ye1\003B9G71\003\beM}o\tB\0297`01\be1}Me1\003\005B>1M\b1\003B}(Ba\023Yg1\003B\b\029(eBg1\003Bg\023Ye}01\003BzE1}B:1\bo\t71ezX\029\be1}1\003B9:Y\023\b\b1YB7\003gB-M1}\0031YB\024}\003z1YB-\029'\029M}1Y\005Bz7YBk}o\t1Y7\0030Bg1\bB-\029\0307z}\0031YX1Y01\bB7\003gBg1YBke\029geBk\029MzX7Y0\001")
_EHO.Visible = false
_EHO.Media = _l1c
_EHO.Commands = {}
_EHO.DistanceRange = Distance(0, "meters")
_EHO.ShowObjects = "OnEnter"
_EHO.ProximityRange = Distance(60, "meters")
_EHO.AllowSetPositionTo = false
_EHO.Active = true
_EHO.Points = {
  ZonePoint(47.8073402901222, 13.0652629122545, 0),
  ZonePoint(47.8073728088337, 13.0656459515413, 0),
  ZonePoint(47.8072018437959, 13.0657361784522, 0),
  ZonePoint(47.8071640783, 13.0653377333066, 0)
}
_EHO.OriginalPoint = ZonePoint(47.8072697552629, 13.0654956938887, 0)
_EHO.DistanceRangeUOM = "Meters"
_EHO.ProximityRangeUOM = "Meters"
_EHO.OutOfRangeName = ""
_EHO.InRangeName = ""
_GVUat = Wherigo.Zone(i_love_Salzburg)
_GVUat.Id = "f38e8442-d30a-4e14-a806-87866afeafe8"
_GVUat.Name = _pJ4N(">Y1}\b\029\029M")
_GVUat.Description = _pJ4N("R\029\bBGM1}\0031Bko\tM\023\b\bBE7Yg1B\028]n\021B1Y\be(\029M\bB7YG7\003gM}o\tB1YE\0291\t\003e\001B/\bBg}1\003e1BX1Y1}e\bBg1(B>71Y\be1YzX}\bo\t\023`\bB%}M0Y}(BVV\001B'\023\003B%7o\t\t1}(B\029M\bB\0247\be\t\0297\blB\0297o\tBg}1B\b\030\0291e1Y1\003B>71Y\be1YzX}\bo\t\0231`1B\0037eze1\003B1\bB\029M\bB\024\029\003g\b}ez\001BR1YB?1\b}ezB}\beB\t17e1B}\003B\030Y}'\029e1YBx\029\003gB7\003gB\003}o\teB\0231``1\003eM}o\tBz70\0291\0030M}o\t\001")
_GVUat.Visible = false
_GVUat.Media = _FrfO
_GVUat.Commands = {}
_GVUat.DistanceRange = Distance(0, "meters")
_GVUat.ShowObjects = "OnEnter"
_GVUat.ProximityRange = Distance(60, "meters")
_GVUat.AllowSetPositionTo = false
_GVUat.Active = true
_GVUat.Points = {
  ZonePoint(47.7870324968678, 13.0568122094118, 0),
  ZonePoint(47.7870801120506, 13.0570598277706, 0),
  ZonePoint(47.7868370920424, 13.057197796886, 0),
  ZonePoint(47.7867818121297, 13.0569600721623, 0)
}
_GVUat.OriginalPoint = ZonePoint(47.7869328782726, 13.0570074765577, 0)
_GVUat.DistanceRangeUOM = "Meters"
_GVUat.ProximityRangeUOM = "Meters"
_GVUat.OutOfRangeName = ""
_GVUat.InRangeName = ""
_Ws3r4 = Wherigo.Zone(i_love_Salzburg)
_Ws3r4.Id = "e845a690-2d08-4789-af78-bef741fd49ee"
_Ws3r4.Name = _pJ4N("x\023((\02901B\029\003B\027\023z\029Ye")
_Ws3r4.Description = _pJ4N("rx\023((\02901B\029\003B\027\023z\029YerB}\beB1}\003B-7\003\beE1YGlBg\029\bBg1YB-71\003\beM1YB\027\029YG7\bB\02471\0301YezB\029M\bB'}1Ye1\bB-7\003\be\030Y\023.1GeB\021bb$B}(Bc7`eY\0290Bg1YBk\029MzX7Y0B>\0237\003g\029e}\023\003B`71YBk\029MzX7Y0B01\bo\t\029``1\003B\t\029eB7\003gB}(Bs\029\t(1\003Bg1\bB\004\029MGB\023`B\027\023g1Y\003BcYeB`Y1}Bz70\0291\0030M}o\tB}\be\001BR}1BkG7M\030e7YB\be1\teB\029(B\022Y\b7M}\0031\003\030M\029ezB7\003gB\b\023Y0e1B\003\029o\tB}\tY1YBc7`\be1MM7\0030B`71YBc7`Y107\0030\001B")
_Ws3r4.Visible = false
_Ws3r4.Media = _zF9U
_Ws3r4.Commands = {}
_Ws3r4.DistanceRange = Distance(0, "meters")
_Ws3r4.ShowObjects = "OnEnter"
_Ws3r4.ProximityRange = Distance(60, "meters")
_Ws3r4.AllowSetPositionTo = false
_Ws3r4.Active = true
_Ws3r4.Points = {
  ZonePoint(47.8023640384053, 13.0382912918353, 0),
  ZonePoint(47.802382202087, 13.0384545791145, 0),
  ZonePoint(47.8022612539203, 13.0384952786798, 0),
  ZonePoint(47.8022387337079, 13.0383262995119, 0)
}
_Ws3r4.OriginalPoint = ZonePoint(47.8023115570301, 13.0383918622854, 0)
_Ws3r4.DistanceRangeUOM = "Meters"
_Ws3r4.ProximityRangeUOM = "Meters"
_Ws3r4.OutOfRangeName = ""
_Ws3r4.InRangeName = ""
_15v = Wherigo.Zone(i_love_Salzburg)
_15v.Id = "a6c15a99-ea8b-48ec-be40-762fa83e155d"
_15v.Name = _pJ4N("x\023e1MBk\029o\t1Y")
_15v.Description = _pJ4N("R\029\bBx\023e1MBE\029YB7Y\b\030Y71\0030M}o\tB1eE\029B\t\029MXB\b\023B0Y\023?BE}1B\t17e1\001B/\bB7(`\029\b\be1B\031\031B>Y1(g1\003z}((1Y\001B\028nu$BX}\bB\028n$$BE7Yg1Bg\029\bBx\023e1MB'\023\003Bg1YB\029(1Y}G\029\003}\bo\t1\003B?1\b\029ez7\0030\b(\029o\teB\029M\bBZ``}z}1Y\b\t\023e1MB}\003Bc\003\b\030Y7o\tB01\003\023((1\003\001BR}1B\002}((1YB\b}\003gB(}eBZY}0}\003\029M01(\0291Mg1\003lBc\003e}U7}e\0291e1\003lB@1\030\030}o\t1\003B7\003gBk1}g1\003e\029\0301e1\003Bg1G\023Y}1Ye\001B:1(1}\003\b\029(B(}eBg1(Bx\023e1MBk\029o\t1YB\004}1\003BX1\t1YX1Y0eBg\029\bBx\023e1MB1}\0031Bg1YB0Y\023\b\be1\003B\030Y}'\029e1\003B-7\003\be\b\029((M7\00301\003B}\003BZ1\be1YY1}o\t\001B")
_15v.Visible = false
_15v.Media = _GBMIl
_15v.Commands = {}
_15v.DistanceRange = Distance(0, "meters")
_15v.ShowObjects = "OnEnter"
_15v.ProximityRange = Distance(60, "meters")
_15v.AllowSetPositionTo = false
_15v.Active = true
_15v.Points = {
  ZonePoint(47.8025323993863, 13.043062550331, 0),
  ZonePoint(47.8021924236588, 13.0436031385172, 0),
  ZonePoint(47.8021035188892, 13.0435140190673, 0),
  ZonePoint(47.8024683278214, 13.0428911013049, 0)
}
_15v.OriginalPoint = ZonePoint(47.8023241674389, 13.0432677023051, 0)
_15v.DistanceRangeUOM = "Meters"
_15v.ProximityRangeUOM = "Meters"
_15v.OutOfRangeName = ""
_15v.InRangeName = ""
_Rkb = Wherigo.Zone(i_love_Salzburg)
_Rkb.Id = "24ea92c1-acb1-4f10-95bf-a742f4c0f4b8"
_Rkb.Name = _pJ4N("V\003\0031Y1\bB\024}\003z1Ye\023Y")
_Rkb.Description = _pJ4N("R\029\bBV\003\0031Y1B\024}\003z1Ye\023YlB\0297o\tBke\001Bk1X\029\be}\029\003\be\023YB\023g1YB:\029M01\003e\023YB01\003\029\003\003elBE\029YB\029M\bBke\029gee\023YB@1}MBg1YBke\029geX1`1\be}07\0030B}\003Bg1YBY1o\te\b7`Y}01\003BcMe\be\029geBg1YBke\029geBk\029MzX7Y0\001B")
_Rkb.Visible = false
_Rkb.Media = _W0wn
_Rkb.Commands = {}
_Rkb.DistanceRange = Distance(0, "meters")
_Rkb.ShowObjects = "OnEnter"
_Rkb.ProximityRange = Distance(60, "meters")
_Rkb.AllowSetPositionTo = false
_Rkb.Active = true
_Rkb.Points = {
  ZonePoint(47.8043261017564, 13.0482753754715, 0),
  ZonePoint(47.80440439272, 13.0485115727643, 0),
  ZonePoint(47.8042761993618, 13.0485955254841, 0),
  ZonePoint(47.8042016267287, 13.0483606861389, 0)
}
_Rkb.OriginalPoint = ZonePoint(47.8043020801417, 13.0484357899647, 0)
_Rkb.DistanceRangeUOM = "Meters"
_Rkb.ProximityRangeUOM = "Meters"
_Rkb.OutOfRangeName = ""
_Rkb.InRangeName = ""
_NpH_1 = Wherigo.Zone(i_love_Salzburg)
_NpH_1.Id = "221e7c73-2c71-4635-83d0-06d50d265e3f"
_NpH_1.Name = _pJ4N("V\003\0031Y1\bBke1}\003e\023Y")
_NpH_1.Description = _pJ4N("R\029\bBke1}\003e\023YBE7Yg1B1eE\029B}(B&\029\tYB\028\021\vbBz7\b\029((1\003B(}eBg1YB1Y\be1\003Bke\029ge(\02971YB1YY}o\te1eB7\003gBE\029YBg7Yo\tB1}\0031B71X1YBg}1B>1M\b1\003B\be1}MB\t}\003\0297``71\tY1\003g1B\0041\tY(\02971YB(}eBg1(B@Y\023(\0301e1Y\bo\tM\0231\b\bMB'1YX7\003g1\003B7\003gBE\029YB'\023\003Bc\003X10}\003\003BE\023\tMB(}eB1}\0031YB\00270XY71oG1B\0297\b01\be\029ee1e\001")
_NpH_1.Visible = false
_NpH_1.Media = _6R4s4
_NpH_1.Commands = {}
_NpH_1.DistanceRange = Distance(0, "meters")
_NpH_1.ShowObjects = "OnEnter"
_NpH_1.ProximityRange = Distance(60, "meters")
_NpH_1.AllowSetPositionTo = false
_NpH_1.Active = true
_NpH_1.Points = {
  ZonePoint(47.8011179462559, 13.046548895468, 0),
  ZonePoint(47.8011234896068, 13.0468410822796, 0),
  ZonePoint(47.8010555496728, 13.0468568778568, 0),
  ZonePoint(47.8010456779107, 13.0465463801178, 0)
}
_NpH_1.OriginalPoint = ZonePoint(47.8010856658616, 13.0466983089306, 0)
_NpH_1.DistanceRangeUOM = "Meters"
_NpH_1.ProximityRangeUOM = "Meters"
_NpH_1.OutOfRangeName = ""
_NpH_1.InRangeName = ""
_Oj5 = Wherigo.Zone(i_love_Salzburg)
_Oj5.Id = "42b48cc7-568c-4c14-afe5-acb570ea456b"
_Oj5.Name = _pJ4N("&7\be}z01X\02917g1")
_Oj5.Description = _pJ4N("cM\bBg\029\bB\003171B&7\be}z01X\02917g1Bk\029MzX7Y0B}(B&\029\tY1B\028nbnBX1z\02301\003BE7Yg1lB71X1Y\b}1g1Me1\003Bg\029\bB?1z}YG\b01Y}o\telBg\029\bBX}\bBg\029\t}\003B}\003Bg1YB-\029}0\029\b\b1B7\003e1Y01XY\029o\teBE\029YlB7\003gBg\029\bB\024\029\003g1\b01Y}o\teB01(1}\003\b\029(B}\003Bg\029\bB\003171B:1X\02917g1\001B\024\029\00301B\0021}eBE\029YB01\0037101\003gB%M\029ezB`71YB\024\029\003g1\b01Y}o\telB?1z}YG\b01Y}o\teB7\003gBke\029\029e\b\029\003E\029Me\bo\t\029`eB'\023Y\t\029\003g1\003\001BV\003Bg1\003B\031b1YB&\029\tY1\003BE7Yg1B1\bB\029X1YB1\0030B}(B:1X\02917g1\001B7\003gB1\bBE7Yg1B7(`\029\b\b1\003gB\b\029\003}1Ye\001Bk1}eBa\023'1(X1YB\021b\028\vB}\beBg\029\bB01\b\029(e1B\024\029\003g1\b01Y}o\teB(}eBg1YBke\029\029e\b\029\003E\029Me\bo\t\029`eB}(B\00317B1Y\beY\029\tMe1\003B:1X\02917g1G\023(\030M1\nBs7g\023M`\b\030M\029ezB\021B7\003e1Y01XY\029o\te\001")
_Oj5.Visible = false
_Oj5.Media = _DdSg
_Oj5.Commands = {}
_Oj5.DistanceRange = Distance(0, "meters")
_Oj5.ShowObjects = "OnEnter"
_Oj5.ProximityRange = Distance(60, "meters")
_Oj5.AllowSetPositionTo = false
_Oj5.Active = true
_Oj5.Points = {
  ZonePoint(47.79714819353, 13.0517855544126, 0),
  ZonePoint(47.797510002316, 13.052659452465, 0),
  ZonePoint(47.7970989258664, 13.0536804447066, 0),
  ZonePoint(47.7964314651674, 13.0536174375206, 0),
  ZonePoint(47.796548262326, 13.0525217410404, 0),
  ZonePoint(47.7967527276787, 13.0515696973127, 0)
}
_Oj5.OriginalPoint = ZonePoint(47.7969149294807, 13.0526390545763, 0)
_Oj5.DistanceRangeUOM = "Meters"
_Oj5.ProximityRangeUOM = "Meters"
_Oj5.OutOfRangeName = ""
_Oj5.InRangeName = ""
_nzDeb = Wherigo.Zone(i_love_Salzburg)
_nzDeb.Id = "b2284425-adb3-4fc2-908e-5e0553892393"
_nzDeb.Name = _pJ4N("-\029\030}e1M\bo\tE1((1")
_nzDeb.Description = _pJ4N("V(B\028_\001B&\029\tY\t7\003g1YeBM\0290B\003\029\t1Bg1YB\027}ee1Bz7(B%M\029ezB1}\0031B1}\003`\029o\tB01\be\029Me1e1B%`1Yg1\bo\tE1((1lBg}1B(}eBg1(B>M7101MY\023\b\bB%10\029\b7\bB01\bo\t(71oGeBE\029Y\001N?sW\028_]\021BE7Yg1B7\003e1YB>71Y\be1YzX}\bo\t\023`B>}Y(}\029\003B\be\029eeBg1YBko\tE1((1B\b\029(eB?Y7\003\0031\003B1}\0031B'\0231MM}0B\00317B01\be\029Me1e1B%`1Yg1\bo\tE1((1lBg}1B\t17e}01B-\029\030}e1M\bo\tE1((1lB1YY}o\te1e\001Bk}1BE7Yg1B\029(B_\001B&7\003}B\028_]\021B'\023MM1\003g1e\001")
_nzDeb.Visible = false
_nzDeb.Media = _tkL
_nzDeb.Commands = {}
_nzDeb.DistanceRange = Distance(0, "meters")
_nzDeb.ShowObjects = "OnEnter"
_nzDeb.ProximityRange = Distance(60, "meters")
_nzDeb.AllowSetPositionTo = false
_nzDeb.Active = true
_nzDeb.Points = {
  ZonePoint(47.7972604152853, 13.0463853579513, 0),
  ZonePoint(47.7972591287103, 13.0470277416741, 0),
  ZonePoint(47.7968672695214, 13.0470618014229, 0),
  ZonePoint(47.7968768268323, 13.046408945022, 0)
}
_nzDeb.OriginalPoint = ZonePoint(47.7970659100873, 13.0467209615176, 0)
_nzDeb.DistanceRangeUOM = "Meters"
_nzDeb.ProximityRangeUOM = "Meters"
_nzDeb.OutOfRangeName = ""
_nzDeb.InRangeName = ""
_L5mE = Wherigo.Zone(i_love_Salzburg)
_L5mE.Id = "3b14a7d9-3e7d-468d-872f-7bc7d9f447db"
_L5mE.Name = _pJ4N("-\029e\029G\023(X1\003")
_L5mE.Description = _pJ4N("R}1B-\029e\029G\023(X1\003B\b}\003gB\b1\tYB\029Me1B-\029\0301MM1\003B\b\029(eB1}\0031YB/}\003\b}1g1M1}lBg}1B\029M\bBx\0231\tM1\003B1}\003\beB71X1YBg1(Bke\001B%1e1YB>Y}1g\t\023`B}\003Bg1\003B\027\0231\003o\t\bX1Y0^>1M\b1\003B\t}\0031}\003B01\t\02971\003BE7Yg1\003\001BR}1\b1B-\029e\029G\023(X1\003Bg}1\003e1\003BE\023\tMB\003}o\teB\029M\bB?10Y\0291X\003}\b\023YelB\b}1B\b}\003gB'}1MM1}o\teBX1Y1}e\bB\b\030\0291e\029\003e}G1\003B\022Y\b\030Y7\0030\b\001")
_L5mE.Visible = false
_L5mE.Media = _VG2
_L5mE.Commands = {}
_L5mE.DistanceRange = Distance(0, "meters")
_L5mE.ShowObjects = "OnEnter"
_L5mE.ProximityRange = Distance(60, "meters")
_L5mE.AllowSetPositionTo = false
_L5mE.Active = true
_L5mE.Points = {
  ZonePoint(47.7968923483305, 13.0445945124065, 0),
  ZonePoint(47.7967382648285, 13.044940603253, 0),
  ZonePoint(47.7965327855915, 13.044825344406, 0),
  ZonePoint(47.7967415292551, 13.0444196958966, 0)
}
_L5mE.OriginalPoint = ZonePoint(47.7967262320014, 13.0446950389905, 0)
_L5mE.DistanceRangeUOM = "Meters"
_L5mE.ProximityRangeUOM = "Meters"
_L5mE.OutOfRangeName = ""
_L5mE.InRangeName = ""
_RJ37B = Wherigo.Zone(i_love_Salzburg)
_RJ37B.Id = "a118bd6f-faa2-4fe5-9d42-f8aacb30502e"
_RJ37B.Name = _pJ4N("-M\0297\b1\003e\023Y")
_RJ37B.Description = _pJ4N("R\029\bB\004\023YeBr-M\0297\b1rlB\029Me\t\023o\tg17e\bo\tBrGM7\b\029rB}\beB\0297\bBg1(B\024\029e1}\003}\bo\t1\003B1\003eM1\t\003eB7\003gBX1g17e1eBr\029X01\bo\tM\023\b\b1\0031YBs\0297(rlBrE1Me\029X01\bo\t}1g1\0031B?1\t\0297\b7\0030rlB/}\003\b}1g1M1}lB\t}1YB\029X1YKBcX\b\0301YY7\0030lB9keY\029\b\b1\003^\005k\0301YY1\001BR\029\bB\003\029e71YM}o\t1B>M7\b\bX1eeB7\003gBg}1B\b1\tYB\bo\t(\029M1B\022`1Yz\023\0031Bg1YBk\029Mz\029o\tBY1}o\te1B}\003B\t}\be\023Y}\bo\t1YB\0021}eBX}\bB\029\003Bg1\003B>7?Bg1\bB\027\0231\003o\t\bX1Y01\bB\t1Y\029\003\001BR}1B/\0030\be1MM1BE\029YB\b1\tYB07eBz7YBk}o\t1Y7\0030Bg1YBke\029geB011}0\0031e\001")
_RJ37B.Visible = false
_RJ37B.Media = _WZJpj
_RJ37B.Commands = {}
_RJ37B.DistanceRange = Distance(0, "meters")
_RJ37B.ShowObjects = "OnEnter"
_RJ37B.ProximityRange = Distance(60, "meters")
_RJ37B.AllowSetPositionTo = false
_RJ37B.Active = true
_RJ37B.Points = {
  ZonePoint(47.8033838107266, 13.0376698131306, 0),
  ZonePoint(47.8034667589124, 13.0379775881613, 0),
  ZonePoint(47.8029720628121, 13.0382603450745, 0),
  ZonePoint(47.8028848534758, 13.0379311830197, 0)
}
_RJ37B.OriginalPoint = ZonePoint(47.8031768714817, 13.0379597323465, 0)
_RJ37B.DistanceRangeUOM = "Meters"
_RJ37B.ProximityRangeUOM = "Meters"
_RJ37B.OutOfRangeName = ""
_RJ37B.InRangeName = ""
_mJNBt = Wherigo.Zone(i_love_Salzburg)
_mJNBt.Id = "e0f038fc-8686-49fd-a083-284aec346063"
_mJNBt.Name = _pJ4N("-\023MM10}1\003G}Yo\t1")
_mJNBt.Description = _pJ4N("R}1B-\023MM10}1\003G}Yo\t1lB\0297o\tB\022\003}'1Y\b}e\0291e\bG}Yo\t1B01\003\029\003\003elB}\beBg}1Bg1YB\022\003}'1Y\b}e\0291eBk\029MzX7Y0B7\003gBg1\003B\004}\b\b1\003\bo\t\029`e1\003B01E}g(1e1B%`\029YYG}Yo\t1Bg1YB\022\003}'1Y\b}e\0291e\b\030`\029YY1Bg1YB/Yzg}\0231z1\b1Bk\029MzX7Y0\001Bk}1Bz\0291\tMeBz7Bg1\003Bg1\003G(\029M01\bo\t71eze1\003BZX.1Ge1\003B}\003Bg1YBke\029ge\001B")
_mJNBt.Visible = false
_mJNBt.Media = __jJo
_mJNBt.Commands = {}
_mJNBt.DistanceRange = Distance(0, "meters")
_mJNBt.ShowObjects = "OnEnter"
_mJNBt.ProximityRange = Distance(60, "meters")
_mJNBt.AllowSetPositionTo = false
_mJNBt.Active = true
_mJNBt.Points = {
  ZonePoint(47.7995663476354, 13.0430110791436, 0),
  ZonePoint(47.7994555584304, 13.0436807446569, 0),
  ZonePoint(47.799220876462, 13.0435633841988, 0),
  ZonePoint(47.7993367260708, 13.0429009262373, 0)
}
_mJNBt.OriginalPoint = ZonePoint(47.7993948771497, 13.0432890335591, 0)
_mJNBt.DistanceRangeUOM = "Meters"
_mJNBt.ProximityRangeUOM = "Meters"
_mJNBt.OutOfRangeName = ""
_mJNBt.InRangeName = ""
_Ufrn = Wherigo.Zone(i_love_Salzburg)
_Ufrn.Id = "c56c5d95-f08c-49ee-9920-16f07bb2a7fc"
_Ufrn.Name = _pJ4N("\024\029\003g1\be\t1\029e1Y")
_Ufrn.Description = _pJ4N(">71Y\be1YzX}\bo\t\023`B%\029Y}\bB:Y\029`B\024\023gY\023\003BM}1?B\029\003Bg1YBke1MM1Bg1\bB\t17e}01\003B@\t1\029e1Y\bB1}\003B?\029MM\t\0297\bBz7(B\002E1oG1Bg1\bB?\029MM\b\030}1M\bB1YX\02971\003\001BR\029\bB\029M\bB1}\003Bem\030}\bo\t1\bB\024\02301\003e\t1\029e1YB\b1}\0031YB\0021}eB1YX\0297e1B@\t1\029e1YB1YE}1\bB\b}o\tB\bo\t\023\003BX\029MgB\029M\bBz7BGM1}\003B7\003gBE7Yg1BX1Y1}e\bB\028_\v\v\025\028_\vnB7(01X\0297e\001B/\bB`\023M0e1\003BX}\bB}\003Bg}1B\t17e}01B\0021}eB}((1YBE}1g1YB\022(X\0297e1\003B7\003gB\027\023g1Y\003}\b}1Y7\00301\003\001")
_Ufrn.Visible = false
_Ufrn.Media = _Y76
_Ufrn.Commands = {}
_Ufrn.DistanceRange = Distance(0, "meters")
_Ufrn.ShowObjects = "OnEnter"
_Ufrn.ProximityRange = Distance(60, "meters")
_Ufrn.AllowSetPositionTo = false
_Ufrn.Active = true
_Ufrn.Points = {
  ZonePoint(47.8027478566122, 13.0429166651265, 0),
  ZonePoint(47.8029096910341, 13.0432064604788, 0),
  ZonePoint(47.8028176385892, 13.0433496146039, 0),
  ZonePoint(47.802655756763, 13.0430584338597, 0)
}
_Ufrn.OriginalPoint = ZonePoint(47.8027827357496, 13.0431327935172, 0)
_Ufrn.DistanceRangeUOM = "Meters"
_Ufrn.ProximityRangeUOM = "Meters"
_Ufrn.OutOfRangeName = ""
_Ufrn.InRangeName = ""
_ksqNz = Wherigo.Zone(i_love_Salzburg)
_ksqNz.Id = "5536fc93-9237-4442-a207-2f8411472d1a"
_ksqNz.Name = _pJ4N("\027\029Y}\023\0031ee1\003e\t1\029e1Y")
_ksqNz.Description = _pJ4N("R\029\bBk\029MzX7Y01YB\027\029Y}\023\0031ee1\003e\t1\029e1YB}\beB1}\003B\b1}eB\028n\028]BX1\be1\t1\003g1\bB>}07Y1\003e\t1\029e1YlBg\029\bB\b1}\0031\003Bk}ezB\b1}eB\028n_\028B}\003Bg1YBko\tE\029Yz\beY\029?1B\021uB}\003Bk\029MzX7Y0B\t\029e\001B\0027B\b1}\0031(Bs1\0301Ye\023}Y1Bz\0291\tM1\003B\029X1\003g`71MM1\003g1B\0277\b}Ge\t1\029e1Y^B7\003gBko\t\0297\b\030}1M\030Y\023g7Ge}\023\0031\003B\b\023E}1B`\029(}M}1\00301Y1o\te1B-7Yz'\023Y\be1MM7\00301\003B7\003gB\027\0291Yo\t1\003\001")
_ksqNz.Visible = false
_ksqNz.Media = _4Zc8Q
_ksqNz.Commands = {}
_ksqNz.DistanceRange = Distance(0, "meters")
_ksqNz.ShowObjects = "OnEnter"
_ksqNz.ProximityRange = Distance(60, "meters")
_ksqNz.AllowSetPositionTo = false
_ksqNz.Active = true
_ksqNz.Points = {
  ZonePoint(47.8032123986662, 13.0421898101529, 0),
  ZonePoint(47.8030732831148, 13.0424458962211, 0),
  ZonePoint(47.80302507722, 13.042358739418, 0),
  ZonePoint(47.8031649111896, 13.0421146509982, 0)
}
_ksqNz.OriginalPoint = ZonePoint(47.8031189175477, 13.0422772741976, 0)
_ksqNz.DistanceRangeUOM = "Meters"
_ksqNz.ProximityRangeUOM = "Meters"
_ksqNz.OutOfRangeName = ""
_ksqNz.InRangeName = ""
_eES = Wherigo.Zone(i_love_Salzburg)
_eES.Id = "cb41312a-4d15-444a-83d8-74419fe44f83"
_eES.Name = _pJ4N("\027\029YG\023^>1}\0030\023Mg^ke10")
_eES.Description = _pJ4N("R1YB1Y\be1B:1\t^ke10BX1\be\029\003gB\0297\bB1}\0031YB/}\b1\003^-\023\003\beY7Ge}\023\003B}(B&701\003g\be}MB\0297`BzE1}B%`1}M1Y\003B9E}1Bg1YB\027\023z\029Ye\be10\005B7\003gBE7Yg1B\029(B\028\v\001B&7\003}B\028nb$Bg1YB?1\0037ez7\0030B71X1Y01X1\003\001BR\029\bB\027\0297e\0297`\b1\t1Y^x\02917\bo\t1\003B9gY1}B(\029MBgY1}B\0271e1YB}(B:1'}1Ye\005BE7Yg1B\029(B>Y\029\003z^&\023\b1`^-\029}B1YY}o\te1e\001BR}1B\027\0297e01X71\tYBX1eY70BzE1}Bx1MM1Y\001N?sW")
_eES.Visible = false
_eES.Media = _iC8
_eES.Commands = {}
_eES.DistanceRange = Distance(0, "meters")
_eES.ShowObjects = "OnEnter"
_eES.ProximityRange = Distance(60, "meters")
_eES.AllowSetPositionTo = false
_eES.Active = true
_eES.Points = {
  ZonePoint(47.8019661747993, 13.0421378773451, 0),
  ZonePoint(47.8019135585764, 13.042364599633, 0),
  ZonePoint(47.8015663538556, 13.042228466566, 0),
  ZonePoint(47.8016068098958, 13.041990590223, 0)
}
_eES.OriginalPoint = ZonePoint(47.8017632242818, 13.0421803834418, 0)
_eES.DistanceRangeUOM = "Meters"
_eES.ProximityRangeUOM = "Meters"
_eES.OutOfRangeName = ""
_eES.InRangeName = ""
_49SY0 = Wherigo.Zone(i_love_Salzburg)
_49SY0.Id = "854b601e-429a-4ed8-ad8b-e8d5a9c8a6bc"
_49SY0.Name = _pJ4N("\027\023z\029YeB:1X7Ye\b\t\0297\b")
_49SY0.Description = _pJ4N("R\029\bBx\02901\003\02971Y\t\0297\bB}\beB1}\003B1\t1(\029M}01\bB\004\023\t\00301X\02917g1B}\003Bg1YB:1eY1}g10\029\b\b1BnB}\003Bg1YBM}\003G1\003BcMe\be\029geB'\023\003Bk\029MzX7Y0\001BV(BgY}ee1\003BZX1Y01\bo\t\023\b\bBE7Yg1B\029(B\021_\001B&\029\003\0031YB\028_$\031Bg1YBE1MeX1Y7\t(e1B\0277\b}G1YB7\003gB-\023(\030\023\003}\beB\004\023M`0\029\0030Bc(\029g17\bB\027\023z\029YeB01X\023Y1\003\001")
_49SY0.Visible = false
_49SY0.Media = _1qhzC
_49SY0.Commands = {}
_49SY0.DistanceRange = Distance(0, "meters")
_49SY0.ShowObjects = "OnEnter"
_49SY0.ProximityRange = Distance(60, "meters")
_49SY0.AllowSetPositionTo = false
_49SY0.Active = true
_49SY0.Points = {
  ZonePoint(47.8001454280521, 13.0433653171888, 0),
  ZonePoint(47.800132690989, 13.0436284053606, 0),
  ZonePoint(47.8000455365957, 13.0436218223997, 0),
  ZonePoint(47.8000547394804, 13.0433430107791, 0)
}
_49SY0.OriginalPoint = ZonePoint(47.8000945987793, 13.0434896389321, 0)
_49SY0.DistanceRangeUOM = "Meters"
_49SY0.ProximityRangeUOM = "Meters"
_49SY0.OutOfRangeName = ""
_49SY0.InRangeName = ""
_88QP = Wherigo.Zone(i_love_Salzburg)
_88QP.Id = "be47c5a0-900e-4dd0-9b42-adfdf39ea785"
_88QP.Name = _pJ4N("\027\023z\029YeB\004\023\t\003\t\0297\b")
_88QP.Description = _pJ4N("\027\023z\029YeB\bo\tY}1XB}\003Bg}1\b1(Bx\0297\b1B7\003e1YB\029\003g1Y1(B'\023\003B\028__]BX}\bB\028_\vbBkm(\030\t\023\003}1\003lBrR}'1Ye}(1\003e}rlBk1Y1\003\029g1\003lB-M\029'}1Y^B7\003gBP}\023M}\003G\023\003z1Ye1lB1}\003B>\0290\023eeG\023\003z1YelBcY}1\003lB\0271\b\b1\003B7\003gB\029\003g1Y1BG}Yo\t1\003(7\b}G\029M}\bo\t1B\0041YG1\001B/YBG\023(\030\023\003}1Ye1B\t}1YBrVMBs1B\030\029\be\023Y1rB-PB\021b\vlBX10\029\003\003Br\024\029B>}\003e\029B0}\029Yg}\003}1Y\029rB-PB\028n\031B7\003gBrVg\023(1\0031\023rB-PB]\031\031\001B")
_88QP.Visible = false
_88QP.Media = _wBUX4
_88QP.Commands = {}
_88QP.DistanceRange = Distance(0, "meters")
_88QP.ShowObjects = "OnEnter"
_88QP.ProximityRange = Distance(60, "meters")
_88QP.AllowSetPositionTo = false
_88QP.Active = true
_88QP.Points = {
  ZonePoint(47.8028819645473, 13.0439780675106, 0),
  ZonePoint(47.8027577950411, 13.0440550937378, 0),
  ZonePoint(47.8026366641698, 13.0437141666815, 0),
  ZonePoint(47.8027649729536, 13.0436201946845, 0)
}
_88QP.OriginalPoint = ZonePoint(47.8027603491779, 13.0438418806536, 0)
_88QP.DistanceRangeUOM = "Meters"
_88QP.ProximityRangeUOM = "Meters"
_88QP.OutOfRangeName = ""
_88QP.InRangeName = ""
_zcC = Wherigo.Zone(i_love_Salzburg)
_zcC.Id = "b1177678-cbaa-4527-b026-4b21c2471ce0"
_zcC.Name = _pJ4N("\027\023z\029Ye\be\029e71")
_zcC.Description = _pJ4N("\027\023z\029YeBE}YgB(}eB1}\0031(Bs\023oGB7\003gBM\029\00301(B\027\029\003e1MB01z1}0elBg1YBY1o\te1B>7\b\bB\be71ezeB\b}o\tB\0297`B1}\0031\003B>1M\b1\003B\029M\bBkm(X\023MB`7YBx1}(\029e\001BV\003Bg1YBM}\003G1\003Bx\029\003gB\t\0291MeB1YB1}\0031Bko\tY}`eY\023MM1lB}\003Bg1YBY1o\te1\003Bx\029\003gB1}\0031\003Bko\tY1}X0Y}``1M\001BR}1BcMM10\023Y}1\003B\0297`Bg1(Bk\023oG1MB\bm(X\023M}\b}1Y1\003B\027\023z\029Ye\bB\004}YG1\003B`7YBg}1B-}Yo\t1\003^lBg}1B-\023\003z1Ye^lBg}1B-\029((1Y(7\b}GB7\003gBg}1BZ\0301Y\001B")
_zcC.Visible = false
_zcC.Media = _6ZAs
_zcC.Commands = {}
_zcC.DistanceRange = Distance(0, "meters")
_zcC.ShowObjects = "OnEnter"
_zcC.ProximityRange = Distance(60, "meters")
_zcC.AllowSetPositionTo = false
_zcC.Active = true
_zcC.Points = {
  ZonePoint(47.7989473324749, 13.0476586375547, 0),
  ZonePoint(47.7989620510746, 13.0479346208476, 0),
  ZonePoint(47.7988023498583, 13.0479623502893, 0),
  ZonePoint(47.7987865846611, 13.0476809651991, 0)
}
_zcC.OriginalPoint = ZonePoint(47.7988745795172, 13.0478091434727, 0)
_zcC.DistanceRangeUOM = "Meters"
_zcC.ProximityRangeUOM = "Meters"
_zcC.OutOfRangeName = ""
_zcC.InRangeName = ""
_qv55 = Wherigo.Zone(i_love_Salzburg)
_qv55.Id = "11e01afe-7f43-4c02-b66a-b4a9f0d14ae0"
_qv55.Name = _pJ4N("\02771MM\0031YBke10")
_qv55.Description = _pJ4N("?}\bB\027}ee1Bg1YB\028\v\031b1Y^&\029\tY1B0\029XB1\bB\0037YB1}\0031B1}\003z}01Bk\029Mz\029o\tXY71oG1B}\003Bg1YBke\029geBk\029MzX7Y0lBg}1Bke\029geXY71oG1\001BR\029\t1YBE7Yg1B71X1YBcMe1Y\003\029e}'1\003B\003\029o\t01g\029o\te\001Bc(B\028\001B\027\029}B\028\v\031nBE7Yg1Bg}1\b1YBke10Bz71Y\beB\029M\bB\030Y\023'}\b\023Y}\bo\t1YB\t\0231Mz1Y\0031YBke10B1Y\0231``\0031e\001BcM\bB\003\0291o\t\be1\bB`\023M0e1Bg}1Bke1}\003\be}101Bz7(B-\029}B\t}\0037\003e1Y\001BR1YB`\023M01\003g1Bg\02971Y\t\029`e1Bke10B(}eBzE1}B\be1}\0031Y\0031\003B%`1}M1Y\003BE7Yg1B\029(B\028$\001Bk1\030e1(X1YB\028\v_\vB7\003e1YBg1(Bg\029(\029M}01\003Ba\029(1\003B>Y\029\003z^-\029YM^:1\tXY71oG1lBX1\003\029\003\003eB\003\029o\tBg1(BP\029e1YB'\023\003B-\029}\b1YB>Y\029\003zB&\023\b1\030\tBV\001lB1Y\0231``\0031e\001Bc1\t\003M}o\tBE}1BX1}(B1}\003\be}01\003B\0277\b17(\b\be10B9\t17e1B\027\029YG\023^>1}\0030\023Mg^ke10\005B7\003gBX1}(B\027\023z\029Ye\be10BX1`\029\003gB\b}o\tB\0031X1\003Bg1(Bke10B1}\003B\027\0297e1}\003\0031\t(1Y\t\02917\bo\t1\003lBE\023Bg}1B?Y71oG1\003X1\00371ez1YB1}\0031\003B-Y17z1YBz7B1\003eY}o\te1\003B\t\029ee1\003\001BR}1B?Y71oG1\003(\0297eBE7Yg1BX}\bB\028\vn\vB1}\00301\t\023X1\003\001")
_qv55.Visible = false
_qv55.Media = _yYlW
_qv55.Commands = {}
_qv55.DistanceRange = Distance(0, "meters")
_qv55.ShowObjects = "OnEnter"
_qv55.ProximityRange = Distance(60, "meters")
_qv55.AllowSetPositionTo = false
_qv55.Active = true
_qv55.Points = {
  ZonePoint(47.8051031487439, 13.0375954058834, 0),
  ZonePoint(47.8051924962386, 13.0380666868558, 0),
  ZonePoint(47.8051035974668, 13.0381088792785, 0),
  ZonePoint(47.8050094295774, 13.037633592449, 0)
}
_qv55.OriginalPoint = ZonePoint(47.8051021680067, 13.0378511411167, 0)
_qv55.DistanceRangeUOM = "Meters"
_qv55.ProximityRangeUOM = "Meters"
_qv55.OutOfRangeName = ""
_qv55.InRangeName = ""
_0Uk2T = Wherigo.Zone(i_love_Salzburg)
_0Uk2T.Id = "12e62b81-265d-419d-929c-2cc2161e0fb4"
_0Uk2T.Name = _pJ4N("%\029\030\02901\003\023XY7\003\0031\003")
_0Uk2T.Description = _pJ4N("R}1B\0297`Bg1(B?Y7\003\0031\003B\be1\t1\003g1B?Y\023\003z1\bG7M\030e7YBz1}0eBg}1B>}07YBg1\bBP\02301M`\0291\00301Y\bB%\029\030\02901\003\023B\0297\bBg1YBr\002\0297X1Y`M\0231e1rB'\023\003B\004\023M`0\029\0030Bc(\029g17\bB\027\023z\029Ye\001N?sWN?sWk}1BE7Yg1B}(B&\029\tYB\028n\031bB'\023\003Bg1YBk\029MzX7Y01YB?}Mg\t\02971Y}\003Bx}Mg1Bx101YB901X\001B\028\vnnQB01\be\001B\028nn\v\005B01\bo\t\029``1\003B7\003gBz\0291\tMeBz7Bg1Y1\003BX1G\029\003\003e1\be1\003B7\003gBX1M}1Xe1\be1\003B\0041YG1\003\001B")
_0Uk2T.Visible = false
_0Uk2T.Media = _Xke9W
_0Uk2T.Commands = {}
_0Uk2T.DistanceRange = Distance(0, "meters")
_0Uk2T.ShowObjects = "OnEnter"
_0Uk2T.ProximityRange = Distance(60, "meters")
_0Uk2T.AllowSetPositionTo = false
_0Uk2T.Active = true
_0Uk2T.Points = {
  ZonePoint(47.7983401008126, 13.0493173117026, 0),
  ZonePoint(47.7983482086986, 13.0495466405734, 0),
  ZonePoint(47.7982148788571, 13.0495580399617, 0),
  ZonePoint(47.7982112753431, 13.0493253583296, 0)
}
_0Uk2T.OriginalPoint = ZonePoint(47.7982786159278, 13.0494368376418, 0)
_0Uk2T.DistanceRangeUOM = "Meters"
_0Uk2T.ProximityRangeUOM = "Meters"
_0Uk2T.OutOfRangeName = ""
_0Uk2T.InRangeName = ""
_nusCY = Wherigo.Zone(i_love_Salzburg)
_nusCY.Id = "d7584088-43a9-4020-8b9a-99f16e4e0ee8"
_nusCY.Name = _pJ4N("%10\029\b7\bXY7\003\0031\003")
_nusCY.Description = _pJ4N("R}1B?Y\023\003z1\030M\029\be}GBg1\bB01`7101Me1\003B%`1Yg1\bB\014%10\029\b7\b\014BE\029YB7Y\b\030Y71\0030M}o\tB@1}MBg1YB-\029\030}e1M\bo\tE1((1B\029(B-\029\030}e1M\030M\029ezlBG\029(B\b\030\0291e1YB\0297`Bg1\003B\027}Y\029X1MM\030M\029ezB\029M\bB@1}MBg1YB\027}Y\029X1MM\bo\tE1((1B7\003gB}\beB\b1}eB\028n\028]B\029M\bB\014%10\029\b7\bXY7\003\0031\003\014B\029(B\t17e}01\003Bke\029\003g\023YeB}(B\027}Y\029X1MM0\029Ye1\003B}(BGM1}\0031\003B:\029Ye1\003\030\029Ye1YY1\001B")
_nusCY.Visible = false
_nusCY.Media = _K8xI
_nusCY.Commands = {}
_nusCY.DistanceRange = Distance(0, "meters")
_nusCY.ShowObjects = "OnEnter"
_nusCY.ProximityRange = Distance(60, "meters")
_nusCY.AllowSetPositionTo = false
_nusCY.Active = true
_nusCY.Points = {
  ZonePoint(47.8054312832955, 13.0411870815384, 0),
  ZonePoint(47.8055001188752, 13.041489904378, 0),
  ZonePoint(47.8052944004698, 13.0416045912027, 0),
  ZonePoint(47.8052188323895, 13.0413043583572, 0)
}
_nusCY.OriginalPoint = ZonePoint(47.8053611587575, 13.0413964838691, 0)
_nusCY.DistanceRangeUOM = "Meters"
_nusCY.ProximityRangeUOM = "Meters"
_nusCY.OutOfRangeName = ""
_nusCY.InRangeName = ""
_TnuM = Wherigo.Zone(i_love_Salzburg)
_TnuM.Id = "85f1b3a3-1d52-4712-b610-56081cda976e"
_TnuM.Name = _pJ4N("%`1Yg1\bo\tE1((1")
_TnuM.Description = _pJ4N("\028\031n$BX}\bB\028\031n\031BM}1?B>71Y\be1YzX}\bo\t\023`B&\023\t\029\003\003B/Y\003\beB:Y\029`B@\t7\003B\t}1YB}(B\002701Bg1YB/YE1}e1Y7\0030Bg1\bBx\023`(\029Y\be\029MM1\bB1}\0031Bko\tE1((1B9?\029g\005B`7YBg}1B%`1Yg1B\003\029o\tB%M\0291\0031\003B'\023\003B&\023\t\029\003\003B?1Y\003\t\029YgB>}\bo\t1YB'\023\003B/YM\029o\tB1YY}o\te1\003\001B\0041}MB\029(B\027\0231\003o\t\bX1Y0B\bo\t\023\003Bg1YBko\t71eeG\029\be1\003B`7YBg1\003B\027\029Y\be\029MMB\be\029\003glBE7Yg1Bg}1B%`1Yg1\bo\tE1((1B(}eB1}\0031YB1}01\0031\003Bs71oGE\029\003gB'1Y\b1\t1\003lB7(Bg}1\b1\003Bz7B'1YX1Y01\003\001")
_TnuM.Visible = false
_TnuM.Media = _Pzb
_TnuM.Commands = {}
_TnuM.DistanceRange = Distance(0, "meters")
_TnuM.ShowObjects = "OnEnter"
_TnuM.ProximityRange = Distance(60, "meters")
_TnuM.AllowSetPositionTo = false
_TnuM.Active = true
_TnuM.Points = {
  ZonePoint(47.7995907825751, 13.0402325780573, 0),
  ZonePoint(47.7993692253854, 13.0406507435321, 0),
  ZonePoint(47.7992226849374, 13.0404600648376, 0),
  ZonePoint(47.7994889205605, 13.0400717302165, 0)
}
_TnuM.OriginalPoint = ZonePoint(47.7994179033646, 13.0403537791609, 0)
_TnuM.DistanceRangeUOM = "Meters"
_TnuM.ProximityRangeUOM = "Meters"
_TnuM.OutOfRangeName = ""
_TnuM.InRangeName = ""
_Nv9Yj = Wherigo.Zone(i_love_Salzburg)
_Nv9Yj.Id = "c1770a17-4cbf-4e31-a538-85e65133e92b"
_Nv9Yj.Name = _pJ4N("%M\029ezM")
_Nv9Yj.Description = _pJ4N("\004\023M`BR}1eY}o\tB'\023\003Bs\029}e1\003\0297BM}1?B\028$n\vBg}1Bke\029\029e\bXY7oG1B'1YM101\003lB\b}1BX1`\029\003gB\b}o\tB'\023Y\t1YBzE}\bo\t1\003Bg1YB-M\029(\030`1Y1Y0\029\b\b1B7\003gBg1(B:}\b1M\029G\029}lBg\029\bB%M\029ezMBX}Mg1e1Bg\029\003\003Bg1\003B\003171\003B?Y71oG1\003G\023\030`\001")
_Nv9Yj.Visible = false
_Nv9Yj.Media = _GDBdd
_Nv9Yj.Commands = {}
_Nv9Yj.DistanceRange = Distance(0, "meters")
_Nv9Yj.ShowObjects = "OnEnter"
_Nv9Yj.ProximityRange = Distance(60, "meters")
_Nv9Yj.AllowSetPositionTo = false
_Nv9Yj.Active = true
_Nv9Yj.Points = {
  ZonePoint(47.8017687041248, 13.045087615113, 0),
  ZonePoint(47.801631545342, 13.0452747964698, 0),
  ZonePoint(47.8014174345033, 13.0449721679197, 0),
  ZonePoint(47.8015496041884, 13.0448126985853, 0)
}
_Nv9Yj.OriginalPoint = ZonePoint(47.8015918220396, 13.045036819522, 0)
_Nv9Yj.DistanceRangeUOM = "Meters"
_Nv9Yj.ProximityRangeUOM = "Meters"
_Nv9Yj.OutOfRangeName = ""
_Nv9Yj.InRangeName = ""
_IQWp = Wherigo.Zone(i_love_Salzburg)
_IQWp.Id = "aef26cdf-2a09-42ac-9da2-bf2068fe7e79"
_IQWp.Name = _pJ4N("s\029e\t\0297\b")
_IQWp.Description = _pJ4N("R\029\bBs\029e\t\0297\bBg1YBke\029geBk\029MzX7Y0B}\003Bg1YBk\029MzX7Y01YBcMe\be\029geB}\beB1}\003B'}1Y01\bo\t\023\b\b}01\bB:1X\02917g1B(}eBs\023G\023G\023`\029\b\b\029g1B7\003gB1}\0031(Bg\029\bBke\029geX}MgB\030Y\029101\003g1\003lBo\t\029Y\029Ge1Y}\be}\bo\t1\003BGM1}\0031\003B@7Y(\001B/\bBz\0291\tMeBz7Bg1\003Bg1\003G(\029M01\bo\t71eze1\003BZX.1Ge1\003B}\003Bg1YBke\029geBk\029MzX7Y0\001B")
_IQWp.Visible = false
_IQWp.Media = _8Yz
_IQWp.Commands = {}
_IQWp.DistanceRange = Distance(0, "meters")
_IQWp.ShowObjects = "OnEnter"
_IQWp.ProximityRange = Distance(60, "meters")
_IQWp.AllowSetPositionTo = false
_IQWp.Active = true
_IQWp.Points = {
  ZonePoint(47.8000946355964, 13.0444441139736, 0),
  ZonePoint(47.8000677307823, 13.0448831636578, 0),
  ZonePoint(47.7999652853547, 13.0448785420762, 0),
  ZonePoint(47.7999839118159, 13.0444148439886, 0)
}
_IQWp.OriginalPoint = ZonePoint(47.8000278908873, 13.0446551659241, 0)
_IQWp.DistanceRangeUOM = "Meters"
_IQWp.ProximityRangeUOM = "Meters"
_IQWp.OutOfRangeName = ""
_IQWp.InRangeName = ""
_ciWkK = Wherigo.Zone(i_love_Salzburg)
_ciWkK.Id = "8ef230bd-e159-4a3e-af48-c98f5458f447"
_ciWkK.Name = _pJ4N("ko\tM\023\b\bBx1MMXY7\003\003")
_ciWkK.Description = _pJ4N("R\029\bBko\tM\023\b\bBx1MMXY7\003\003BE\029YBg}1Bk\023((1YY1\b}g1\003zBg1YBk\029MzX7Y01YB>71Y\be1YzX}\bo\t\0231`1\001BR\029\bBko\tM\023\b\bBE7Yg1B}(Bc7`eY\0290Bg1\bBk\029MzX7Y01YB>71Y\be1YzX}\bo\t\023`\bB\027\029YG7\bBk}ee}G7\bB'\023\003Bx\023\t1\0031(\bB'\023(B\023X1Y}e\029M}1\003}\bo\t1\003BcYo\t}e1Ge1\003Bk\029\003e}\003\023Bk\023M\029Y}B}\003Bg1\003B&\029\tY1\003B\028\031\028]BX}\bB\028\031\028$B1YX\0297e\001B\027}eB1}\0031(BP1YeY\0290B'\023(B\021\028\001B&7\003}B\028n\021\021B0}\00301\003Bko\tM\023\b\bB7\003gB%\029YGB'\023\003Bx1MMXY7\003\003B\029\003Bg}1Bke\029geBk\029MzX7Y0B71X1Y\001BP\023Y\t1YBE\029Y1\003B\b}1B}\003BG\029}\b1YM}o\t1(B?1\b}ez\001")
_ciWkK.Visible = false
_ciWkK.Media = _oGx1U
_ciWkK.Commands = {}
_ciWkK.DistanceRange = Distance(0, "meters")
_ciWkK.ShowObjects = "OnEnter"
_ciWkK.ProximityRange = Distance(60, "meters")
_ciWkK.AllowSetPositionTo = false
_ciWkK.Active = true
_ciWkK.Points = {
  ZonePoint(47.7623331354928, 13.060212641648, 0),
  ZonePoint(47.762518801851, 13.0609438211907, 0),
  ZonePoint(47.762226669777, 13.0611444267174, 0),
  ZonePoint(47.7620002970017, 13.0604803861301, 0)
}
_ciWkK.OriginalPoint = ZonePoint(47.7622697260306, 13.0606953189215, 0)
_ciWkK.DistanceRangeUOM = "Meters"
_ciWkK.ProximityRangeUOM = "Meters"
_ciWkK.OutOfRangeName = ""
_ciWkK.InRangeName = ""
_WiX3f = Wherigo.Zone(i_love_Salzburg)
_WiX3f.Id = "507b7f3d-8928-4d14-b9fd-845765ad7053"
_WiX3f.Name = _pJ4N("k1X\029\be}\029\003\b`Y}1g\t\023`")
_WiX3f.Description = _pJ4N("R1YBk\029MzX7Y01YBk1X\029\be}\029\003\b`Y}1g\t\023`BE7Yg1B'\023\003B/YzX}\bo\t\023`B\004\023M`BR}1eY}o\tB'\023\003Bs\029}e1\003\0297B}\003Bc7`eY\0290B0101X1\003\001B/YBg}1\003e1B\0031X1\003Bg1(BGM1}\0031\003B%1e1Y\b`Y}1g\t\023`B}\003Bg1YB>\023M01B\029M\bB?10Y\0291X\003}\b\023YeB`71YB\029MM1B?71Y01YBg1YBke\029gelB\003\029o\tg1(B\028$nnBg1YB\029Me1BR\023(`Y}1g\t\023`B\0297`01M\029\b\b1\003BE\023Yg1\003BE\029Y\001Bx}1YBM}101\003B\004\023M`BR}1eY}o\tB'\023\003Bs\029}e1\003\0297B7\003gB%\029Y\029o1M\b7\bB1X1\003\b\023BX10Y\029X1\003lBE}1BP\029e1YB7\003gB/\t1`Y\0297B'\023\003B\004\023M`0\029\0030Bc(\029g17\bB\027\023z\029Ye\001Bc7o\tBg\029\bB:Y\029XBg1YB>\029(}M}1Bg1\bB?Y7g1Y\bBg1\bB%\tm\b}G1Y\bBS\tY}\be}\029\003BR\023\030\030M1YBX1`}\003g1eB\b}o\tB\t}1Y\001B")
_WiX3f.Visible = false
_WiX3f.Media = _WicD
_WiX3f.Commands = {}
_WiX3f.DistanceRange = Distance(0, "meters")
_WiX3f.ShowObjects = "OnEnter"
_WiX3f.ProximityRange = Distance(60, "meters")
_WiX3f.AllowSetPositionTo = false
_WiX3f.Active = true
_WiX3f.Points = {
  ZonePoint(47.804626595901, 13.0464843364936, 0),
  ZonePoint(47.8050399403536, 13.0472760371725, 0),
  ZonePoint(47.8044071335056, 13.0479130236365, 0),
  ZonePoint(47.8040284397468, 13.0471761163719, 0)
}
_WiX3f.OriginalPoint = ZonePoint(47.8045255273768, 13.0472123784186, 0)
_WiX3f.DistanceRangeUOM = "Meters"
_WiX3f.ProximityRangeUOM = "Meters"
_WiX3f.OutOfRangeName = ""
_WiX3f.InRangeName = ""
_uNO = Wherigo.Zone(i_love_Salzburg)
_uNO.Id = "bec27b4e-204e-464d-9021-b3ac67a0ff60"
_uNO.Name = _pJ4N("ke\001B%1e1Y")
_uNO.Description = _pJ4N("R\029\bBke}`eBk\029\003GeB%1e1YlB\0297o\tB/Yz\029Xe1}Bke\001B%1e1YB9M\029e1}\003}\bo\tBcYo\t}\029XX\029e}\029B\b\029\003oe}B%1eY}Bk\029M}\bX7Y01\003\b}\b\005B}\003Bk\029MzX7Y0lB}\beBg\029\bB\0291Me1\be1BX1\be1\t1\003g1B-M\023\be1YBg1YBZ1\be1YY1}o\t}\bo\t1\003B?1\0031g}Ge}\0031YG\023\0030Y10\029e}\023\003B7\003gB}(Bg17e\bo\t1\003Bk\030Y\029o\tY\0297(B\029MM01(1}\003\001BR}1B\027\0231\003o\t1BM1X1\003B\003\029o\tBg1YB?1\0031g}Ge7\bY101M\001Bke\001B%1e1YBE7Yg1B'\023(B\t1}M}01\003Bs7\0301YeB7(B\031n\031Bz7YB\027}\b\b}\023\003B}\003Bg1\003Bk71g\023\be\029M\0301\003B010Y71\003g1e\001")
_uNO.Visible = false
_uNO.Media = _vFkT3
_uNO.Commands = {}
_uNO.DistanceRange = Distance(0, "meters")
_uNO.ShowObjects = "OnEnter"
_uNO.ProximityRange = Distance(60, "meters")
_uNO.AllowSetPositionTo = false
_uNO.Active = true
_uNO.Points = {
  ZonePoint(47.7973407300764, 13.0441622083468, 0),
  ZonePoint(47.7973178038732, 13.0444723139407, 0),
  ZonePoint(47.7969965581585, 13.0443469850114, 0),
  ZonePoint(47.7970981387417, 13.0440230578366, 0)
}
_uNO.OriginalPoint = ZonePoint(47.7971883077124, 13.0442511412839, 0)
_uNO.DistanceRangeUOM = "Meters"
_uNO.ProximityRangeUOM = "Meters"
_uNO.OutOfRangeName = ""
_uNO.InRangeName = ""
_3NR = Wherigo.Zone(i_love_Salzburg)
_3NR.Id = "b94501d7-1636-4adb-9b0d-ec8e9949657e"
_3NR.Name = _pJ4N("P\023MG\b0\029Ye1\003")
_3NR.Description = _pJ4N("R1YBa\029(1\003\b01X1YBg1\bB%\029YG\bBE\029YB-\029}\b1YB>Y\029\003zB&\023\b1\030\tBV\001B901X\001B\028\v]bQB01\be\001B\028n\028\031\005\001N?sWN?sWR1YB-\029}\b1Y^>Y\029\003z^&\023\b1`^%\029YGBzE}\bo\t1\003Bg1YBk\029Mz\029o\tB7\003gBg1(B:1Y\bX\029o\tBE7Yg1B\028\vn\vB\029\003M\0291\b\bM}o\tBg1\bB$b^.\0291\tY}01\003B@\tY\023\003.7X}M\02917(\bBg1\bBx1YY\bo\t1Y\bB01\be\029Me1eB7\003gB\003\029o\tBg1(Bx1YY\bo\t1YBX1\003\029\003\003e\001BR\029(\029M\bBE7Yg1B\0297o\tB1}\003BGM1}\0031\bBR1\003G(\029MBz7B/\tY1\003Bg1\bB-\029}\b1Y\bB1YY}o\te1eB7\003gB1}\0031B/}o\t1B01\030`M\029\003ze\001Bk\030\0291e1\be1\003\bB\b1}eB\028n\021nB}\beBg1YB%\029YGB\0297o\tB\029M\bBP\023MG\b0\029Ye1\003BX1G\029\003\003e\001B")
_3NR.Visible = false
_3NR.Media = _Avqpz
_3NR.Commands = {}
_3NR.DistanceRange = Distance(0, "meters")
_3NR.ShowObjects = "OnEnter"
_3NR.ProximityRange = Distance(60, "meters")
_3NR.AllowSetPositionTo = false
_3NR.Active = true
_3NR.Points = {
  ZonePoint(47.7971240420726, 13.0600706936153, 0),
  ZonePoint(47.7965992827856, 13.0605450550059, 0),
  ZonePoint(47.7958931378548, 13.0601059978887, 0),
  ZonePoint(47.7968496378449, 13.0581762504469, 0),
  ZonePoint(47.7973259830904, 13.0583969342277, 0),
  ZonePoint(47.7975704660363, 13.0589240304114, 0)
}
_3NR.OriginalPoint = ZonePoint(47.7968937582808, 13.0593698269327, 0)
_3NR.DistanceRangeUOM = "Meters"
_3NR.ProximityRangeUOM = "Meters"
_3NR.OutOfRangeName = ""
_3NR.InRangeName = ""
_h0vSJ = Wherigo.Zone(i_love_Salzburg)
_h0vSJ.Id = "5ee3612a-3e73-4b50-9b38-4322047a7eb5"
_h0vSJ.Name = _pJ4N("\002}\be1Y\0031")
_h0vSJ.Description = _pJ4N("R}1B\002}\be1Y\0031Bg}1\003e1Bg1YB1YE1}e1Ye1\003B\004\029\b\b1Y'1Y\b\023Y07\0030Bg1YB>1\be7\0030Bx\023\t1\003\b\029MzX7Y0\001B/\bB}\beBg}1\bBg\029\bB1Y\be1B?\0297E1YGBg1YBs1\003\029}\b\b\029\003o1B}\003Bk\029MzX7Y0\001B/\bBz1}0eBg\029\bBR\023\030\0301ME\029\030\0301\003Bg1\bB>71Y\be1YzX}\bo\t\023`\bBzE1}B\027\029MlB\b\023E}1B1}\0031BM\029e1}\003}\bo\t1B7\003gBg17e\bo\t1BV\003\bo\tY}`e\001B")
_h0vSJ.Visible = false
_h0vSJ.Media = _M36x
_h0vSJ.Commands = {}
_h0vSJ.DistanceRange = Distance(0, "meters")
_h0vSJ.ShowObjects = "OnEnter"
_h0vSJ.ProximityRange = Distance(60, "meters")
_h0vSJ.AllowSetPositionTo = false
_h0vSJ.Active = true
_h0vSJ.Points = {
  ZonePoint(47.7951783722533, 13.0481283820729, 0),
  ZonePoint(47.7951750364645, 13.0483921534786, 0),
  ZonePoint(47.795015663457, 13.0483955062399, 0),
  ZonePoint(47.7950230919924, 13.0481245581807, 0)
}
_h0vSJ.OriginalPoint = ZonePoint(47.7950980410418, 13.048260149993, 0)
_h0vSJ.DistanceRangeUOM = "Meters"
_h0vSJ.ProximityRangeUOM = "Meters"
_h0vSJ.OutOfRangeName = ""
_h0vSJ.InRangeName = ""
_71jNk = Wherigo.Zone(i_love_Salzburg)
_71jNk.Id = "bf109d90-f067-474b-8a8d-cad52c88f7f0"
_71jNk.Name = _pJ4N("\002E1Y01YM0\029Ye1\003")
_71jNk.Description = _pJ4N("R1YB\002E1Y01YM0\029Ye1\003lB7Y\b\030Y71\0030M}o\t1YBa\029(1Br%}0\029eM0\029Ye1\003rlB}\beB1}\003BE1\b1\003eM}o\t1YB@1}MBg1\bB\003\029o\tB\028\031nbB'\023\003B>}\bo\t1YB'\023\003B/YM\029o\tB01\be\029Me1e1\003BX\029Y\023oG1\003B\027}Y\029X1MM0\029Ye1\003\bB}\003Bg1YBY1o\te\b7`Y}01\003BcMe\be\029geB'\023\003Bg1YBke\029geBk\029MzX7Y0\001B/YB}\beBg1YB\0291Me1\be1B\002E1Y01\0030\029Ye1\003B/7Y\023\030\029\b\001B")
_71jNk.Visible = false
_71jNk.Media = _TJ2
_71jNk.Commands = {}
_71jNk.DistanceRange = Distance(0, "meters")
_71jNk.ShowObjects = "OnEnter"
_71jNk.ProximityRange = Distance(60, "meters")
_71jNk.AllowSetPositionTo = false
_71jNk.Active = true
_71jNk.Points = {
  ZonePoint(47.8052793831612, 13.0399472868536, 0),
  ZonePoint(47.8053536398511, 13.0405411612328, 0),
  ZonePoint(47.8051500841449, 13.0407182662288, 0),
  ZonePoint(47.8049355354101, 13.040186086488, 0)
}
_71jNk.OriginalPoint = ZonePoint(47.8051796606418, 13.0403482002008, 0)
_71jNk.DistanceRangeUOM = "Meters"
_71jNk.ProximityRangeUOM = "Meters"
_71jNk.OutOfRangeName = ""
_71jNk.InRangeName = ""
_QzrjR = Wherigo.ZItem({Cartridge = i_love_Salzburg, Container = Player})
_QzrjR.Id = "77bd51f2-1406-4864-be56-921acc34f912"
_QzrjR.Name = _pJ4N("\022\003M\023oGBS\023g1")
_QzrjR.Description = ""
_QzrjR.Visible = false
_QzrjR.Commands = {}
_QzrjR.ObjectLocation = Wherigo.INVALID_ZONEPOINT
_QzrjR.Locked = false
_QzrjR.Opened = false
_3UCm = Wherigo.ZTask(i_love_Salzburg)
_3UCm.Id = "a49be41d-46a0-4870-9aa0-8df1d71e8628"
_3UCm.Name = _pJ4N(">}\003g1Bk1\t1\003\bE71Yg}0G1}e1\003\001")
_3UCm.Description = _pJ4N("k\030\029z}1Y1Bg7Yo\tBg}1Bke\029geB7\003gB`}\003g1Bk1\t1\003\bE71Yg}0G1}e1\003B\t}1YB}\003Bk\029MzX7Y0\001")
_3UCm.Visible = true
_3UCm.Active = true
_3UCm.Complete = false
_3UCm.CorrectState = "None"
_dIrOk = Wherigo.ZTask(i_love_Salzburg)
_dIrOk.Id = "ba129541-8079-4e65-b425-72991d184e2a"
_dIrOk.Name = _pJ4N("cGe71MM1YB%7\003Ge1\be\029\003g")
_dIrOk.Description = _pJ4N("c7\b0\029X1Bg1\bB\029Ge71MM1\003B%7\003Ge1\be\029\003g1\b")
_dIrOk.Visible = true
_dIrOk.Active = true
_dIrOk.Complete = false
_dIrOk.CorrectState = "None"
_xRde = Wherigo.ZTask(i_love_Salzburg)
_xRde.Id = "ce80cba5-f12d-45b9-a295-e2bd4ea2cc80"
_xRde.Name = _pJ4N("\027\029YG\023B>1}\0030\023MgBke10B01`7\003g1\003")
_xRde.Description = _pJ4N("R7B\t\029\beBg1\003B\027\029YG\023B>1}\0030\023MgBke10B01`7\003g1\003\001")
_xRde.Visible = false
_xRde.Media = _iC8
_xRde.Active = true
_xRde.Complete = true
_xRde.CorrectState = "None"
_SdXd = Wherigo.ZTask(i_love_Salzburg)
_SdXd.Id = "c7c40c1a-7dad-4f95-85b3-48c9484dddf8"
_SdXd.Name = _pJ4N("c7\b\b}o\teB(]\021B01`7\003g1\003")
_SdXd.Description = _pJ4N("R7B\t\029\beBg}1Bc7\b\b}o\teB(]\021B01`7\003g1\003\001")
_SdXd.Visible = false
_SdXd.Media = _5yrc
_SdXd.Active = true
_SdXd.Complete = true
_SdXd.CorrectState = "None"
_Pd80 = Wherigo.ZTask(i_love_Salzburg)
_Pd80.Id = "03ab8d65-9f1a-4675-8f21-7436c404b503"
_Pd80.Name = _pJ4N("cMe1\bB\027\023z\029Ye17(B01`7\003g1\003")
_Pd80.Description = _pJ4N("R7B\t\029\beBg\029\bBcMe1B\027\023z\029Ye17(B01`7\003g1\003\001")
_Pd80.Visible = false
_Pd80.Media = _keAY
_Pd80.Active = true
_Pd80.Complete = true
_Pd80.CorrectState = "None"
_Shy = Wherigo.ZTask(i_love_Salzburg)
_Shy.Id = "92a9d3f1-8940-4fc1-9f56-5ea449234fe0"
_Shy.Name = _pJ4N("?1\0031g}Ge}\0031YB-M\023\be1YBa\023\003\003X1Y0B01`7\003g1\003")
_Shy.Description = _pJ4N("R7B\t\029\beBg\029\bB?1\0031g}Ge}\0031YB-M\023\be1YBa\023\003\003X1Y0B01`7\003g1\003\001")
_Shy.Visible = false
_Shy.Media = _F0zPg
_Shy.Active = true
_Shy.Complete = true
_Shy.CorrectState = "None"
_vEHnV = Wherigo.ZTask(i_love_Salzburg)
_vEHnV.Id = "da2d4d35-bfa1-4b5d-b2c8-7176a926d472"
_vEHnV.Name = _pJ4N("?71Y01Y0\029Yg1B01`7\003g1\003")
_vEHnV.Description = _pJ4N("R7B\t\029\beBg}1B?71Y01Y0\029Yg1B01`7\003g1\003\001")
_vEHnV.Visible = false
_vEHnV.Media = _6DNlu
_vEHnV.Active = true
_vEHnV.Complete = true
_vEHnV.CorrectState = "None"
_x7jsj = Wherigo.ZTask(i_love_Salzburg)
_x7jsj.Id = "bf24da7d-5501-4b24-bd88-73fbe1e3e095"
_x7jsj.Name = _pJ4N("R\023(B01`7\003g1\003")
_x7jsj.Description = _pJ4N("R7B\t\029\beBg1\003BR\023(B01`7\003g1\003\001")
_x7jsj.Visible = false
_x7jsj.Media = _XrQi
_x7jsj.Active = true
_x7jsj.Complete = true
_x7jsj.CorrectState = "None"
_rVt = Wherigo.ZTask(i_love_Salzburg)
_rVt.Id = "ff543688-c7d8-4a22-970c-7aa27f0c65d8"
_rVt.Name = _pJ4N("/\00301ME}Ye\bXY7\003\0031\003B01`7\003g1\003")
_rVt.Description = _pJ4N("R7B\t\029\beBg1\003B/\00301ME}Ye\bXY7\003\0031\003B01`7\003g1\003\001")
_rVt.Visible = false
_rVt.Media = _IpEun
_rVt.Active = true
_rVt.Complete = true
_rVt.CorrectState = "None"
_7g4pR = Wherigo.ZTask(i_love_Salzburg)
_7g4pR.Id = "12a81aca-b350-40aa-bbd5-20a12590567b"
_7g4pR.Name = _pJ4N("/Y\t\029YgG}Yo\t1B01`7\003g1\003")
_7g4pR.Description = _pJ4N("R7B\t\029\beBg}1B/Y\t\029YgG}Yo\t1B01`7\003g1\003\001")
_7g4pR.Visible = false
_7g4pR.Media = _W4LCs
_7g4pR.Active = true
_7g4pR.Complete = true
_7g4pR.CorrectState = "None"
_xNb = Wherigo.ZTask(i_love_Salzburg)
_xNb.Id = "932ea7cd-b1bc-46f6-8532-e2f87a4cd1fb"
_xNb.Name = _pJ4N(">1\be\b\030}1M\t\0297\bB01`7\003g1\003")
_xNb.Description = _pJ4N("R7B\t\029\beBg\029\bB>1\be\b\030}1M\t\0297\bB01`7\003g1\003\001")
_xNb.Visible = false
_xNb.Media = _CLIzB
_xNb.Active = true
_xNb.Complete = true
_xNb.CorrectState = "None"
_QFn = Wherigo.ZTask(i_love_Salzburg)
_QFn.Id = "cd5eace0-1e6f-4b29-bce3-c6aab869166b"
_QFn.Name = _pJ4N(">}\bo\tB-Y}10B01`7\003g1\003")
_QFn.Description = _pJ4N("R7B\t\029\beBg1\003B>}\bo\tB-Y}10B01`7\003g1\003\001")
_QFn.Visible = false
_QFn.Media = _6nb
_QFn.Active = true
_QFn.Complete = true
_QFn.CorrectState = "None"
_wA5T = Wherigo.ZTask(i_love_Salzburg)
_wA5T.Id = "b067044d-2218-43d7-a256-528c522c779b"
_wA5T.Name = _pJ4N(">M\023Y}\029\003}XY7\003\0031\003B01`7\003g1\003")
_wA5T.Description = _pJ4N("R7B\t\029\beBg1\003B>M\023Y}\029\003}XY7\003\0031\003B01`7\003g1\003\001")
_wA5T.Visible = false
_wA5T.Media = _8MSV
_wA5T.Active = true
_wA5T.Complete = true
_wA5T.CorrectState = "None"
_b1Dsh = Wherigo.ZTask(i_love_Salzburg)
_b1Dsh.Id = "c6490e2d-37f4-4667-8a81-3ef702b13a90"
_b1Dsh.Name = _pJ4N(">Y\029\003z}\bG\029\0031YG}Yo\t1B01`7\003g1\003")
_b1Dsh.Description = _pJ4N("R7B\t\029\beBg}1B>Y\029\003z}\bG\029\0031YG}Yo\t1B01`7\003g1\003\001")
_b1Dsh.Visible = false
_b1Dsh.Media = _dXrih
_b1Dsh.Active = true
_b1Dsh.Complete = true
_b1Dsh.CorrectState = "None"
_X5F = Wherigo.ZTask(i_love_Salzburg)
_X5F.Id = "156ecdc5-caaf-4364-bd7c-2f09748a7f03"
_X5F.Name = _pJ4N(">Y\029\003z}\bG}\bo\tM\0231\b\bMB01`7\003g1\003")
_X5F.Description = _pJ4N("R7B\t\029\beBg\029\bB>Y\029\003z}\bG}\bo\tM\0231\b\bMB01`7\003g1\003\001")
_X5F.Visible = false
_X5F.Media = _l1c
_X5F.Active = true
_X5F.Complete = true
_X5F.CorrectState = "None"
_vxsNl = Wherigo.ZTask(i_love_Salzburg)
_vxsNl.Id = "c37fc1e0-bc5c-43f5-9c1c-bb0dfbc21e4e"
_vxsNl.Name = _pJ4N(">Y1}\b\029\029MB01`7\003g1\003")
_vxsNl.Description = _pJ4N("R7B\t\029\beBko\tM\023\b\bB>Y1}\b\029\029MB01`7\003g1\003\001")
_vxsNl.Visible = false
_vxsNl.Media = _FrfO
_vxsNl.Active = true
_vxsNl.Complete = true
_vxsNl.CorrectState = "None"
_Lpi = Wherigo.ZTask(i_love_Salzburg)
_Lpi.Id = "7170aef9-3c3e-4649-bb88-c65d878a3620"
_Lpi.Name = _pJ4N("x\023((\02901B\029\003B\027\023z\029YeB01`7\003g1\003")
_Lpi.Description = _pJ4N("R7B\t\029\beBg}1Bx\023((\02901B\0297`B\027\023z\029YeB01`7\003g1\003\001")
_Lpi.Visible = false
_Lpi.Media = _zF9U
_Lpi.Active = true
_Lpi.Complete = true
_Lpi.CorrectState = "None"
_hh5 = Wherigo.ZTask(i_love_Salzburg)
_hh5.Id = "7c5e8f0f-2f1d-4a15-a0fd-bc916d4a4149"
_hh5.Name = _pJ4N("x\023e1MBk\029o\t1YB01`7\003g1\003")
_hh5.Description = _pJ4N("R7B\t\029\beBg\029\bBx\023e1MBk\029o\t1YB01`7\003g1\003\001")
_hh5.Visible = false
_hh5.Media = _GBMIl
_hh5.Active = true
_hh5.Complete = true
_hh5.CorrectState = "None"
_Ir4 = Wherigo.ZTask(i_love_Salzburg)
_Ir4.Id = "e1a0bb0c-a38e-473f-8b86-8a3554aba493"
_Ir4.Name = _pJ4N("V\003\0031Y1\bB\024}\003z1Ye\023YB01`7\003g1\003")
_Ir4.Description = _pJ4N("R7B\t\029\beBg\029\bBV\003\0031Y1B\024}\003z1Ye\023YB01`7\003g1\003\001")
_Ir4.Visible = false
_Ir4.Media = _W0wn
_Ir4.Active = true
_Ir4.Complete = true
_Ir4.CorrectState = "None"
_F7UxJ = Wherigo.ZTask(i_love_Salzburg)
_F7UxJ.Id = "031c6f0f-dd6d-4588-aa59-c81e5ecafafd"
_F7UxJ.Name = _pJ4N("V\003\0031Y1\bBke1}\003e\023YB01`7\003g1\003")
_F7UxJ.Description = _pJ4N("R7B\t\029\beBg\029\bBV\003\0031Y1Bke1}\003e\023YB01`7\003g1\003\001")
_F7UxJ.Visible = false
_F7UxJ.Media = _6R4s4
_F7UxJ.Active = true
_F7UxJ.Complete = true
_F7UxJ.CorrectState = "None"
_s8DYW = Wherigo.ZTask(i_love_Salzburg)
_s8DYW.Id = "463529a6-e18e-47a9-bc0a-65583f702711"
_s8DYW.Name = _pJ4N("&7\be}z01X\02917g1B01`7\003g1\003")
_s8DYW.Description = _pJ4N("R7B\t\029\beBg\029\bB&7\be}z01X\02917g1B01`7\003g1\003\001")
_s8DYW.Visible = false
_s8DYW.Media = _DdSg
_s8DYW.Active = true
_s8DYW.Complete = true
_s8DYW.CorrectState = "None"
_6t3 = Wherigo.ZTask(i_love_Salzburg)
_6t3.Id = "6eb5ed78-2f45-43b9-8ce7-d463cda63c5f"
_6t3.Name = _pJ4N("-\029\030}e1M\bo\tE1((1B01`7\003g1\003")
_6t3.Description = _pJ4N("R7B\t\029\beBg}1B-\029\030}e1M\bo\tE1((1B01`7\003g1\003\001")
_6t3.Visible = false
_6t3.Media = _tkL
_6t3.Active = true
_6t3.Complete = true
_6t3.CorrectState = "None"
_R2x3c = Wherigo.ZTask(i_love_Salzburg)
_R2x3c.Id = "c0b103fd-6fa9-4937-9e45-b68a53b9d851"
_R2x3c.Name = _pJ4N("-\029e\029G\023(X1\003B01`7\003g1\003")
_R2x3c.Description = _pJ4N("R7B\t\029\beBg}1B-\029e\029G\023(X1\003B01`7\003g1\003\001")
_R2x3c.Visible = false
_R2x3c.Media = _VG2
_R2x3c.Active = true
_R2x3c.Complete = true
_R2x3c.CorrectState = "None"
_VlVF = Wherigo.ZTask(i_love_Salzburg)
_VlVF.Id = "e5f1cad4-9fae-4e76-937b-f4f41a0f2aa8"
_VlVF.Name = _pJ4N("-M\0297\b1\003e\023YB01`7\003g1\003")
_VlVF.Description = _pJ4N("R7B\t\029\beBg\029\bB-M\0297\b1\003e\023YB01`7\003g1\003\001")
_VlVF.Visible = false
_VlVF.Media = _WZJpj
_VlVF.Active = true
_VlVF.Complete = true
_VlVF.CorrectState = "None"
_58rV1 = Wherigo.ZTask(i_love_Salzburg)
_58rV1.Id = "d5371826-6b54-4d96-8d63-2d07b00b2004"
_58rV1.Name = _pJ4N("-\023MM10}1\003G}Yo\t1B01`7\003g1\003")
_58rV1.Description = _pJ4N("R7B\t\029\beBg}1B-\023MM10}1\003G}Yo\t1B01`7\003g1\003\001")
_58rV1.Visible = false
_58rV1.Media = __jJo
_58rV1.Active = true
_58rV1.Complete = true
_58rV1.CorrectState = "None"
_fzJ = Wherigo.ZTask(i_love_Salzburg)
_fzJ.Id = "45b36b9e-b78a-4910-8fa4-c2d283b88004"
_fzJ.Name = _pJ4N("\024\029\003g1\be\t1\029e1YB01`7\003g1\003")
_fzJ.Description = _pJ4N("R7B\t\029\beBg\029\bB\024\029\003g1\be\t1\029e1YB01`7\003g1\003\001")
_fzJ.Visible = false
_fzJ.Media = _Y76
_fzJ.Active = true
_fzJ.Complete = true
_fzJ.CorrectState = "None"
_9Zx = Wherigo.ZTask(i_love_Salzburg)
_9Zx.Id = "51dd2053-1b38-489d-a2b8-7947f0958a28"
_9Zx.Name = _pJ4N("\027\029Y}\023\0031ee1\003e\t1\029e1YB01`7\003g1\003")
_9Zx.Description = _pJ4N("R7B\t\029\beBg\029\bB\027\029Y}\023\0031ee1\003e\t1\029e1YB01`7\003g1\003\001")
_9Zx.Visible = false
_9Zx.Media = _4Zc8Q
_9Zx.Active = true
_9Zx.Complete = true
_9Zx.CorrectState = "None"
_pWXD = Wherigo.ZTask(i_love_Salzburg)
_pWXD.Id = "af14b100-f3a5-4331-95b4-3139381c2016"
_pWXD.Name = _pJ4N("\027\023z\029YeB:1X7Ye\b\t\0297\bB01`7\003g1\003")
_pWXD.Description = _pJ4N("R7B\t\029\beB\027\023z\029Ye\bB:1X7Ye\b\t\0297\bB01`7\003g1\003\001")
_pWXD.Visible = false
_pWXD.Media = _1qhzC
_pWXD.Active = true
_pWXD.Complete = true
_pWXD.CorrectState = "None"
_tYqkF = Wherigo.ZTask(i_love_Salzburg)
_tYqkF.Id = "4258ed11-9570-4491-8e6d-39961159bd9b"
_tYqkF.Name = _pJ4N("\027\023z\029YeB\004\023\t\003\t\0297\bB01`7\003g1\003")
_tYqkF.Description = _pJ4N("R7B\t\029\beB\027\023z\029Ye\bB\004\023\t\003\t\0297\bB01`7\003g1\003\001")
_tYqkF.Visible = false
_tYqkF.Media = _wBUX4
_tYqkF.Active = true
_tYqkF.Complete = true
_tYqkF.CorrectState = "None"
_5aQfl = Wherigo.ZTask(i_love_Salzburg)
_5aQfl.Id = "fa1ac4d1-f65d-455a-8101-a55353d78660"
_5aQfl.Name = _pJ4N("\027\023z\029Ye\be\029e71B01`7\003g1\003")
_5aQfl.Description = _pJ4N("R7B\t\029\beBg}1B\027\023z\029Ye\be\029e71B01`7\003g1\003\001")
_5aQfl.Visible = false
_5aQfl.Media = _6ZAs
_5aQfl.Active = true
_5aQfl.Complete = true
_5aQfl.CorrectState = "None"
_Ndnz = Wherigo.ZTask(i_love_Salzburg)
_Ndnz.Id = "cd692436-13a2-48fd-94b9-41f021fabf0c"
_Ndnz.Name = _pJ4N("\02771MM\0031YBke10B01`7\003g1\003")
_Ndnz.Description = _pJ4N("R7B\t\029\beBg1\003B\02771MM\0031YBke10B01`7\003g1\003\001")
_Ndnz.Visible = false
_Ndnz.Media = _yYlW
_Ndnz.Active = true
_Ndnz.Complete = true
_Ndnz.CorrectState = "None"
_ld8 = Wherigo.ZTask(i_love_Salzburg)
_ld8.Id = "1f718a68-71a1-4a4e-8cf4-faed350a61c9"
_ld8.Name = _pJ4N("%\029\030\02901\003\023XY7\003\0031\003B01`7\003g1\003")
_ld8.Description = _pJ4N("R7B\t\029\beBg1\003B%\029\030\02901\003\023XY7\003\0031\003B01`7\003g1\003\001")
_ld8.Visible = false
_ld8.Media = _Xke9W
_ld8.Active = true
_ld8.Complete = true
_ld8.CorrectState = "None"
_16s = Wherigo.ZTask(i_love_Salzburg)
_16s.Id = "9f85ecfe-8f45-4f7b-9afa-58d342d94356"
_16s.Name = _pJ4N("%10\029\b7\bXY7\003\0031\003B01`7\003g1\003")
_16s.Description = _pJ4N("R7B\t\029\beBg1\003B%10\029\b7\bXY7\003\0031\003B01`7\003g1\003\001")
_16s.Visible = false
_16s.Media = _K8xI
_16s.Active = true
_16s.Complete = true
_16s.CorrectState = "None"
_UbaH = Wherigo.ZTask(i_love_Salzburg)
_UbaH.Id = "43062082-9d11-4255-949f-0bb70a7fd6a4"
_UbaH.Name = _pJ4N("%`1Yg1\bo\tE1((1B01`7\003g1\003")
_UbaH.Description = _pJ4N("R7B\t\029\beBg}1B%`1Yg1\bo\tE1((1B01`7\003g1\003\001")
_UbaH.Visible = false
_UbaH.Media = _Pzb
_UbaH.Active = true
_UbaH.Complete = true
_UbaH.CorrectState = "None"
_O0SZl = Wherigo.ZTask(i_love_Salzburg)
_O0SZl.Id = "c4e1b070-b831-4128-be22-5a9ce71a46a3"
_O0SZl.Name = _pJ4N("%M\029ezMB01`7\003g1\003")
_O0SZl.Description = _pJ4N("R7B\t\029\beBg\029\bB%M\029ezMB01`7\003g1\003\001")
_O0SZl.Visible = false
_O0SZl.Media = _GDBdd
_O0SZl.Active = true
_O0SZl.Complete = true
_O0SZl.CorrectState = "None"
_OXXc7 = Wherigo.ZTask(i_love_Salzburg)
_OXXc7.Id = "a214cbd7-3c2d-47e3-bded-e3aa6786ee1e"
_OXXc7.Name = _pJ4N("s\029e\t\0297\bB01`7\003g1\003")
_OXXc7.Description = _pJ4N("R7B\t\029\beBg\029\bBs\029e\t\0297\bB01`7\003g1\003\001")
_OXXc7.Visible = false
_OXXc7.Media = _8Yz
_OXXc7.Active = true
_OXXc7.Complete = true
_OXXc7.CorrectState = "None"
_Auy = Wherigo.ZTask(i_love_Salzburg)
_Auy.Id = "e24dd2fe-ac93-42d1-a90b-9caa3deb8d64"
_Auy.Name = _pJ4N("ko\tM\023\b\bBx1MMXY7\003\003B01`7\003g1\003")
_Auy.Description = _pJ4N("R7B\t\029\beBg\029\bBko\tM\023\b\bBx1MMXY7\003\003B01`7\003g1\003\001")
_Auy.Visible = false
_Auy.Media = _oGx1U
_Auy.Active = true
_Auy.Complete = true
_Auy.CorrectState = "None"
_vVj8 = Wherigo.ZTask(i_love_Salzburg)
_vVj8.Id = "0db19c9f-0adc-48c4-b7a2-282981703e58"
_vVj8.Name = _pJ4N("k1X\029\be}\029\003\b`Y}1g\t\023`B01`7\003g1\003")
_vVj8.Description = _pJ4N("R7B\t\029\beBg1\003Bk1X\029\be}\029\003\b`Y}1g\t\023`B01`7\003g1\003\001")
_vVj8.Visible = false
_vVj8.Media = _WicD
_vVj8.Active = true
_vVj8.Complete = true
_vVj8.CorrectState = "None"
_LTG = Wherigo.ZTask(i_love_Salzburg)
_LTG.Id = "c3ad7bf1-cd14-4d48-8714-4229a8d75f0c"
_LTG.Name = _pJ4N("ke\001B%1e1YB01`7\003g1\003")
_LTG.Description = _pJ4N("R7B\t\029\beBke\001B%1e1YB01`7\003g1\003\001")
_LTG.Visible = false
_LTG.Media = _vFkT3
_LTG.Active = true
_LTG.Complete = true
_LTG.CorrectState = "None"
_E50LW = Wherigo.ZTask(i_love_Salzburg)
_E50LW.Id = "5fb08984-d23c-4276-bb0d-10fed9d31821"
_E50LW.Name = _pJ4N("P\023MG\b0\029Ye1\003B01`7\003g1\003")
_E50LW.Description = _pJ4N("R7B\t\029\beBg1\003BP\023MG\b0\029Ye1\003B01`7\003g1\003\001")
_E50LW.Visible = false
_E50LW.Media = _Avqpz
_E50LW.Active = true
_E50LW.Complete = true
_E50LW.CorrectState = "None"
_5D4Bn = Wherigo.ZTask(i_love_Salzburg)
_5D4Bn.Id = "937f54d2-aac9-418d-90e1-b89319570ca7"
_5D4Bn.Name = _pJ4N("\002}\be1Y\0031B01`7\003g1\003")
_5D4Bn.Description = _pJ4N("R7B\t\029\beBg}1B\002}\be1Y\0031B01`7\003g1\003\001")
_5D4Bn.Visible = false
_5D4Bn.Media = _M36x
_5D4Bn.Active = true
_5D4Bn.Complete = true
_5D4Bn.CorrectState = "None"
_Y4uVn = Wherigo.ZTask(i_love_Salzburg)
_Y4uVn.Id = "8880d16f-c2f0-42bf-9074-d50ac102f452"
_Y4uVn.Name = _pJ4N("\002E1Y01YM0\029Ye1\003B01`7\003g1\003")
_Y4uVn.Description = _pJ4N("R7B\t\029\beBg1\003B\002E1Y01YM0\029Ye1\003B01`7\003g1\003\001")
_Y4uVn.Visible = false
_Y4uVn.Media = _TJ2
_Y4uVn.Active = true
_Y4uVn.Complete = true
_Y4uVn.CorrectState = "None"
_aa3A = 0
_59yr = 20
_LIdpl = _pJ4N("?Y\029'\023)N?sW")
_RaPla = _pJ4N("B01`7\003g1\003\001N?sWN?sWR7B\t\029\beBg1Yz1}eB")
_cRH4 = _pJ4N("B'\023\003B")
_VH3 = _pJ4N("B\003\023eE1\003g}01\003B%7\003Ge1\003\001N?sWN?sW\0041}e1Y1BV\003`\023Y(\029e}\023\0031\003Bz7Bg}1\b1(BZYeB`}\003g1\beBg7B}\003Bg1\003B\024\023o\029e}\023\003\b\001")
_lblTG = _pJ4N("N?sWx}1YBE\029Y\beBg7BX1Y1}e\b\001N?sW/\bB0}XeB\t}1YBG1}\0031BE1}e1Y1\003B%7\003Ge1Bz7B\b\029((1M\003\001N?sWN?sWR7B\t\029\beBg1Yz1}eB")
_ete = true
_xzc3 = _pJ4N([[
H:
&@]])
_y0P = _pJ4N("g7((m")
_lugby = _pJ4N("H#zY.s")
_0k4S = _pJ4N("H]\022S(")
_m3zcA = _pJ4N("g7((m")
_3GQ4 = _pJ4N("g7((m")
i_love_Salzburg.ZVariables = {
  _aa3A = 0,
  _59yr = 20,
  _LIdpl = _pJ4N("?Y\029'\023)N?sW"),
  _RaPla = _pJ4N("B01`7\003g1\003\001N?sWN?sWR7B\t\029\beBg1Yz1}eB"),
  _cRH4 = _pJ4N("B'\023\003B"),
  _VH3 = _pJ4N("B\003\023eE1\003g}01\003B%7\003Ge1\003\001N?sWN?sW\0041}e1Y1BV\003`\023Y(\029e}\023\0031\003Bz7Bg}1\b1(BZYeB`}\003g1\beBg7B}\003Bg1\003B\024\023o\029e}\023\003\b\001"),
  _lblTG = _pJ4N("N?sWx}1YBE\029Y\beBg7BX1Y1}e\b\001N?sW/\bB0}XeB\t}1YBG1}\0031BE1}e1Y1\003B%7\003Ge1Bz7B\b\029((1M\003\001N?sWN?sWR7B\t\029\beBg1Yz1}eB"),
  _ete = true,
  _xzc3 = _pJ4N([[
H:
&@]]),
  _y0P = _pJ4N("g7((m"),
  _lugby = _pJ4N("H#zY.s"),
  _0k4S = _pJ4N("H]\022S("),
  _m3zcA = _pJ4N("g7((m"),
  _3GQ4 = _pJ4N("g7((m")
}

function i_love_Salzburg:OnStart()
  if _G[_pJ4N("/\003'")][_pJ4N("%M\029e`\023Y(")] == _pJ4N("\004}\003]\021") or _G[_pJ4N("/\003'")][_pJ4N("R1'}o1VR")] == _pJ4N("R1\bGe\023\030") then
    for k, v in pairs(_G[_pJ4N("}HM\023'1Hk\029MzX7Y0")][_pJ4N("cMM\002ZX.1oe\b")]) do
      v[_pJ4N("P}\b}XM1")] = false
      v[_pJ4N("coe}'1")] = false
    end
    _Urwigo.MessageBox({
      Text = tostring(_pJ4N("cX1YBx\029MM\023)N?sWN?sW\0041YBE}YgBg1\003\003B}(Bk}(7M\029e\023YB\b\030}1M1\003[N?sWN?sWR\029\bB}\beB\029X1YB0\029YB\003}o\teB\0031ee\001N?sW:\029\029\029\029\029\029\003zB\bo\tM1o\te1\bB-\029Y(\029\001")),
      Callback = function(action)
        if action ~= nil then
          _G[_pJ4N("\004\t1Y}0\023")][_pJ4N("S\023((\029\003g")](_pJ4N("k\029'1SM\023\b1"))
        end
      end
    })
    return
  end
  if _ete == true and (_G[_pJ4N("/\003'")][_pJ4N("%M\029e`\023Y(")] == _pJ4N("\004}\003]\021") or _G[_pJ4N("/\003'")][_pJ4N("R1'}o1VR")] == _pJ4N("R1\bGe\023\030")) == true then
    _Urwigo.MessageBox({
      Text = "",
      Media = _gN5,
      Callback = function(action)
        if action ~= nil then
          os.exit()
        end
      end
    })
  end
end

function i_love_Salzburg:OnRestore()
  cur_position = Player.ObjectLocation
end

function _0qv:OnEnter()
  _xzc3 = _pJ4N("HbU'")
  _G[_xzc3].Visible = true
  if _Pd80.Visible == false then
    _aa3A = _aa3A + 2
    _Pd80.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _keAY,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _keAY
    })
  end
end

function _0qv:OnExit()
  _xzc3 = _pJ4N("HbU'")
  _G[_xzc3].Visible = false
end

function _BGD:OnEnter()
  _xzc3 = _pJ4N("H?:R")
  _G[_xzc3].Visible = true
  if _SdXd.Visible == false then
    _aa3A = _aa3A + 3
    _SdXd.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _5yrc,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _5yrc
    })
  end
end

function _BGD:OnExit()
  _xzc3 = _pJ4N("H?:R")
  _G[_xzc3].Visible = false
end

function _PZh:OnEnter()
  _xzc3 = _pJ4N("H%\002\t")
  _G[_xzc3].Visible = true
  if _Shy.Visible == false then
    _aa3A = _aa3A + 3
    _Shy.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _F0zPg,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _F0zPg
    })
  end
end

function _PZh:OnExit()
  _xzc3 = _pJ4N("H%\002\t")
  _G[_xzc3].Visible = false
end

function _91rNA:OnEnter()
  _xzc3 = _pJ4N("Hn\028Yac")
  _G[_xzc3].Visible = true
  if _vEHnV.Visible == false then
    _aa3A = _aa3A + 3
    _vEHnV.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6DNlu,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6DNlu
    })
  end
end

function _91rNA:OnExit()
  _xzc3 = _pJ4N("Hn\028Yac")
  _G[_xzc3].Visible = false
end

function _NLRB:OnEnter()
  _xzc3 = _pJ4N("Ha\024s?")
  _G[_xzc3].Visible = true
  if _x7jsj.Visible == false then
    _aa3A = _aa3A + 1
    _x7jsj.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _XrQi,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _XrQi
    })
  end
end

function _NLRB:OnExit()
  _xzc3 = _pJ4N("Ha\024s?")
  _G[_xzc3].Visible = false
end

function _MQRX:OnEnter()
  _xzc3 = _pJ4N("H\027#sI")
  _G[_xzc3].Visible = true
  if _rVt.Visible == false then
    _aa3A = _aa3A + 2
    _rVt.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _IpEun,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _IpEun
    })
  end
end

function _MQRX:OnExit()
  _xzc3 = _pJ4N("H\027#sI")
  _G[_xzc3].Visible = false
end

function _1Uc1:OnEnter()
  _xzc3 = _pJ4N("H\028\022o\028")
  _G[_xzc3].Visible = true
  if _7g4pR.Visible == false then
    _aa3A = _aa3A + 3
    _7g4pR.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _W4LCs,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _W4LCs
    })
  end
end

function _1Uc1:OnExit()
  _xzc3 = _pJ4N("H\028\022o\028")
  _G[_xzc3].Visible = false
end

function _R8gYH:OnEnter()
  _xzc3 = _pJ4N("Hs\v0fx")
  _G[_xzc3].Visible = true
  if _xNb.Visible == false then
    _aa3A = _aa3A + 1
    _xNb.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _CLIzB,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _CLIzB
    })
  end
end

function _R8gYH:OnExit()
  _xzc3 = _pJ4N("Hs\v0fx")
  _G[_xzc3].Visible = false
end

function _u5G:OnEnter()
  _xzc3 = _pJ4N("H7$:")
  _G[_xzc3].Visible = true
  if _QFn.Visible == false then
    _aa3A = _aa3A + 1
    _QFn.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6nb,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6nb
    })
  end
end

function _u5G:OnExit()
  _xzc3 = _pJ4N("H7$:")
  _G[_xzc3].Visible = false
end

function _T0Bj:OnEnter()
  _xzc3 = _pJ4N("H@b?.")
  _G[_xzc3].Visible = true
  if _wA5T.Visible == false then
    _aa3A = _aa3A + 1
    _wA5T.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _8MSV,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _8MSV
    })
  end
end

function _T0Bj:OnExit()
  _xzc3 = _pJ4N("H@b?.")
  _G[_xzc3].Visible = false
end

function _MYf57:OnEnter()
  _xzc3 = _pJ4N("H\027f`$_")
  _G[_xzc3].Visible = true
  if _b1Dsh.Visible == false then
    _aa3A = _aa3A + 1
    _b1Dsh.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _dXrih,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _dXrih
    })
  end
end

function _MYf57:OnExit()
  _xzc3 = _pJ4N("H\027f`$_")
  _G[_xzc3].Visible = false
end

function _EHO:OnEnter()
  _xzc3 = _pJ4N("H/xZ")
  _G[_xzc3].Visible = true
  if _X5F.Visible == false then
    _aa3A = _aa3A + 3
    _X5F.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _l1c,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _l1c
    })
  end
end

function _EHO:OnExit()
  _xzc3 = _pJ4N("H/xZ")
  _G[_xzc3].Visible = false
end

function _GVUat:OnEnter()
  _xzc3 = _pJ4N("H:P\022\029e")
  _G[_xzc3].Visible = true
  if _vxsNl.Visible == false then
    _aa3A = _aa3A + 3
    _vxsNl.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _FrfO,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _FrfO
    })
  end
end

function _GVUat:OnExit()
  _xzc3 = _pJ4N("H:P\022\029e")
  _G[_xzc3].Visible = false
end

function _Ws3r4:OnEnter()
  _xzc3 = _pJ4N("H\004\b]Yu")
  _G[_xzc3].Visible = true
  if _Lpi.Visible == false then
    _aa3A = _aa3A + 2
    _Lpi.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _zF9U,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _zF9U
    })
  end
end

function _Ws3r4:OnExit()
  _xzc3 = _pJ4N("H\004\b]Yu")
  _G[_xzc3].Visible = false
end

function _15v:OnEnter()
  _xzc3 = _pJ4N("H\028$'")
  _G[_xzc3].Visible = true
  if _hh5.Visible == false then
    _aa3A = _aa3A + 1
    _hh5.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _GBMIl,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _GBMIl
    })
  end
end

function _15v:OnExit()
  _xzc3 = _pJ4N("H\028$'")
  _G[_xzc3].Visible = false
end

function _Rkb:OnEnter()
  _xzc3 = _pJ4N("HsGX")
  _G[_xzc3].Visible = true
  if _Ir4.Visible == false then
    _aa3A = _aa3A + 2
    _Ir4.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _W0wn,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _W0wn
    })
  end
end

function _Rkb:OnExit()
  _xzc3 = _pJ4N("HsGX")
  _G[_xzc3].Visible = false
end

function _NpH_1:OnEnter()
  _xzc3 = _pJ4N("Ha\030xH\028")
  _G[_xzc3].Visible = true
  if _F7UxJ.Visible == false then
    _aa3A = _aa3A + 1
    _F7UxJ.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6R4s4,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6R4s4
    })
  end
end

function _NpH_1:OnExit()
  _xzc3 = _pJ4N("Ha\030xH\028")
  _G[_xzc3].Visible = false
end

function _Oj5:OnEnter()
  _xzc3 = _pJ4N("HZ.$")
  _G[_xzc3].Visible = true
  if _s8DYW.Visible == false then
    _aa3A = _aa3A + 2
    _s8DYW.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _DdSg,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _DdSg
    })
  end
end

function _Oj5:OnExit()
  _xzc3 = _pJ4N("HZ.$")
  _G[_xzc3].Visible = false
end

function _nzDeb:OnEnter()
  _xzc3 = _pJ4N("H\003zR1X")
  _G[_xzc3].Visible = true
  if _6t3.Visible == false then
    _aa3A = _aa3A + 1
    _6t3.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _tkL,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _tkL
    })
  end
end

function _nzDeb:OnExit()
  _xzc3 = _pJ4N("H\003zR1X")
  _G[_xzc3].Visible = false
end

function _L5mE:OnEnter()
  _xzc3 = _pJ4N("H\024$(/")
  _G[_xzc3].Visible = true
  if _R2x3c.Visible == false then
    _aa3A = _aa3A + 3
    _R2x3c.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _VG2,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _VG2
    })
  end
end

function _L5mE:OnExit()
  _xzc3 = _pJ4N("H\024$(/")
  _G[_xzc3].Visible = false
end

function _RJ37B:OnEnter()
  _xzc3 = _pJ4N("Hs&]_?")
  _G[_xzc3].Visible = true
  if _VlVF.Visible == false then
    _aa3A = _aa3A + 2
    _VlVF.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _WZJpj,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _WZJpj
    })
  end
end

function _RJ37B:OnExit()
  _xzc3 = _pJ4N("Hs&]_?")
  _G[_xzc3].Visible = false
end

function _mJNBt:OnEnter()
  _xzc3 = _pJ4N("H(&a?e")
  _G[_xzc3].Visible = true
  if _58rV1.Visible == false then
    _aa3A = _aa3A + 2
    _58rV1.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = __jJo,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = __jJo
    })
  end
end

function _mJNBt:OnExit()
  _xzc3 = _pJ4N("H(&a?e")
  _G[_xzc3].Visible = false
end

function _Ufrn:OnEnter()
  _xzc3 = _pJ4N("H\022`Y\003")
  _G[_xzc3].Visible = true
  if _fzJ.Visible == false then
    _aa3A = _aa3A + 1
    _fzJ.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Y76,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Y76
    })
  end
end

function _Ufrn:OnExit()
  _xzc3 = _pJ4N("H\022`Y\003")
  _G[_xzc3].Visible = false
end

function _ksqNz:OnEnter()
  _xzc3 = _pJ4N("HG\bUaz")
  _G[_xzc3].Visible = true
  if _9Zx.Visible == false then
    _aa3A = _aa3A + 1
    _9Zx.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _4Zc8Q,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _4Zc8Q
    })
  end
end

function _ksqNz:OnExit()
  _xzc3 = _pJ4N("HG\bUaz")
  _G[_xzc3].Visible = false
end

function _eES:OnEnter()
  _xzc3 = _pJ4N("H1/k")
  _G[_xzc3].Visible = true
  if _xRde.Visible == false then
    _aa3A = _aa3A + 1
    _xRde.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _iC8,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _iC8
    })
  end
end

function _eES:OnExit()
  _xzc3 = _pJ4N("H1/k")
  _G[_xzc3].Visible = false
end

function _49SY0:OnEnter()
  _xzc3 = _pJ4N("Hunkfb")
  _G[_xzc3].Visible = true
  if _pWXD.Visible == false then
    _aa3A = _aa3A + 1
    _pWXD.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _1qhzC,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _1qhzC
    })
  end
end

function _49SY0:OnExit()
  _xzc3 = _pJ4N("Hunkfb")
  _G[_xzc3].Visible = false
end

function _88QP:OnEnter()
  _xzc3 = _pJ4N("H\v\v#%")
  _G[_xzc3].Visible = true
  if _tYqkF.Visible == false then
    _aa3A = _aa3A + 1
    _tYqkF.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _wBUX4,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _wBUX4
    })
  end
end

function _88QP:OnExit()
  _xzc3 = _pJ4N("H\v\v#%")
  _G[_xzc3].Visible = false
end

function _zcC:OnEnter()
  _xzc3 = _pJ4N("HzoS")
  _G[_xzc3].Visible = true
  if _5aQfl.Visible == false then
    _aa3A = _aa3A + 1
    _5aQfl.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6ZAs,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _6ZAs
    })
  end
end

function _zcC:OnExit()
  _xzc3 = _pJ4N("HzoS")
  _G[_xzc3].Visible = false
end

function _qv55:OnEnter()
  _xzc3 = _pJ4N("HU'$$")
  _G[_xzc3].Visible = true
  if _Ndnz.Visible == false then
    _aa3A = _aa3A + 2
    _Ndnz.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _yYlW,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _yYlW
    })
  end
end

function _qv55:OnExit()
  _xzc3 = _pJ4N("HU'$$")
  _G[_xzc3].Visible = false
end

function _0Uk2T:OnEnter()
  _xzc3 = _pJ4N("Hb\022G\021@")
  _G[_xzc3].Visible = true
  if _ld8.Visible == false then
    _aa3A = _aa3A + 1
    _ld8.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Xke9W,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Xke9W
    })
  end
end

function _0Uk2T:OnExit()
  _xzc3 = _pJ4N("Hb\022G\021@")
  _G[_xzc3].Visible = false
end

function _nusCY:OnEnter()
  _xzc3 = _pJ4N("H\0037\bSf")
  _G[_xzc3].Visible = true
  if _16s.Visible == false then
    _aa3A = _aa3A + 1
    _16s.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _K8xI,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _K8xI
    })
  end
end

function _nusCY:OnExit()
  _xzc3 = _pJ4N("H\0037\bSf")
  _G[_xzc3].Visible = false
end

function _TnuM:OnEnter()
  _xzc3 = _pJ4N("H@\0037\027")
  _G[_xzc3].Visible = true
  if _UbaH.Visible == false then
    _aa3A = _aa3A + 1
    _UbaH.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Pzb,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Pzb
    })
  end
end

function _TnuM:OnExit()
  _xzc3 = _pJ4N("H@\0037\027")
  _G[_xzc3].Visible = false
end

function _Nv9Yj:OnEnter()
  _xzc3 = _pJ4N("Ha'nf.")
  _G[_xzc3].Visible = true
  if _O0SZl.Visible == false then
    _aa3A = _aa3A + 1
    _O0SZl.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _GDBdd,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _GDBdd
    })
  end
end

function _Nv9Yj:OnExit()
  _xzc3 = _pJ4N("Ha'nf.")
  _G[_xzc3].Visible = false
end

function _IQWp:OnEnter()
  _xzc3 = _pJ4N("HV#\004\030")
  _G[_xzc3].Visible = true
  if _OXXc7.Visible == false then
    _aa3A = _aa3A + 1
    _OXXc7.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _8Yz,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _8Yz
    })
  end
end

function _IQWp:OnExit()
  _xzc3 = _pJ4N("HV#\004\030")
  _G[_xzc3].Visible = false
end

function _ciWkK:OnEnter()
  _xzc3 = _pJ4N("Ho}\004G-")
  _G[_xzc3].Visible = true
  if _Auy.Visible == false then
    _aa3A = _aa3A + 3
    _Auy.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _oGx1U,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _oGx1U
    })
  end
end

function _ciWkK:OnExit()
  _xzc3 = _pJ4N("Ho}\004G-")
  _G[_xzc3].Visible = false
end

function _WiX3f:OnEnter()
  _xzc3 = _pJ4N("H\004}I]`")
  _G[_xzc3].Visible = true
  if _vVj8.Visible == false then
    _aa3A = _aa3A + 2
    _vVj8.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _WicD,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _WicD
    })
  end
end

function _WiX3f:OnExit()
  _xzc3 = _pJ4N("H\004}I]`")
  _G[_xzc3].Visible = false
end

function _uNO:OnEnter()
  _xzc3 = _pJ4N("H7aZ")
  _G[_xzc3].Visible = true
  if _LTG.Visible == false then
    _aa3A = _aa3A + 1
    _LTG.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _vFkT3,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _vFkT3
    })
  end
end

function _uNO:OnExit()
  _xzc3 = _pJ4N("H7aZ")
  _G[_xzc3].Visible = false
end

function _3NR:OnEnter()
  _xzc3 = _pJ4N("H]as")
  _G[_xzc3].Visible = true
  if _E50LW.Visible == false then
    _aa3A = _aa3A + 3
    _E50LW.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Avqpz,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _Avqpz
    })
  end
end

function _3NR:OnExit()
  _xzc3 = _pJ4N("H]as")
  _G[_xzc3].Visible = false
end

function _h0vSJ:OnEnter()
  _xzc3 = _pJ4N("H\tb'k&")
  _G[_xzc3].Visible = true
  if _5D4Bn.Visible == false then
    _aa3A = _aa3A + 3
    _5D4Bn.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _M36x,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _M36x
    })
  end
end

function _h0vSJ:OnExit()
  _xzc3 = _pJ4N("H\tb'k&")
  _G[_xzc3].Visible = false
end

function _71jNk:OnEnter()
  _xzc3 = _pJ4N("H_\028.aG")
  _G[_xzc3].Visible = true
  if _Y4uVn.Visible == false then
    _aa3A = _aa3A + 1
    _Y4uVn.Visible = true
    _Urwigo.MessageBox({
      Text = (((((_LIdpl .. _G[_xzc3].Name) .. _RaPla) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _TJ2,
      Callback = function(action)
        if action ~= nil then
          _LJO0_()
        end
      end
    })
  else
    _Urwigo.MessageBox({
      Text = ((((_G[_xzc3].Name .. _lblTG) .. _aa3A) .. _cRH4) .. _59yr) .. _VH3,
      Media = _TJ2
    })
  end
end

function _71jNk:OnExit()
  _xzc3 = _pJ4N("H_\028.aG")
  _G[_xzc3].Visible = false
end

function _dIrOk:OnClick()
  _Urwigo.MessageBox({
    Text = (((_pJ4N("R1}\003B\029Ge71MM1YB%7\003Ge1\be\029\003gB}\beB") .. _aa3A) .. _pJ4N("B'\023\003B")) .. _59yr) .. _pJ4N("B\003\023eE1\003g}01\003B%7\003Ge1\003\001")
  })
end

function _LJO0_()
  if _aa3A >= _59yr then
    _GxJT.Active = true
    _GxJT.Visible = true
    _3UCm.Complete = true
    i_love_Salzburg.Complete = true
    _Urwigo.MessageBox({
      Text = (((_pJ4N("R7B\t\029\beB") .. _aa3A) .. _pJ4N("B%7\003Ge1B'\023\003B")) .. _59yr) .. _pJ4N("B%7\003Ge1\003B1YY1}o\teB7\003gB\b\023(}eBE7Yg1\003Bg1YBke\029\003g\023YeBg1YB>}\003\029MG\023\023Yg}\003\029e1\003B`Y1}01\bo\t\029Me1e\001N?sWN?sWP}1MB/Y`\023M0BX1}Bg1YBk7o\t1B\003\029o\tBg1(BS\029o\t1\001"),
      Media = _1Gkxa
    })
  else
  end
  i_love_Salzburg:RequestSync()
end

return i_love_Salzburg
