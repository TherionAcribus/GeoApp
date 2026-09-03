-- Test fixture for Urwigo obfuscation decoding
-- Simulates the Urwigo decoder pattern found in real cartridges

function _testDecode(str)
  local res = ""
  -- Simplified dtable: maps byte positions to characters
  -- Position 1 -> 'A', 2 -> 'B', etc. for testing
  local dtable = "ABCDEFGHIJKLMNOPQRSTUVWXYZ      abcdefghijklmnopqrstuvwxyz"
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

-- Test zone with obfuscated name
_testZone = Wherigo.Zone(_testCartridge)
_testZone.Id = "z_test_obf"
_testZone.Name = _testDecode("\001\002\003")
_testZone.Description = _testDecode("\004\005\006")
_testZone.OriginalPoint = Wherigo.ZonePoint(48.8566, 2.3522, 0)
_testZone.Points = {
  Wherigo.ZonePoint(48.8566, 2.3522, 0),
  Wherigo.ZonePoint(48.8567, 2.3523, 0),
}

-- Test media with obfuscated name
_testMedia = Wherigo.ZMedia(_testCartridge)
_testMedia.Id = "m_test_obf"
_testMedia.Name = _testDecode("\007\008\009")

-- Test input with obfuscated name and choices
_testInput = Wherigo.ZInput(_testCartridge)
_testInput.Name = _testDecode("\010\011\012")
_testInput.InputType = "MultipleChoice"
_testInput.Choices = {
  "OPTION_A",
  "OPTION_B",
  "OPTION_C"
}
_testInput.Text = _testDecode("\013\014\015")

function _testInput:OnGetInput(input)
  if input == nil then
    input = ""
  end
  if _Urwigo.Hash(string.lower(input)) == 12345 then
    Wherigo.MessageBox({
      Text = "Correct answer!",
    })
  end
end

-- Test message with obfuscated text
_Urwigo.MessageBox({
  Text = tostring(_testDecode("\016\017\018")),
  Media = _testMedia,
})

-- Test message with plain text
Wherigo.MessageBox({
  Text = "Hello World",
  Media = _testMedia,
})

-- Cartridge metadata
Cartridge = {
  Name = "Test Obfuscated Cartridge",
  Description = "Testing Urwigo deobfuscation",
  Author = "Test Author",
  Version = "1.0.0",
  CompletionCode = "TESTOBF123",
}
