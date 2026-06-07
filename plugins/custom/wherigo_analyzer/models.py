"""Dataclasses for Wherigo cartridge analysis results."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class WherigoPoint:
    """A geographic point with optional altitude."""
    lat: Optional[float] = None
    lon: Optional[float] = None
    alt: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "lat": self.lat,
            "lon": self.lon,
            "alt": self.alt
        }


@dataclass
class DetectedAnswer:
    """A probable answer detected in the Lua code."""
    value: str = ""
    method: str = "unknown"  # plain_text, nocase, numeric, hash, unknown
    confidence: str = "medium"  # high, medium, low
    source: str = ""  # Function or line where detected
    candidates: Dict[str, Any] = field(default_factory=dict)  # Brute force candidates for hashes

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "value": self.value,
            "method": self.method,
            "confidence": self.confidence,
            "source": self.source
        }
        if self.candidates:
            result["candidates"] = self.candidates
        return result


@dataclass
class WherigoZone:
    """A Wherigo Zone object."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    description: str = ""
    visible: Optional[bool] = None
    active: Optional[bool] = None
    media: str = ""
    icon: str = ""
    distance_range: Optional[float] = None
    proximity_range: Optional[float] = None
    original_point: WherigoPoint = field(default_factory=WherigoPoint)
    points: List[WherigoPoint] = field(default_factory=list)
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "visible": self.visible,
            "active": self.active,
            "media": self.media,
            "icon": self.icon,
            "distance_range": self.distance_range,
            "proximity_range": self.proximity_range,
            "original_point": self.original_point.to_dict(),
            "points": [p.to_dict() for p in self.points],
            "raw": self.raw
        }


@dataclass
class WherigoMedia:
    """A Wherigo Media object (image, sound, etc.)."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    description: str = ""
    alt_text: str = ""
    type: str = ""  # image, sound, etc.
    filename: str = ""
    extracted_path: str = ""
    mime_type: str = ""
    size: Optional[int] = None
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "alt_text": self.alt_text,
            "type": self.type,
            "filename": self.filename,
            "extracted_path": self.extracted_path,
            "mime_type": self.mime_type,
            "size": self.size,
            "raw": self.raw
        }


@dataclass
class WherigoCharacter:
    """A Wherigo Character (ZCharacter) object."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    description: str = ""
    visible: Optional[bool] = None
    media: str = ""
    icon: str = ""
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "visible": self.visible,
            "media": self.media,
            "icon": self.icon,
            "raw": self.raw
        }


@dataclass
class WherigoItem:
    """A Wherigo Item (ZItem) object."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    description: str = ""
    visible: Optional[bool] = None
    media: str = ""
    icon: str = ""
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "visible": self.visible,
            "media": self.media,
            "icon": self.icon,
            "raw": self.raw
        }


@dataclass
class WherigoTask:
    """A Wherigo Task (ZTask) object."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    description: str = ""
    visible: Optional[bool] = None
    active: Optional[bool] = None
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "visible": self.visible,
            "active": self.active,
            "raw": self.raw
        }


