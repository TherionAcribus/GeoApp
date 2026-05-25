"""Formatting helpers for WGS84 latitude/longitude coordinates."""

from __future__ import annotations

from typing import Dict


def format_ddm_component(value: float, is_latitude: bool, precision: int = 3) -> str:
    hemisphere = ("N" if value >= 0 else "S") if is_latitude else ("E" if value >= 0 else "W")
    absolute = abs(value)
    degrees = int(absolute)
    minutes = (absolute - degrees) * 60.0
    degree_width = 2 if is_latitude else 3
    minute_width = 3 + precision
    return f"{hemisphere} {degrees:0{degree_width}d}{chr(176)} {minutes:0{minute_width}.{precision}f}"


def format_ddm(latitude: float, longitude: float, precision: int = 3) -> str:
    return f"{format_ddm_component(latitude, True, precision)} {format_ddm_component(longitude, False, precision)}"


def format_dms_component(value: float, is_latitude: bool, precision: int = 2) -> str:
    hemisphere = ("N" if value >= 0 else "S") if is_latitude else ("E" if value >= 0 else "W")
    absolute = abs(value)
    degrees = int(absolute)
    minutes_float = (absolute - degrees) * 60.0
    minutes = int(minutes_float)
    seconds = (minutes_float - minutes) * 60.0
    degree_width = 2 if is_latitude else 3
    return f"{hemisphere} {degrees:0{degree_width}d}{chr(176)} {minutes:02d}' {seconds:0{3 + precision}.{precision}f}\""


def format_dms(latitude: float, longitude: float, precision: int = 2) -> str:
    return f"{format_dms_component(latitude, True, precision)} {format_dms_component(longitude, False, precision)}"


def format_dd(latitude: float, longitude: float, precision: int = 6) -> str:
    return f"{latitude:.{precision}f}, {longitude:.{precision}f}"


def build_latlon_formats(latitude: float, longitude: float, precision: int = 6) -> Dict[str, str]:
    ddm_precision = 3 if precision > 3 else max(0, precision)
    dms_precision = 2 if precision > 2 else max(0, precision)
    return {
        "dd": format_dd(latitude, longitude, precision),
        "ddm": format_ddm(latitude, longitude, ddm_precision),
        "dms": format_dms(latitude, longitude, dms_precision),
    }
