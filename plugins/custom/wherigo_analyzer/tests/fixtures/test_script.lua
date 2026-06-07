-- Test Wherigo Lua Script for Unit Testing
-- This is a minimal script containing various Wherigo objects

Wherigo.Zones = {}
Wherigo.Media = {}

-- Test Zone
testZone = Wherigo.Zone({
    Id = "z_test",
    Name = "Test Zone",
    Description = "This is a test zone for unit testing.",
    Visible = true,
    Active = true,
    Media = "testMedia",
    Icon = "testIcon",
    DistanceRange = 50,
    ProximityRange = 20,
    OriginalPoint = Wherigo.ZonePoint(48.8566, 2.3522, 0),
    Points = {
        Wherigo.ZonePoint(48.8566, 2.3522, 0),
        Wherigo.ZonePoint(48.8567, 2.3523, 0),
        Wherigo.ZonePoint(48.8565, 2.3521, 0),
    }
})

-- Test Media
testMedia = Wherigo.ZMedia({
    Id = "m_test",
    Name = "Test Image",
    Description = "A test image",
    AltText = "Test alt text",
})

-- Test Character
testCharacter = Wherigo.ZCharacter({
    Id = "c_test",
    Name = "Test Character",
    Description = "A test character for the scenario.",
    Visible = true,
    Media = "charMedia",
    Icon = "charIcon",
})

-- Test Item
testItem = Wherigo.ZItem({
    Id = "i_test",
    Name = "Test Item",
    Description = "An item to be found.",
    Visible = false,
    Media = "itemMedia",
})

-- Test Task
testTask = Wherigo.ZTask({
    Id = "t_test",
    Name = "Complete the test",
    Description = "Complete this test task to proceed.",
    Visible = true,
    Active = true,
})

-- Test Timer
testTimer = Wherigo.ZTimer({
    Id = "tm_test",
    Name = "Test Timer",
    Duration = 300,  -- 5 minutes
})

-- Test Input with simple answer
testInput = Wherigo.ZInput({
    Id = "inp_test",
    Name = "Enter the secret code",
    Description = "What is the 4-digit code?",
    Type = "Text",
    Choices = {"1234", "5678", "9999"},
})

function testInput_OnGetInput(input)
    if input == "1234" then
        Wherigo.MessageBox({
            Text = "Correct! The code is 1234.",
            Media = "successMedia",
        })
    elseif Wherigo.NoCaseEquals(input, "CODE") then
        Wherigo.MessageBox({
            Text = "Correct! The code is CODE (case insensitive).",
        })
    else
        Wherigo.MessageBox({
            Text = "Incorrect code. Try again.",
        })
    end
end

-- Test Input with numeric comparison
testInputNumeric = Wherigo.ZInput({
    Id = "inp_num",
    Name = "Enter the answer",
    Description = "What is 2+2?",
    Type = "Number",
})

function testInputNumeric_OnGetInput(input)
    if input == 4 then
        Wherigo.MessageBox({
            Text = "Correct! 2+2=4",
        })
    end
end

-- Test MessageBox
Wherigo.MessageBox({
    Text = "Welcome to the test cartridge!",
    Media = "welcomeMedia",
})

-- Test Dialog
Wherigo.Dialog({
    Text = "This is a dialog message.",
    Buttons = {"OK", "Cancel"},
})

-- Cartridge metadata
Cartridge = {
    Name = "Test Wherigo Cartridge",
    Description = "This is a test cartridge for unit testing the analyzer plugin.",
    Author = "Test Author",
    Version = "1.0.0",
    CompletionCode = "TEST123COMPLETION",
}
