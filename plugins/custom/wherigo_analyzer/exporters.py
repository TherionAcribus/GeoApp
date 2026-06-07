"""Export utilities for Wherigo analysis results.

Provides JSON and GeoJSON export functionality.
"""

from __future__ import annotations

import json
from typing import Any, Dict
from pathlib import Path

try:
    from .models import WherigoAnalysisResult
except ImportError:
    from models import WherigoAnalysisResult


def export_json(result: WherigoAnalysisResult, indent: int = 2) -> str:
    """Export result to JSON string."""
    return json.dumps(result.to_dict(), indent=indent, ensure_ascii=False)


def export_geojson(result: WherigoAnalysisResult, indent: int = 2) -> str:
    """Export zones to GeoJSON string."""
    return json.dumps(result.to_geojson(), indent=indent, ensure_ascii=False)


def save_result_to_file(result: WherigoAnalysisResult, output_path: str | Path) -> Path:
    """Save the complete result to a JSON file."""
    path = Path(output_path)
    path.write_text(export_json(result), encoding='utf-8')
    return path


def save_geojson_to_file(result: WherigoAnalysisResult, output_path: str | Path) -> Path:
    """Save zones as GeoJSON to a file."""
    path = Path(output_path)
    path.write_text(export_geojson(result), encoding='utf-8')
    return path


def result_to_dict(result: WherigoAnalysisResult) -> Dict[str, Any]:
    """Convert result to dictionary (alias for to_dict)."""
    return result.to_dict()


def result_with_geojson(result: WherigoAnalysisResult) -> Dict[str, Any]:
    """Get result dict with embedded GeoJSON."""
    data = result.to_dict()
    data["geojson"] = result.to_geojson()
    return data
