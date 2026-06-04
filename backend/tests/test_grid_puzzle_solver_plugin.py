import importlib.util
import sys
from pathlib import Path


def load_plugin():
    plugin_path = (
        Path(__file__).parents[2]
        / "plugins"
        / "official"
        / "grid_puzzle_solver"
        / "main.py"
    )
    spec = importlib.util.spec_from_file_location("grid_puzzle_solver_plugin", plugin_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.GridpuzzlesolverPlugin()


def test_classic_sudoku_solution_is_unique():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_classic",
            "grid": """
                530070000
                600195000
                098000060
                800060003
                400803001
                700020006
                060000280
                000419005
                000080079
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["solution_count"] == 1
    assert result["results"][0]["text_output"].splitlines()[0] == "5 3 4 6 7 8 9 1 2"
    assert result["results"][0]["grid"][8] == ["3", "4", "5", "2", "8", "6", "1", "7", "9"]


def test_invalid_sudoku_reports_clear_error():
    plugin = load_plugin()

    result = plugin.execute({"puzzle_type": "sudoku_classic", "grid": "123"})

    assert result["status"] == "error"
    assert "81 cases" in result["summary"]


def test_sudoku_x_accepts_diagonal_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_x",
            "grid": """
                153872694
                982164357
                647953218
                764219583
                529738461
                318645729
                431586972
                276391845
                895427136
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_x"
    assert result["metadata"]["constraint_count"] == 29


def test_sudoku_x_rejects_classic_grid_with_repeated_diagonal_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_x",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_anti_diagonal_accepts_solution_with_three_distinct_values_per_diagonal():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_anti_diagonal",
            "grid": """
                395246718
                286719543
                471835269
                719352486
                634987152
                528461397
                162593874
                947128635
                853674921
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_anti_diagonal"
    assert result["metadata"]["constraint_count"] == 29


def test_anti_diagonal_rejects_grid_with_too_many_diagonal_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "anti_diagonal_sudoku",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_center_dot_accepts_solution_with_unique_box_centers():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_center_dot",
            "grid": """
                842593167
                739614285
                561872934
                213749658
                957168342
                486235719
                124357896
                698421573
                375986421
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_center_dot"
    assert result["metadata"]["constraint_count"] == 28


def test_center_dot_rejects_grid_with_repeated_box_center_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_center_dot",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_windoku_accepts_solution_with_unique_extra_boxes():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_windoku",
            "grid": """
                325476981
                146398275
                789521643
                472165398
                961783524
                853249167
                214637859
                597812436
                638954712
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_windoku"
    assert result["metadata"]["constraint_count"] == 31


def test_windoku_rejects_grid_with_repeated_extra_box_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_windoku",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_girandola_accepts_solution_with_unique_extra_region():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_girandola",
            "grid": """
                538279146
                179645238
                426813579
                651392784
                394587612
                782164395
                817426953
                965738421
                243951867
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_girandola"
    assert result["metadata"]["constraint_count"] == 28


def test_girandola_rejects_grid_with_repeated_extra_region_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "girandola",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_asterisk_accepts_solution_with_unique_extra_region():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_asterisk",
            "grid": """
                164359782
                823147569
                957862314
                581473926
                396218457
                742695138
                218734695
                679521843
                435986271
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_asterisk"
    assert result["metadata"]["constraint_count"] == 28


def test_asterisk_rejects_grid_with_repeated_extra_region_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "asterisk",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_sujiken_accepts_triangular_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sujiken",
            "grid": """
                8
                34
                129
                4856
                76295
                931487
                5783612
                21457963
                693248571
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sujiken"
    assert result["metadata"]["constraint_count"] == 33
    assert result["results"][0]["grid"][8] == ["6", "9", "3", "2", "4", "8", "5", "7", "1"]


def test_sujiken_rejects_repeated_column_value():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "half_sudoku",
            "grid": """
                3
                34
                129
                4856
                76295
                931487
                5783612
                21457963
                693248571
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_samurai_sudoku_accepts_complete_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "samurai_sudoku",
            "grid": """
                697245813...346958271
                852391467...729614835
                143687925...851273649
                935418672...198746523
                416723598...534892167
                278569134...672135984
                389174256714983527416
                524936781923465381792
                761852349856217469358
                ......594167328......
                ......127538649......
                ......638249751......
                125847963481572891436
                789365412375896432175
                643291875692134657982
                568724391...961743258
                271936548...783529614
                394158726...425186793
                852419637...649378521
                936572184...258914367
                417683259...317265849
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "samurai_sudoku"
    assert result["metadata"]["constraint_count"] == 135
    assert result["results"][0]["grid"][0][:9] == ["6", "9", "7", "2", "4", "5", "8", "1", "3"]


def test_samurai_sudoku_rejects_repeated_row_value():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "gattai_5",
            "grid": """
                897245813...346958271
                852391467...729614835
                143687925...851273649
                935418672...198746523
                416723598...534892167
                278569134...672135984
                389174256714983527416
                524936781923465381792
                761852349856217469358
                ......594167328......
                ......127538649......
                ......638249751......
                125847963481572891436
                789365412375896432175
                643291875692134657982
                568724391...961743258
                271936548...783529614
                394158726...425186793
                852419637...649378521
                936572184...258914367
                417683259...317265849
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_flower_sudoku_accepts_complete_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "flower_sudoku",
            "grid": """
                ...254613897...
                ...396785412...
                ...817924653...
                789425361789245
                421673598124367
                356189247365819
                694531872946153
                578942136578492
                132768459231678
                817356924817536
                943217685493721
                265894713652984
                ...423561789...
                ...175298364...
                ...689347125...
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "flower_sudoku"
    assert result["metadata"]["constraint_count"] == 135
    assert result["results"][0]["grid"][3] == ["7", "8", "9", "4", "2", "5", "3", "6", "1", "7", "8", "9", "2", "4", "5"]


def test_flower_sudoku_rejects_repeated_row_value():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "musketry_sudoku",
            "grid": """
                ...254613897...
                ...396785412...
                ...817924653...
                889425361789245
                421673598124367
                356189247365819
                694531872946153
                578942136578492
                132768459231678
                817356924817536
                943217685493721
                265894713652984
                ...423561789...
                ...175298364...
                ...689347125...
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_sohei_sudoku_accepts_complete_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sohei_sudoku",
            "grid": """
                ......452638917......
                ......683719452......
                ......719254836......
                ......861945273......
                ......245873691......
                ......937126548......
                594218376492185967423
                738569124587369428175
                216743598361724135869
                345927681...816579234
                671485932...497213658
                982631745...253684791
                163894257614938746512
                859172463928571892346
                427356819357642351987
                ......921876453......
                ......345192786......
                ......678543129......
                ......582769314......
                ......794231865......
                ......136485297......
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sohei_sudoku"
    assert result["metadata"]["constraint_count"] == 108
    assert result["results"][0]["grid"][6] == ["5", "9", "4", "2", "1", "8", "3", "7", "6", "4", "9", "2", "1", "8", "5", "9", "6", "7", "4", "2", "3"]


def test_sohei_sudoku_rejects_repeated_row_value():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sohei",
            "grid": """
                ......552638917......
                ......683719452......
                ......719254836......
                ......861945273......
                ......245873691......
                ......937126548......
                594218376492185967423
                738569124587369428175
                216743598361724135869
                345927681...816579234
                671485932...497213658
                982631745...253684791
                163894257614938746512
                859172463928571892346
                427356819357642351987
                ......921876453......
                ......345192786......
                ......678543129......
                ......582769314......
                ......794231865......
                ......136485297......
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_kazaguruma_sudoku_accepts_complete_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "kazaguruma_sudoku",
            "grid": """
                ...471283965.........
                ...625791843.........
                ...398456217.........
                ...549627138497653821
                ...736819524265819374
                ...182345679381742956
                ...854172396548237169
                ...913564782139568247
                ...267938451726194583
                693718245967813426795
                275934816235974385612
                184526397814652971438
                859367421679385214...
                417892653148297365...
                326145789523461978...
                548679132965178423...
                961283574487932651...
                732451968312654789...
                .........896523147...
                .........734816592...
                .........251749836...
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "kazaguruma_sudoku"
    assert result["metadata"]["constraint_count"] == 135
    assert result["results"][0]["grid"][9] == ["6", "9", "3", "7", "1", "8", "2", "4", "5", "9", "6", "7", "8", "1", "3", "4", "2", "6", "7", "9", "5"]


def test_kazaguruma_sudoku_rejects_repeated_row_value():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "windmill_sudoku",
            "grid": """
                ...171283965.........
                ...625791843.........
                ...398456217.........
                ...549627138497653821
                ...736819524265819374
                ...182345679381742956
                ...854172396548237169
                ...913564782139568247
                ...267938451726194583
                693718245967813426795
                275934816235974385612
                184526397814652971438
                859367421679385214...
                417892653148297365...
                326145789523461978...
                548679132965178423...
                961283574487932651...
                732451968312654789...
                .........896523147...
                .........734816592...
                .........251749836...
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_greater_than_accepts_matching_adjacent_relation():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_greater_than",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "inequalities": {
                "horizontal": [
                    ">.......",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                ],
                "vertical": [
                    ".........",
                    ".........",
                    ".........",
                    ".........",
                    ".........",
                    ".........",
                    ".........",
                    ".........",
                ],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_greater_than"
    assert result["metadata"]["constraint_count"] == 28


def test_greater_than_rejects_contradictory_adjacent_relation():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "compdoku",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "inequalities": [{"cells": ["r1c1", "r1c2"], "relation": "<"}],
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_rossini_accepts_matching_edge_arrows():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_rossini",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "rossini": {
                "top": ["", "D", "", "", "", "U", "", "D", ""],
                "bottom": ["", "", "", "U", "", "", "", "", "D"],
                "left": ["", "", "", "", "", "", "L", "", "R"],
                "right": ["", "R", "R", "", "", "", "", "", "R"],
                "enforce_absent": True,
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_rossini"
    assert result["metadata"]["constraint_count"] == 63


def test_rossini_rejects_contradictory_arrow():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "rossini",
            "grid": """
                534678912
                672195348
                198342567
                859761423
                426853791
                713924856
                961537284
                287419635
                345286179
            """,
            "rossini": {
                "top": ["", "U", "", "", "", "U", "", "D", ""],
                "bottom": ["", "", "", "U", "", "", "", "", "D"],
                "left": ["", "", "", "", "", "", "L", "", "R"],
                "right": ["", "R", "R", "", "", "", "", "", "R"],
                "enforce_absent": True,
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_xv_accepts_matching_border_marks():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_xv",
            "grid": """
                241587693
                589643127
                763291584
                172356948
                695428731
                834179256
                916832475
                428715369
                357964812
            """,
            "xv": {
                "horizontal": [
                    ".V......",
                    "...X....",
                    "..V.X...",
                    "..V.....",
                    "....X.X.",
                    "..V.....",
                    "X...V...",
                    ".X......",
                    "....X...",
                ],
                "vertical": [
                    "..X..X..X",
                    ".......X.",
                    "..VV.....",
                    ".........",
                    "...V.....",
                    "..X.X....",
                    ".........",
                    ".........",
                ],
                "enforce_absent": True,
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_xv"
    assert result["metadata"]["constraint_count"] == 171


def test_xv_rejects_contradictory_border_mark():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "xv",
            "grid": """
                241587693
                589643127
                763291584
                172356948
                695428731
                834179256
                916832475
                428715369
                357964812
            """,
            "xv": {
                "horizontal": [
                    ".X......",
                    "...X....",
                    "..V.X...",
                    "..V.....",
                    "....X.X.",
                    "..V.....",
                    "X...V...",
                    ".X......",
                    "....X...",
                ],
                "vertical": [
                    "..X..X..X",
                    ".......X.",
                    "..VV.....",
                    ".........",
                    "...V.....",
                    "..X.X....",
                    ".........",
                    ".........",
                ],
                "enforce_absent": True,
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_watched_cells_are_extracted_in_requested_order():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_classic",
            "grid": """
                530070000
                600195000
                098000060
                800060003
                400803001
                700020006
                060000280
                000419005
                000080079
            """,
            "watched_cells": "r1c1 r1c2 r9c9",
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["watched_values"] == {"r1c1": "5", "r1c2": "3", "r9c9": "9"}
    assert result["watched_text"] == "539"
    assert result["results"][0]["watched_text"] == "539"


def test_custom_spec_can_solve_latin_square():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "custom_spec",
            "spec": """
            {
              "variant": "mini_latin_square",
              "rows": 3,
              "cols": 3,
              "symbols": ["1", "2", "3"],
              "givens": {"r1c1": "1"},
              "regions": [
                ["r1c1", "r1c2", "r1c3"],
                ["r2c1", "r2c2", "r2c3"],
                ["r3c1", "r3c2", "r3c3"],
                ["r1c1", "r2c1", "r3c1"],
                ["r1c2", "r2c2", "r3c2"],
                ["r1c3", "r2c3", "r3c3"]
              ],
              "constraints": []
            }
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is False
    assert result["solution_count"] == 2
    assert result["metadata"]["variant"] == "mini_latin_square"
