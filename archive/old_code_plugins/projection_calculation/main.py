import re
from pyproj import CRS, Transformer

class ProjectionPlugin:
    """
    Plugin permettant de :
      1. Parser des coordonnées au format 'Degrés, Minutes décimales' (N dd° mm.mmm E ddd° mm.mmm).
      2. Convertir en degrés décimaux (WGS84).
      3. Projeter vers un autre système (ex: UTM).
    """

    def __init__(self):
        self.name = "projection_plugin"
        self.description = (
            "Plugin pour convertir des coordonnées 'Degrés, Minutes décimales' "
            "en WGS84 (degrés décimaux) puis vers un autre système (UTM, etc.)."
        )

    def parse_degrees_minutes(self, coord_str: str):
        """
        Parse une chaîne de type 'N 49° 12.469 E 005° 53.158'
        et renvoie (latitude, longitude) en degrés décimaux (WGS84).
        
        Exemple format attendu :
            "N 49° 12.469 E 005° 53.158"
         ou  "S 03° 12.123 W 043° 59.999"
        
        Retourne (lat, lon) en float
        """
        # Regex pour capturer : 
        # 1) La lettre N ou S
        # 2) Degrés (dd ou ddd)
        # 3) Minutes (mm.mmm)
        # Ensuite la lettre E ou W
        # Degrés (dd ou ddd)
        # Minutes (mm.mmm)

        # Note : on autorise un ou deux chiffres pour la latitude en degrés (p.ex: 0-99)
        #        et 1 à 3 chiffres pour la longitude (0-199 possible si vous voulez être large),
        #        selon vos cas. Ici on suppose: latitude ~ (0-89)°, longitude ~ (0-179)° 
        #        (vous pouvez adapter).

        pattern = r"""
            ^\s*([NS])\s+(\d{1,2})°\s+(\d{1,2}\.\d+)\s+
            ([EW])\s+(\d{1,3})°\s+(\d{1,2}\.\d+)
            \s*$
        """
        regex = re.compile(pattern, re.VERBOSE | re.IGNORECASE)

        match = regex.match(coord_str.strip())
        if not match:
            raise ValueError(f"Format de coordonnées invalide: '{coord_str}'")

        # Groups:
        # 1 = N ou S
        # 2 = degrés lat
        # 3 = minutes lat
        # 4 = E ou W
        # 5 = degrés lon
        # 6 = minutes lon
        ns, lat_deg_str, lat_min_str, ew, lon_deg_str, lon_min_str = match.groups()

        # Convertir en float
        lat_deg = float(lat_deg_str)
        lat_min = float(lat_min_str)
        lon_deg = float(lon_deg_str)
        lon_min = float(lon_min_str)

        # Convertir en degrés décimaux
        # deg_dec = deg + min/60
        lat_dec = lat_deg + (lat_min / 60.0)
        lon_dec = lon_deg + (lon_min / 60.0)

        # Appliquer signe : S => lat négative, W => lon négative
        if ns.upper() == 'S':
            lat_dec = -lat_dec
        if ew.upper() == 'W':
            lon_dec = -lon_dec

        return lat_dec, lon_dec

    def project_coords(self, lat: float, lon: float, target_projection: str):
        """
        Projette les coordonnées lat/lon (WGS84) vers un système donné 
        (par ex: 'EPSG:32631' pour UTM zone 31N).

        Retourne (x, y)
        """
        # 1. Définir le CRS source (WGS84 lat-lon)
        crs_src = CRS.from_epsg(4326)  # WGS84

        # 2. Définir le CRS cible
        #    Si on a un code EPSG (ex: 'EPSG:32631'), on l'utilise directement.
        #    Sinon, on peut gérer un cas 'UTM' générique. 
        #    (Ici, on suppose que l'utilisateur passe un vrai code EPSG 
        #     ou 'UTM' + zone => il faut le parser.)
        
        if target_projection.upper().startswith("EPSG:"):
            crs_dst = CRS.from_string(target_projection)
        elif target_projection.upper() == "UTM":
            # Par exemple, calculer la zone en fonction de la longitude
            # => zone = floor((lon+180)/6) + 1
            # => epsg = 326XX pour hémisphère nord ou 327XX pour sud
            # Pour simplifier, on suppose qu'on est dans l'hémisphère nord
            zone = int((lon + 180) / 6) + 1
            epsg_code = 32600 + zone  
            # S'il faut gérer l'hémisphère sud: if lat < 0, epsg_code = 32700 + zone
            crs_dst = CRS.from_epsg(epsg_code)
        else:
            # Par défaut, on revient sur WGS84 (pas de projection)
            crs_dst = crs_src

        # 3. Créer le Transformer
        transformer = Transformer.from_crs(crs_src, crs_dst, always_xy=True)
        # always_xy=True => on passe (lon, lat) en argument

        x, y = transformer.transform(lon, lat)
        return x, y

    def execute(self, inputs: dict):
        """
        Point d'entrée pour le PluginManager.
        
        Inputs attendus:
          - coordinate_str (str): ex "N 49° 12.469 E 005° 53.158"
          - target_projection (str): ex "EPSG:32631", "UTM" ou "WGS84" (au choix)
        
        Retourne un dict:
        {
            "latitude_deg": float,
            "longitude_deg": float,
            "projected_x": float,
            "projected_y": float
        }
        """
        coord_str = inputs.get("coordinate_str", "")
        target_proj = inputs.get("target_projection", "WGS84")

        if not coord_str:
            raise ValueError("coordinate_str manquant ou vide.")

        # 1. Parser => lat/lon en degrés décimaux (WGS84)
        lat_dec, lon_dec = self.parse_degrees_minutes(coord_str)

        # 2. Si la target_projection n'est pas "WGS84", on projette
        if target_proj.upper() in ["WGS84", "EPSG:4326"]:
            # Pas de projection: on renvoie x=lon_dec, y=lat_dec, 
            # ou 0,0 selon la convention. 
            # Mais plus logique: on dit x=lon, y=lat pour la "projection".
            x_proj, y_proj = lon_dec, lat_dec
        else:
            x_proj, y_proj = self.project_coords(lat_dec, lon_dec, target_proj)

        return {
            "latitude_deg": lat_dec,
            "longitude_deg": lon_dec,
            "projected_x": x_proj,
            "projected_y": y_proj
        }
