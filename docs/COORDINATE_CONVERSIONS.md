# Conversions de coordonnees

GeoApp expose un moteur commun de conversion dans `gc_backend.utils.coordinate_converters`.
Les plugins officiels utilisent cette facade afin de normaliser les entrees en WGS84 decimal,
puis de reformater le point vers la famille de formats demandee.

## Plugins

| Plugin | Usage |
| --- | --- |
| `coordinate_format_converter` | Conversions DD, DDM, DMS et Geocaching. |
| `coordinate_grid_converter` | Conversions UTM, MGRS, OSGB/OSGR et Web Mercator. |
| `coordinate_code_converter` | Conversions Geohash, Plus Codes et Mapcode. |
| `coordinate_special_converter` | Formats plus confidentiels: GARS, QTH/Maidenhead, Slippy Map Tiles, Quadkey, NAC, RD, Lambert, SwissGrid, XYZ/ECEF, Geo3x3, GeoHex, Makaney, Bosch, DFCI, S2Cells et Reverse Wherigo. |
| `coordinate_all_converter` | Conversion unifiee vers toutes les familles disponibles. C'est le plugin conseille quand le format cible n'est pas encore choisi. |

## Formats supportes

| Famille | Formats |
| --- | --- |
| Lat/Lon | `dd`, `ddm`, `dms`, alias `geocaching` |
| Grilles | `utm`, `mgrs`, `osgb`, `osgr`, `web_mercator` |
| Codes | `geohash`, `plus_code`, `mapcode` |
| Speciaux | `gars`, `qth`, `maidenhead`, `slippy`, `quadkey`, `quadtree`, `nac`, `rd`, `lambert_93`, `lambert_72`, `lambert_2008`, `etrs89_lcc`, `lambert_cc42` a `lambert_cc50`, `lambert_ntf`, `xyz`, `ecef`, `swissgrid`, `swissgrid_plus`, `gauss_kruger`, `gauss_kruger_2` a `gauss_kruger_5`, `geo3x3`, `makaney`, `bosch`, `geohex`, `dfci_grid`, `s2cell`, `reverse_wherigo`, `reverse_wherigo_10y`, `reverse_wherigo_day1976` |

Tous les resultats internes sont normalises en `latitude` et `longitude` decimales WGS84.
Quand un format decrit une zone plutot qu'un point, le centre est utilise comme point canonique
et la reponse peut contenir une `bbox`.

## Exemples utiles

| Entree | Source | Sortie cible |
| --- | --- | --- |
| `48.85837, 2.294481` | `dd` | `all` |
| `N 48° 51.502 E 002° 17.669` | `ddm` | `mgrs` |
| `31UDQ4825184674` | `auto` | `geocaching` |
| `u09tunqu5` | `auto` | `all` |
| `JN18DU` | `auto` | `geocaching` |
| `15/16594/11272` | `slippy` | `ddm` |
| `GL02C3.1` | `dfci_grid` | `geocaching` |
| `W7392967941169` | `geo3x3` | `ddm` |
| `47a8f7ef6060b111` | `s2cell` | `ddm` |

## Notes d'implementation

- Les dependances optionnelles sont importees au moment de la conversion afin de retourner des erreurs lisibles.
- `pygeodesy` couvre UTM, MGRS, OSGB/OSGR, Web Mercator et Geohash.
- `pyproj` est utilise pour RD, Lambert, SwissGrid, Gauss-Kruger, XYZ/ECEF et DFCI.
- `openlocationcode` est utilise pour Plus Codes.
- `mapcode` est utilise pour Mapcode.
- `s2sphere` est utilise pour S2Cells/Hilbert.
- La detection automatique evite les signatures trop vagues autant que possible, notamment pour les geohash sans chiffre.

## Limites connues

- Les formats courts comme QTH, Geohash ou certains codes alphanumeriques peuvent rester ambigus dans un texte long.
- Les projections via `pyproj` restent orientees WGS84/projections simples; les transformations cadastrales fines avec grilles locales ne sont pas couvertes.
- Reverse Wherigo Waldmeister/10Y est strict sur le checksum; si un triplet est invalide, la conversion retourne une erreur.
- DFCI est pertinent sur la zone France metropolitaine couverte par Lambert NTF II; hors emprise, l'encodage renvoie une valeur vide.
