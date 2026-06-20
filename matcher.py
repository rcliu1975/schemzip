#!/usr/bin/env python3
"""Template matching helpers for schemzip archives."""

from __future__ import annotations

import dataclasses
import html
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


def _to_float(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _round(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(value, 6)


def _normalize_coord(value: Optional[float], scale: float) -> Optional[float]:
    if value is None or not scale:
        return None
    return _round(value / scale)


def _point_key(point: Dict[str, Any]) -> Tuple[Any, ...]:
    return (
        point.get("kind"),
        point.get("role"),
        point.get("x"),
        point.get("y"),
        point.get("cell_id"),
        point.get("seq"),
    )


def _dedupe_append(
    vertices: List[Dict[str, Any]],
    index: Dict[Tuple[Any, ...], int],
    point: Dict[str, Any],
) -> int:
    key = _point_key(point)
    if point.get("x") is not None and point.get("y") is not None:
        key = ("concrete", point.get("kind"), point.get("role"), point.get("x"), point.get("y"))
        existing = index.get(key)
        if existing is not None:
            return existing
    existing = index.get(key)
    if existing is not None:
        return existing
    idx = len(vertices)
    vertices.append(point)
    index[key] = idx
    return idx


def _should_skip_vertex_cell(cell: ET.Element) -> bool:
    if cell.get("id") in {"0", "1"}:
        return True
    if cell.get("edge") == "1":
        return True
    if cell.get("style") == "group":
        return True
    style = cell.get("style") or ""
    geom = cell.find("mxGeometry")
    if geom is None:
        return True
    if "strokeColor=none" in style and "fillColor=none" in style and "ellipse" not in style:
        return True
    return False


def _extract_vertex_point(
    cell: ET.Element,
    origin_x: float,
    origin_y: float,
    scale_x: float,
    scale_y: float,
) -> Optional[Dict[str, Any]]:
    geom = cell.find("mxGeometry")
    if geom is None:
        return None
    x = _to_float(geom.get("x"))
    y = _to_float(geom.get("y"))
    width = _to_float(geom.get("width")) or 0.0
    height = _to_float(geom.get("height")) or 0.0
    point = {
        "x": _normalize_coord(None if x is None else x - origin_x, scale_x),
        "y": _normalize_coord(None if y is None else y - origin_y, scale_y),
        "kind": "vertex",
        "role": "geometry",
        "cell_id": cell.get("id"),
        "style": cell.get("style"),
        "width": _normalize_coord(width, scale_x),
        "height": _normalize_coord(height, scale_y),
    }
    return point


def _extract_edge_path(
    cell: ET.Element,
    origin_x: float,
    origin_y: float,
    scale_x: float,
    scale_y: float,
) -> List[Dict[str, Any]]:
    geom = cell.find("mxGeometry")
    if geom is None:
        return []
    path: List[Dict[str, Any]] = []
    sequence = 0
    for child in list(geom):
        if child.tag == "Array":
            for pt in child.findall("mxPoint"):
                x = _to_float(pt.get("x"))
                y = _to_float(pt.get("y"))
                point = {
                    "x": _normalize_coord(None if x is None else x - origin_x, scale_x),
                    "y": _normalize_coord(None if y is None else y - origin_y, scale_y),
                    "kind": "routePoint",
                    "role": pt.get("as") or "points",
                    "cell_id": cell.get("id"),
                    "seq": sequence,
                }
                path.append(point)
                sequence += 1
            continue
        if child.tag != "mxPoint":
            continue
        x = _to_float(child.get("x"))
        y = _to_float(child.get("y"))
        point = {
            "x": _normalize_coord(None if x is None else x - origin_x, scale_x),
            "y": _normalize_coord(None if y is None else y - origin_y, scale_y),
            "kind": "endpoint",
            "role": child.get("as") or "point",
            "cell_id": cell.get("id"),
            "seq": sequence,
        }
        path.append(point)
        sequence += 1
    return path


def canonical_shape_from_cells(cells: Sequence[ET.Element]) -> Dict[str, Any]:
    group_cell = None
    for cell in cells:
        if cell.get("style") == "group" and cell.get("vertex") == "1":
            group_cell = cell
            break

    if group_cell is not None:
        geom = group_cell.find("mxGeometry")
        origin_x = 0.0
        origin_y = 0.0
        scale_x = max(_to_float(geom.get("width")) or 1.0, 1.0) if geom is not None else 1.0
        scale_y = max(_to_float(geom.get("height")) or 1.0, 1.0) if geom is not None else 1.0
    else:
        boxes: List[Tuple[float, float, float, float]] = []
        for cell in cells:
            geom = cell.find("mxGeometry")
            if geom is None:
                continue
            x = _to_float(geom.get("x"))
            y = _to_float(geom.get("y"))
            w = _to_float(geom.get("width"))
            h = _to_float(geom.get("height"))
            if x is not None and y is not None and w is not None and h is not None:
                boxes.append((x, y, x + w, y + h))
            for child in list(geom):
                if child.tag == "Array":
                    for pt in child.findall("mxPoint"):
                        px = _to_float(pt.get("x"))
                        py = _to_float(pt.get("y"))
                        if px is not None and py is not None:
                            boxes.append((px, py, px, py))
                elif child.tag == "mxPoint":
                    px = _to_float(child.get("x"))
                    py = _to_float(child.get("y"))
                    if px is not None and py is not None:
                        boxes.append((px, py, px, py))

        if boxes:
            origin_x = min(item[0] for item in boxes)
            origin_y = min(item[1] for item in boxes)
            max_x = max(item[2] for item in boxes)
            max_y = max(item[3] for item in boxes)
        else:
            origin_x = origin_y = 0.0
            max_x = max_y = 1.0
        scale_x = max(max_x - origin_x, 1.0)
        scale_y = max(max_y - origin_y, 1.0)

    vertices: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    vertex_index: Dict[Tuple[Any, ...], int] = {}

    for cell in cells:
        if cell.get("edge") == "1":
            path = _extract_edge_path(cell, origin_x, origin_y, scale_x, scale_y)
            indices: List[int] = []
            for point in path:
                indices.append(_dedupe_append(vertices, vertex_index, point))
            if len(indices) >= 2:
                for a, b in zip(indices, indices[1:]):
                    edges.append(
                        {
                            "from": a,
                            "to": b,
                            "cell_id": cell.get("id"),
                            "style": cell.get("style"),
                        }
                    )
            continue
        if _should_skip_vertex_cell(cell):
            continue
        if group_cell is not None and cell is group_cell:
            continue
        point = _extract_vertex_point(cell, origin_x, origin_y, scale_x, scale_y)
        if point is not None:
            _dedupe_append(vertices, vertex_index, point)

    return {
        "vertices": vertices,
        "edges": edges,
        "bbox": {
            "x": _round(origin_x),
            "y": _round(origin_y),
            "width": _round(scale_x),
            "height": _round(scale_y),
        },
    }


def canonical_template_signature(template: Dict[str, Any]) -> str:
    vertices = [
        {k: v for k, v in vertex.items() if k != "cell_id"}
        for vertex in template.get("vertices", [])
    ]
    edges = [
        {k: v for k, v in edge.items() if k != "cell_id"}
        for edge in template.get("edges", [])
    ]
    payload = {
        "vertices": vertices,
        "edges": edges,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def canonical_component_signature(cells: Sequence[ET.Element]) -> str:
    payload = canonical_shape_from_cells(cells)
    vertices = [
        {k: v for k, v in vertex.items() if k != "cell_id"}
        for vertex in payload["vertices"]
    ]
    edges = [
        {k: v for k, v in edge.items() if k != "cell_id"}
        for edge in payload["edges"]
    ]
    return json.dumps(
        {
            "vertices": vertices,
            "edges": edges,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )


def load_template_db(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text())
    if data.get("schema") != "schemzip.template-db":
        raise ValueError("unsupported template db schema")
    return data


def build_template_index(template_db: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    for template in template_db.get("templates", []):
        index[canonical_template_signature(template)] = template
    return index


@dataclasses.dataclass
class MatchResult:
    template: Optional[Dict[str, Any]]
    signature: str
    bbox: Dict[str, Optional[float]]
    matched: bool


def match_component(
    cells: Sequence[ET.Element],
    template_index: Dict[str, Dict[str, Any]],
) -> MatchResult:
    shape = canonical_shape_from_cells(cells)
    vertices = [
        {k: v for k, v in vertex.items() if k != "cell_id"}
        for vertex in shape["vertices"]
    ]
    edges = [
        {k: v for k, v in edge.items() if k != "cell_id"}
        for edge in shape["edges"]
    ]
    signature = json.dumps(
        {
            "vertices": vertices,
            "edges": edges,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    template = template_index.get(signature)
    return MatchResult(
        template=template,
        signature=signature,
        bbox=shape["bbox"],
        matched=template is not None,
    )
