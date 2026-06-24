import importlib.util
import sys
from pathlib import Path

import pytest


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


SIZED_SUDOKU_CONFIGS = [
    (4, 2, 2, "sudoku_4x4"),
    (6, 2, 3, "sudoku_6x6"),
    (8, 2, 4, "sudoku_8x8"),
    (10, 2, 5, "sudoku_10x10"),
    (12, 3, 4, "sudoku_12x12"),
    (15, 3, 5, "sudoku_15x15"),
    (16, 4, 4, "sudoku_16x16"),
]


def solved_sized_sudoku(size, box_rows, box_cols):
    symbols = list("123456789ABCDEFG"[:size])
    return "\n".join(
        "".join(symbols[(row * box_cols + row // box_rows + col) % size] for col in range(size))
        for row in range(size)
    )


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


@pytest.mark.parametrize("size,box_rows,box_cols,puzzle_type", SIZED_SUDOKU_CONFIGS)
def test_sized_classic_sudoku_accepts_complete_solution(size, box_rows, box_cols, puzzle_type):
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": puzzle_type,
            "grid": solved_sized_sudoku(size, box_rows, box_cols),
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == puzzle_type


def test_sized_classic_sudoku_rejects_repeated_row_value():
    plugin = load_plugin()
    grid = solved_sized_sudoku(4, 2, 2).replace("1234", "1134", 1)

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_4x4",
            "grid": grid,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_chain_sudoku_accepts_matching_chains():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "chain_sudoku_4x4",
            "grid": """
                1234
                3412
                2143
                4321
            """,
            "chains": {
                "grid": [
                    "AABB",
                    "CCDD",
                    "BBAA",
                    "DDCC",
                ]
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "chain_sudoku_4x4"
    assert result["metadata"]["constraint_count"] == 12


def test_chain_sudoku_rejects_repeated_value_in_chain():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "strimko_4x4",
            "grid": """
                1234
                3412
                2143
                4321
            """,
            "chains": [
                "AABB",
                "CCDD",
                "ABAB",
                "DDCC",
            ],
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


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


def test_argyle_accepts_solution_with_unique_marked_diagonals():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_argyle",
            "grid": """
                327568914
                496721358
                158394276
                842179635
                931685427
                765432891
                683917542
                274853169
                519246783
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_argyle"


def test_argyle_rejects_repeated_value_on_marked_diagonal():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "argyle",
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


def test_hoshi_accepts_complete_solution():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_hoshi",
            "grid": """
                123456789
                568794312
                713458269
                587694312
                243157869
                562891347
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_hoshi"


def test_hoshi_rejects_repeated_value_in_triangle():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "hoshi",
            "grid": """
                123456781
                568794312
                713458269
                587694312
                243157869
                562891347
            """,
            "max_solutions": 1,
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


def test_vudoku_accepts_matching_v_corner():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_vudoku",
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
            "vudoku": {
                "grid": [
                    ".A......",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                ],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_vudoku"
    assert result["metadata"]["constraint_count"] == 28


def test_vudoku_rejects_contradictory_v_corner():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "vudoku",
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
            "vudoku": {
                "grid": [
                    "A.......",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                    "........",
                ],
            },
            "max_solutions": 1,
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


def test_kropki_accepts_matching_dots():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_kropki",
            "grid": """
                167324958
                542869731
                839175462
                674518293
                395247186
                281693547
                723956814
                458731629
                916482375
            """,
            "kropki": {
                "horizontal": [
                    ".W.WB...",
                    "WB......",
                    ".....W..",
                    "W.W.....",
                    "...B....",
                    "......W.",
                    ".W..W...",
                    "W.W.....",
                    "...B.W..",
                ],
                "vertical": [
                    ".........",
                    ".W..W..BW",
                    "......B.W",
                    "B.W..WWWB",
                    "WW.....BW",
                    ".....B...",
                    ".......W.",
                    ".....WB..",
                ],
                "enforce_absent": True,
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_kropki"
    assert result["metadata"]["constraint_count"] == 171


def test_kropki_rejects_contradictory_dot():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "kropki",
            "grid": """
                167324958
                542869731
                839175462
                674518293
                395247186
                281693547
                723956814
                458731629
                916482375
            """,
            "kropki": {
                "horizontal": [
                    "WW.WB...",
                    "WB......",
                    ".....W..",
                    "W.W.....",
                    "...B....",
                    "......W.",
                    ".W..W...",
                    "W.W.....",
                    "...B.W..",
                ],
                "vertical": [
                    ".........",
                    ".W..W..BW",
                    "......B.W",
                    "B.W..WWWB",
                    "WW.....BW",
                    ".....B...",
                    ".......W.",
                    ".....WB..",
                ],
                "enforce_absent": True,
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_skyscraper_accepts_matching_edge_clues():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_skyscraper",
            "grid": """
                496238175
                275419863
                831675429
                648391257
                127564938
                359782641
                714856392
                582943716
                963127584
            """,
            "skyscraper": {
                "top": [3, 1, 3, 6, 3, 2, 3, 2, 2],
                "bottom": [1, 3, 3, 2, 5, 2, 3, 2, 4],
                "left": [2, 3, 2, 3, 4, 3, 3, 3, 1],
                "right": [4, 4, 1, 2, 2, 5, 2, 3, 3],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_skyscraper"
    assert result["metadata"]["constraint_count"] == 63


def test_skyscraper_rejects_contradictory_edge_clue():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "skyscraper",
            "grid": """
                496238175
                275419863
                831675429
                648391257
                127564938
                359782641
                714856392
                582943716
                963127584
            """,
            "skyscraper": {
                "top": [1, 1, 3, 6, 3, 2, 3, 2, 2],
                "bottom": [1, 3, 3, 2, 5, 2, 3, 2, 4],
                "left": [2, 3, 2, 3, 4, 3, 3, 3, 1],
                "right": [4, 4, 1, 2, 2, 5, 2, 3, 3],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_frame_accepts_matching_outside_sums():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_frame",
            "grid": """
                143285967
                852697431
                697341285
                236714859
                481956372
                975823614
                729138546
                568472193
                314569728
            """,
            "frame": {
                "top": [15, 18, 12, 11, 21, 13, 15, 17, 13],
                "bottom": [15, 9, 21, 10, 16, 19, 13, 15, 17],
                "left": [8, 15, 22, 11, 13, 21, 18, 19, 8],
                "right": [22, 8, 15, 22, 12, 11, 15, 13, 17],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_frame"
    assert result["metadata"]["constraint_count"] == 63


def test_frame_rejects_contradictory_outside_sum():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "frame",
            "grid": """
                143285967
                852697431
                697341285
                236714859
                481956372
                975823614
                729138546
                568472193
                314569728
            """,
            "frame": {
                "top": [14, 18, 12, 11, 21, 13, 15, 17, 13],
                "bottom": [15, 9, 21, 10, 16, 19, 13, 15, 17],
                "left": [8, 15, 22, 11, 13, 21, 18, 19, 8],
                "right": [22, 8, 15, 22, 12, 11, 15, 13, 17],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_outside_accepts_matching_edge_digits():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_outside",
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
            "outside": {
                "top": ["5", "79", "", "", "4", "8", "", "6", ""],
                "bottom": ["3", "4", "", "", "8", "7", "", "8", ""],
                "left": ["53", "72", "8", "85", "42", "7", "96", "7", "3"],
                "right": ["1", "8", "76", "4", "19", "65", "4", "53", "97"],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_outside"


def test_outside_rejects_missing_edge_digit():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "outside",
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
            "outside": {
                "top": ["9", "", "", "", "", "", "", "", ""],
            },
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_sandwich_accepts_matching_sums_including_zero():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_sandwich",
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
            "sandwich": {
                "top": [19, 7, 9, 18, 20, 14, 35, 12, 15],
                "bottom": [19, 7, 9, 18, 20, 14, 35, 12, 15],
                "left": [0, 0, 0, 13, 0, 3, 6, 0, 7],
                "right": [0, 0, 0, 13, 0, 3, 6, 0, 7],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_sandwich"
    assert result["metadata"]["constraint_count"] == 63


def test_sandwich_rejects_contradictory_sum():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sandwich",
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
            "sandwich": {
                "top": [18, 7, 9, 18, 20, 14, 35, 12, 15],
            },
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_little_killer_accepts_matching_diagonal_sums():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_little_killer",
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
            "little_killer": {
                "top": [
                    {"total": 50, "direction": "dr"},
                    "", "", "", "", "", "", "",
                    {"total": 38, "direction": "dl"},
                ],
                "left": ["", "", {"total": 34, "direction": "dr"}, "", "", "", "", "", ""],
                "right": [{"total": 38, "direction": "dl"}, "", "", "", "", "", "", "", ""],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_little_killer"
    assert result["metadata"]["constraint_count"] == 31


def test_little_killer_rejects_contradictory_diagonal_sum():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "little_killer",
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
            "little_killer": {
                "top": [{"total": 49, "direction": "dr"}, "", "", "", "", "", "", "", ""],
            },
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_little_unique_killer_accepts_matching_unique_diagonal_sum():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_little_unique_killer",
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
            "little_killer": {
                "top": ["", "", "", {"total": 25, "direction": "dl"}, "", "", "", "", ""],
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_little_unique_killer"
    assert result["metadata"]["constraint_count"] == 29


def test_little_unique_killer_rejects_repeated_digit_on_diagonal_sum():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "little_unique_killer",
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
            "little_killer": {
                "top": [{"total": 50, "direction": "dr"}, "", "", "", "", "", "", "", ""],
            },
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_godoku_accepts_letter_symbols():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_godoku",
            "grid": """
                ORESNMBAU
                NMUABEROS
                SBAOURMNE
                BORMESAUN
                USNRABEMO
                EAMNOUSBR
                MNSURAOEB
                AUBESONRM
                REOBMNUSA
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_godoku"
    assert result["metadata"]["symbols"] == ["O", "R", "E", "S", "N", "M", "B", "A", "U"]
    assert result["results"][0]["grid"][0] == list("ORESNMBAU")


def test_godoku_rejects_repeated_letter_in_row():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "wordoku",
            "alphabet": "ORESNMBAU",
            "grid": """
                OOESNMBAU
                NMUABEROS
                SBAOURMNE
                BORMESAUN
                USNRABEMO
                EAMNOUSBR
                MNSURAOEB
                AUBESONRM
                REOBMNUSA
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_even_odd_accepts_matching_parity_marks():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_even_odd",
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
            "parity": {
                "grid": [
                    "OOEEOEOOE",
                    "EOEOOOOEE",
                    "OOEOEEOEO",
                    "EOOOEOEEO",
                    "EEEEOOOOO",
                    "OOOOEEEOE",
                    "OEOOOOEEE",
                    "EEOEOOEOO",
                    "OEOEEEOOO",
                ]
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_even_odd"


def test_even_odd_rejects_contradictory_parity_mark():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "even_odd",
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
            "parity": {
                "grid": [
                    "EOEEOEOOE",
                    "EOEOOOOEE",
                    "OOEOEEOEO",
                    "EOOOEOEEO",
                    "EEEEOOOOO",
                    "OOOOEEEOE",
                    "OEOOOOEEE",
                    "EEOEOOEOO",
                    "OEOEEEOOO",
                ]
            },
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_non_consecutive_accepts_grid_without_adjacent_consecutive_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_non_consecutive",
            "grid": """
                286351974
                413796258
                795248613
                357962481
                829514736
                641837592
                964173825
                538629147
                172485369
            """,
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "sudoku_non_consecutive"


def test_non_consecutive_rejects_adjacent_consecutive_values():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "non_consecutive",
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


def test_nonogram_accepts_classic_picross_clues():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "nonogram",
            "row_clues": "1\n3\n5\n3\n1",
            "column_clues": [[1], [3], [5], [3], [1]],
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["solution_count"] == 1
    assert result["metadata"]["variant"] == "nonogram"
    assert result["metadata"]["constraint_count"] == 10
    assert result["results"][0]["text_output"].splitlines() == [
        "..#..",
        ".###.",
        "#####",
        ".###.",
        "..#..",
    ]
    assert result["results"][0]["grid"][2] == ["#", "#", "#", "#", "#"]


def test_nonogram_rejects_contradictory_given_cell():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "picross",
            "clues": {
                "rows": [[1], [3], [5], [3], [1]],
                "columns": [[1], [3], [5], [3], [1]],
            },
            "grid": """
                #????
                ?????
                ?????
                ?????
                ?????
            """,
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


KAKURO_TWO_BY_TWO_LAYOUT = {
    "cells": [
        ["#", {"kind": "clue", "down": 4}, {"kind": "clue", "down": 4}],
        [{"kind": "clue", "across": 4}, {"kind": "white"}, {"kind": "white"}],
        [{"kind": "clue", "across": 4}, {"kind": "white"}, {"kind": "white"}],
    ]
}


def test_kakuro_solves_cross_sums_with_distinct_digits():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "kakuro",
            "kakuro": KAKURO_TWO_BY_TWO_LAYOUT,
            "grid": [
                ["", "", ""],
                ["", "1", ""],
                ["", "", ""],
            ],
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "kakuro"
    assert result["metadata"]["constraint_count"] == 8
    assert result["results"][0]["grid"] == [
        [None, None, None],
        [None, "1", "3"],
        [None, "3", "1"],
    ]


def test_kakuro_rejects_repeated_digit_in_a_sum():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "cross_sums",
            "layout": KAKURO_TWO_BY_TWO_LAYOUT,
            "grid": [
                ["", "", ""],
                ["", "1", "1"],
                ["", "", ""],
            ],
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def test_hitori_shades_duplicates_and_keeps_white_cells_connected():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "hitori",
            "grid": [
                [1, 1],
                [1, 2],
            ],
            "max_solutions": 2,
        }
    )

    assert result["status"] == "ok"
    assert result["unique"] is True
    assert result["metadata"]["variant"] == "hitori"
    assert result["results"][0]["grid"] == [
        ["#", "1"],
        ["1", "2"],
    ]


def test_hitori_rejects_adjacent_shaded_cells():
    plugin = load_plugin()

    result = plugin.execute(
        {
            "puzzle_type": "hitori_puzzle",
            "grid": [
                [1, 1],
                [1, 2],
            ],
            "shaded": [
                [True, True],
                [False, False],
            ],
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def mine_clue_grid(solution):
    size = len(solution)
    rows = []
    for row_index, row in enumerate(solution):
        clues = []
        for col_index, value in enumerate(row):
            if value == "M":
                clues.append(".")
                continue
            total = 0
            for row_delta in (-1, 0, 1):
                for col_delta in (-1, 0, 1):
                    if row_delta == 0 and col_delta == 0:
                        continue
                    neighbor_row = row_index + row_delta
                    neighbor_col = col_index + col_delta
                    if 0 <= neighbor_row < size and 0 <= neighbor_col < size:
                        total += solution[neighbor_row][neighbor_col] == "M"
            clues.append(str(total))
        rows.append("".join(clues))
    return "\n".join(rows)


def test_sudoku_mine_accepts_matching_9x9_grid():
    plugin = load_plugin()
    solution = [
        "M..M..M..",
        ".M..M..M.",
        "..M..M..M",
        "M..M..M..",
        ".M..M..M.",
        "..M..M..M",
        "M..M..M..",
        ".M..M..M.",
        "..M..M..M",
    ]

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_mine",
            "grid": mine_clue_grid(solution),
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 1
    assert result["metadata"]["variant"] == "sudoku_mine"
    assert ["M", ".", ".", "M", ".", ".", "M", ".", "."] == result["results"][0]["grid"][0]


def test_sudoku_mine_accepts_matching_6x6_grid():
    plugin = load_plugin()
    solution = [
        "M..M..",
        ".M..M.",
        "..M..M",
        "M..M..",
        ".M..M.",
        "..M..M",
    ]

    result = plugin.execute(
        {
            "puzzle_type": "sudoku_mine_6x6",
            "grid": mine_clue_grid(solution),
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 1
    assert result["metadata"]["variant"] == "sudoku_mine_6x6"
    assert ["M", ".", ".", "M", ".", "."] == result["results"][0]["grid"][0]


def test_sudoku_mine_rejects_wrong_clue():
    plugin = load_plugin()
    solution = [
        "M..M..",
        ".M..M.",
        "..M..M",
        "M..M..",
        ".M..M.",
        "..M..M",
    ]
    rows = mine_clue_grid(solution).splitlines()
    rows[0] = "8" + rows[0][1:]

    result = plugin.execute(
        {
            "puzzle_type": "mine_sudoku_6x6",
            "grid": "\n".join(rows),
            "max_solutions": 1,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 0
    assert result["summary"] == "Aucune solution compatible avec les contraintes"


def tripod_row_region_case(size):
    symbols = "123456789ABCDEFG"[:size]
    grid = "\n".join(
        "".join(symbols[(row + col) % size] for col in range(size))
        for row in range(size)
    )
    dots = [["." for _col in range(size + 1)] for _row in range(size + 1)]
    for row in range(1, size):
        dots[row][0] = "1"
        dots[row][size] = "1"
    return grid, dots


@pytest.mark.parametrize(
    ("size", "puzzle_type"),
    [
        (4, "sudoku_tripod_4x4"),
        (5, "sudoku_tripod_5x5"),
        (6, "sudoku_tripod_6x6"),
        (7, "sudoku_tripod_7x7"),
        (8, "sudoku_tripod_8x8"),
    ],
)
def test_tripod_accepts_reconstructed_row_regions(size, puzzle_type):
    plugin = load_plugin()
    grid, dots = tripod_row_region_case(size)

    result = plugin.execute(
        {
            "puzzle_type": puzzle_type,
            "grid": grid,
            "tripod": {"dots": ["".join(row) for row in dots]},
            "max_solutions": 1,
            "solver_timeout_ms": 30000,
        }
    )

    assert result["status"] == "ok"
    assert result["solution_count"] == 1
    assert result["metadata"]["variant"] == puzzle_type
    assert "region_grid" in result["results"][0]


def test_tripod_rejects_impossible_corner_dot():
    plugin = load_plugin()
    grid, dots = tripod_row_region_case(5)
    dots[0][0] = "1"

    result = plugin.execute(
        {
            "puzzle_type": "tripod",
            "grid": grid,
            "tripod": {"dots": ["".join(row) for row in dots]},
            "max_solutions": 1,
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