@dataclass
class WherigoTimer:
    """A Wherigo Timer (ZTimer) object."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    duration: Optional[int] = None  # in seconds
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "duration": self.duration,
            "raw": self.raw
        }


@dataclass
class WherigoInput:
    """A Wherigo Input (ZInput) object."""
    internal_name: str = ""
    id: str = ""
    name: str = ""
    description: str = ""
    input_type: str = ""  # Text, Number, etc.
    choices: List[str] = field(default_factory=list)
    answers: List[DetectedAnswer] = field(default_factory=list)
    handler: str = ""  # Function name handling this input
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_name": self.internal_name,
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "input_type": self.input_type,
            "choices": self.choices,
            "answers": [a.to_dict() for a in self.answers],
            "handler": self.handler,
            "raw": self.raw
        }


@dataclass
class WherigoMessage:
    """A Wherigo MessageBox or Dialog."""
    type: str = "messagebox"  # messagebox, dialog
    title: str = ""
    text: str = ""
    media: str = ""
    buttons: List[str] = field(default_factory=list)
    raw: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "title": self.title,
            "text": self.text,
            "media": self.media,
            "buttons": self.buttons,
            "raw": self.raw
        }


@dataclass
class WherigoCartridge:
    """Metadata about the Wherigo cartridge."""
    name: str = ""
    guid: str = ""
    description: str = ""
    author: str = ""
    completion_code: str = ""
    version: str = ""
    platform: str = ""  # PocketPC, Garmin, etc.
    start: WherigoPoint = field(default_factory=WherigoPoint)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "guid": self.guid,
            "description": self.description,
            "author": self.author,
            "completion_code": self.completion_code,
            "version": self.version,
            "platform": self.platform,
            "start": self.start.to_dict()
        }


@dataclass
class LuaInfo:
    """Information about Lua bytecode and decompilation."""
    available: bool = False
    bytecode_extracted: bool = False
    decompiled: bool = False
    decompiler: Optional[str] = None
    path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "available": self.available,
            "bytecode_extracted": self.bytecode_extracted,
            "decompiled": self.decompiled,
            "decompiler": self.decompiler,
            "path": self.path
        }


@dataclass
class DeobfuscationInfo:
    """Information about deobfuscation attempts."""
    detected: List[str] = field(default_factory=list)
    applied: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "detected": self.detected,
            "applied": self.applied,
            "warnings": self.warnings
        }


@dataclass
class SourceInfo:
    """Information about the source file being analyzed."""
    filename: str = ""
    type: str = ""  # gwc, lua
    status: str = "ok"  # ok, partial, error
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "filename": self.filename,
            "type": self.type,
            "status": self.status,
            "warnings": self.warnings,
            "errors": self.errors
        }


@dataclass
class WherigoAnalysisResult:
    """Complete result of a Wherigo cartridge analysis."""
    source: SourceInfo = field(default_factory=SourceInfo)
    cartridge: WherigoCartridge = field(default_factory=WherigoCartridge)
    lua: LuaInfo = field(default_factory=LuaInfo)
    zones: List[WherigoZone] = field(default_factory=list)
    media: List[WherigoMedia] = field(default_factory=list)
    characters: List[WherigoCharacter] = field(default_factory=list)
    items: List[WherigoItem] = field(default_factory=list)
    tasks: List[WherigoTask] = field(default_factory=list)
    timers: List[WherigoTimer] = field(default_factory=list)
    inputs: List[WherigoInput] = field(default_factory=list)
    messages: List[WherigoMessage] = field(default_factory=list)
    variables: List[Dict[str, Any]] = field(default_factory=list)
    deobfuscation: DeobfuscationInfo = field(default_factory=DeobfuscationInfo)

    def to_dict(self) -> Dict[str, Any]:
        """Convert the entire result to a dictionary."""
        return {
            "source": self.source.to_dict(),
            "cartridge": self.cartridge.to_dict(),
            "lua": self.lua.to_dict(),
            "zones": [z.to_dict() for z in self.zones],
            "media": [m.to_dict() for m in self.media],
            "characters": [c.to_dict() for c in self.characters],
            "items": [i.to_dict() for i in self.items],
            "tasks": [t.to_dict() for t in self.tasks],
            "timers": [t.to_dict() for t in self.timers],
            "inputs": [i.to_dict() for i in self.inputs],
            "messages": [m.to_dict() for m in self.messages],
            "variables": self.variables,
            "deobfuscation": self.deobfuscation.to_dict()
        }

    def to_geojson(self) -> Dict[str, Any]:
        """Convert zones to GeoJSON format."""
        features = []
        for zone in self.zones:
            if zone.original_point.lat is not None and zone.original_point.lon is not None:
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [zone.original_point.lon, zone.original_point.lat]
                    },
                    "properties": {
                        "name": zone.name or zone.internal_name,
                        "description": zone.description,
                        "internal_name": zone.internal_name,
                        "id": zone.id,
                        "visible": zone.visible,
                        "active": zone.active,
                        "media": zone.media,
                        "icon": zone.icon
                    }
                }
                features.append(feature)

            # Add polygon if multiple points
            if len(zone.points) > 1:
                coords = [[p.lon, p.lat] for p in zone.points if p.lat is not None and p.lon is not None]
                if coords:
                    feature = {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [coords + [coords[0]]]  # Close the polygon
                        },
                        "properties": {
                            "name": zone.name or zone.internal_name,
                            "description": zone.description,
                            "internal_name": zone.internal_name,
                            "id": zone.id,
                            "visible": zone.visible,
                            "active": zone.active
                        }
                    }
                    features.append(feature)

        return {
            "type": "FeatureCollection",
            "features": features
        }
