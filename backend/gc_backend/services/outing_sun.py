"""
Éphémérides solaires pour la préparation de sortie.

Une sortie se termine quand il fait nuit, pas quand la liste est finie. L'heure du
coucher du soleil est donc une **contrainte de planification** au même titre que le
matériel : elle borne le nombre de caches réalisables, elle décide si la cache de nuit
passe avant ou après le repas, et elle dit si la frontale est un accessoire ou l'outil
principal.

L'algorithme est celui du *NOAA Solar Calculator*, transcrit tel quel : pas d'API, pas de
dépendance, une précision de l'ordre de la minute aux latitudes tempérées — largement
suffisante pour décider d'un ordre de visite. Au-delà des cercles polaires, le soleil peut
ne pas se lever ou ne pas se coucher : ce cas ressort explicitement (`polar_state`) plutôt
que sous forme d'heure absente, parce qu'il ne se lit pas de la même façon.

**L'heure locale est celle du poste**, pas celle des coordonnées : GeoApp tourne sur la
machine de l'utilisateur, qui géocache presque toujours dans son propre fuseau. Les heures
UTC partent aussi, pour qu'une sortie à l'étranger reste interprétable. Le décalage est
calculé pour le jour de la sortie, donc l'heure d'été est prise en compte.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

#: Zénith du lever et du coucher « officiels » : 90° augmentés de la réfraction
#: atmosphérique (34') et du demi-diamètre solaire (16'). C'est l'instant où le bord
#: supérieur du disque affleure l'horizon — celui des almanachs.
SUNRISE_ZENITH = 90.833

#: Crépuscule civil : le soleil est 6° sous l'horizon. C'est la limite au-delà de laquelle
#: on ne cherche plus une cache sans lampe.
CIVIL_ZENITH = 96.0

_MINUTES_PER_DAY = 1440


def _julian_day(day: date) -> float:
    """Jour julien à 00:00 UTC (algorithme grégorien standard)."""
    a = (14 - day.month) // 12
    y = day.year + 4800 - a
    m = day.month + 12 * a - 3
    jdn = (
        day.day
        + (153 * m + 2) // 5
        + 365 * y
        + y // 4
        - y // 100
        + y // 400
        - 32045
    )
    return jdn - 0.5


def _julian_century(day: date, longitude: float) -> float:
    """
    Siècle julien évalué au **midi solaire local** plutôt qu'à minuit UTC.

    Le soleil bouge assez dans une journée pour que le point d'évaluation compte : le
    prendre au milieu de la journée concernée évite un biais systématique de quelques
    dizaines de secondes aux longitudes éloignées de Greenwich.
    """
    return (_julian_day(day) + 0.5 - longitude / 360.0 - 2451545.0) / 36525.0


def _solar_position(jc: float) -> tuple[float, float]:
    """Déclinaison du soleil (degrés) et équation du temps (minutes) au siècle `jc`."""
    mean_long = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360.0
    mean_anom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    eccentricity = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)

    center = (
        math.sin(math.radians(mean_anom)) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + math.sin(math.radians(2 * mean_anom)) * (0.019993 - 0.000101 * jc)
        + math.sin(math.radians(3 * mean_anom)) * 0.000289
    )
    true_long = mean_long + center
    apparent_long = (
        true_long - 0.00569 - 0.00478 * math.sin(math.radians(125.04 - 1934.136 * jc))
    )

    mean_obliquity = 23.0 + (
        26.0 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60.0
    ) / 60.0
    obliquity = mean_obliquity + 0.00256 * math.cos(math.radians(125.04 - 1934.136 * jc))

    declination = math.degrees(math.asin(
        math.sin(math.radians(obliquity)) * math.sin(math.radians(apparent_long))
    ))

    vary = math.tan(math.radians(obliquity / 2.0)) ** 2
    equation_of_time = 4.0 * math.degrees(
        vary * math.sin(2 * math.radians(mean_long))
        - 2 * eccentricity * math.sin(math.radians(mean_anom))
        + 4 * eccentricity * vary * math.sin(math.radians(mean_anom))
        * math.cos(2 * math.radians(mean_long))
        - 0.5 * vary * vary * math.sin(4 * math.radians(mean_long))
        - 1.25 * eccentricity * eccentricity * math.sin(2 * math.radians(mean_anom))
    )

    return declination, equation_of_time


def _hour_angle(latitude: float, declination: float, zenith: float) -> float | None:
    """
    Demi-durée du jour en degrés, ou `None` quand le seuil n'est jamais franchi.

    Au-delà des cercles polaires, le cosinus sort de [-1, 1] : le soleil ne se lève pas ou
    ne se couche pas ce jour-là. C'est un fait à rendre tel quel, pas une erreur.
    """
    cos_hour_angle = (
        math.cos(math.radians(zenith))
        / (math.cos(math.radians(latitude)) * math.cos(math.radians(declination)))
        - math.tan(math.radians(latitude)) * math.tan(math.radians(declination))
    )
    if cos_hour_angle < -1.0 or cos_hour_angle > 1.0:
        return None
    return math.degrees(math.acos(cos_hour_angle))


def _at_minutes(day: date, minutes: float) -> datetime:
    """
    Instant UTC correspondant à `minutes` après 00:00 UTC le jour `day`.

    Tronqué à la seconde : l'algorithme est précis à la minute près, afficher des
    microsecondes ferait croire à une exactitude qu'il n'a pas.
    """
    base = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    return (base + timedelta(minutes=minutes)).replace(microsecond=0)


def _local_time(moment: datetime | None) -> str | None:
    """Heure locale du poste, au format court. C'est celle que l'utilisateur lit."""
    if moment is None:
        return None
    return moment.astimezone().strftime('%H:%M')


def _local_offset(day: date) -> tuple[str, str | None]:
    """
    Décalage local et nom du fuseau, calculés **pour le jour de la sortie**.

    Et non pour aujourd'hui : une sortie planifiée de l'autre côté d'un changement d'heure
    n'a pas le décalage du jour où on la prépare.
    """
    reference = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc).astimezone()
    offset = reference.utcoffset() or timedelta(0)
    total_minutes = int(offset.total_seconds() // 60)
    sign = '+' if total_minutes >= 0 else '-'
    hours, minutes = divmod(abs(total_minutes), 60)
    return f'{sign}{hours:02d}:{minutes:02d}', reference.tzname()


def compute_sun_times(latitude: float, longitude: float, day: date) -> dict:
    """
    Lever, coucher, crépuscules civils et durée du jour pour un point et une date.

    Le point de référence attendu est le centroïde de la sortie : sur une zone de quelques
    kilomètres, l'écart d'heure de coucher entre deux caches se compte en secondes, et un
    point unique évite de faire croire à une précision qui n'existe pas.
    """
    jc = _julian_century(day, longitude)
    declination, equation_of_time = _solar_position(jc)

    solar_noon = 720.0 - 4.0 * longitude - equation_of_time
    day_angle = _hour_angle(latitude, declination, SUNRISE_ZENITH)
    civil_angle = _hour_angle(latitude, declination, CIVIL_ZENITH)

    polar_state = None
    if day_angle is None:
        # Le signe de la déclinaison face à la latitude tranche entre les deux cas : même
        # hémisphère, le soleil ne se couche pas ; hémisphère opposé, il ne se lève pas.
        polar_state = 'polar_day' if (declination * latitude) > 0 else 'polar_night'

    sunrise = _at_minutes(day, solar_noon - 4.0 * day_angle) if day_angle is not None else None
    sunset = _at_minutes(day, solar_noon + 4.0 * day_angle) if day_angle is not None else None
    civil_dawn = _at_minutes(day, solar_noon - 4.0 * civil_angle) if civil_angle is not None else None
    civil_dusk = _at_minutes(day, solar_noon + 4.0 * civil_angle) if civil_angle is not None else None

    utc_offset, timezone_label = _local_offset(day)

    return {
        'date': day.isoformat(),
        'latitude': round(latitude, 5),
        'longitude': round(longitude, 5),
        'sunrise_utc': sunrise.isoformat() if sunrise else None,
        'sunset_utc': sunset.isoformat() if sunset else None,
        'civil_dawn_utc': civil_dawn.isoformat() if civil_dawn else None,
        'civil_dusk_utc': civil_dusk.isoformat() if civil_dusk else None,
        'solar_noon_utc': _at_minutes(day, solar_noon % _MINUTES_PER_DAY).isoformat(),
        'sunrise_local': _local_time(sunrise),
        'sunset_local': _local_time(sunset),
        'civil_dawn_local': _local_time(civil_dawn),
        'civil_dusk_local': _local_time(civil_dusk),
        'day_length_minutes': round(8.0 * day_angle) if day_angle is not None else None,
        'utc_offset': utc_offset,
        'timezone_label': timezone_label,
        # `None` en usage courant ; renseigné seulement au-delà des cercles polaires, où
        # « pas d'heure de coucher » veut dire tout autre chose qu'une donnée manquante.
        'polar_state': polar_state,
    }
