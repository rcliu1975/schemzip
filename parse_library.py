#!/usr/bin/env python3
"""Parse draw.io mxlibrary files into a canonical stencil database.

Phase 1 of schemzip. The script reads an mxlibrary wrapper, extracts each
symbol, normalizes coordinates against the declared template size, and writes
JSON + pickle artifacts with version metadata.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import html
import json
import pickle
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


PROGRAM_VERSION = "0.1.0"
SCHEMA_VERSION = 1


@dataclasses.dataclass
class StencilTemplate:
    name: str
    width: float
    height: float
    vertices: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    source_xml: str
    meta: Dict[str, Any]


def _read_mxlibrary(path: Path) -> Tuple[List[Dict[str, Any]], bytes, str]:
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    match = re.search(r"<mxlibrary>(.*)</mxlibrary>", text, re.S)
    if not match:
        raise ValueError(f"{path} is not a valid mxlibrary wrapper")
    body = match.group(1).strip()
    items = json.loads(body)
    return items, raw, body


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


def _normalize_geometry_point(
    x: Optional[float],
    y: Optional[float],
    width: float,
    height: float,
) -> Dict[str, Optional[float]]:
    return {
        "x": _normalize_coord(x, width),
        "y": _normalize_coord(y, height),
    }


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
    # Invisible label helper cells are common in mxlibraries; they are not
    # useful for template recognition.
    if "strokeColor=none" in style and "fillColor=none" in style and "ellipse" not in style:
        return True
    return False


def _extract_vertex_point(
    cell: ET.Element,
    template_width: float,
    template_height: float,
) -> Optional[Dict[str, Any]]:
    geom = cell.find("mxGeometry")
    if geom is None:
        return None
    x = _to_float(geom.get("x"))
    y = _to_float(geom.get("y"))
    width = _to_float(geom.get("width")) or 0.0
    height = _to_float(geom.get("height")) or 0.0
    point = _normalize_geometry_point(x, y, template_width, template_height)
    point.update(
        {
            "kind": "vertex",
            "role": "geometry",
            "cell_id": cell.get("id"),
            "style": cell.get("style"),
            "width": _normalize_coord(width, template_width),
            "height": _normalize_coord(height, template_height),
        }
    )
    return point


def _extract_edge_path(
    cell: ET.Element,
    template_width: float,
    template_height: float,
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
                point = _normalize_geometry_point(x, y, template_width, template_height)
                point.update(
                    {
                        "kind": "routePoint",
                        "role": pt.get("as") or "points",
                        "cell_id": cell.get("id"),
                        "seq": sequence,
                    }
                )
                path.append(point)
                sequence += 1
            continue
        if child.tag != "mxPoint":
            continue
        x = _to_float(child.get("x"))
        y = _to_float(child.get("y"))
        point = _normalize_geometry_point(x, y, template_width, template_height)
        point.update(
            {
                "kind": "endpoint",
                "role": child.get("as") or "point",
                "cell_id": cell.get("id"),
                "seq": sequence,
            }
        )
        path.append(point)
        sequence += 1
    return path


def _extract_template(item: Dict[str, Any], source_hash: str, index: int) -> StencilTemplate:
    name = item.get("title") or f"template_{index}"
    width = _to_float(item.get("w")) or 0.0
    height = _to_float(item.get("h")) or 0.0
    xml_text = html.unescape(item.get("xml", ""))
    root = ET.fromstring(xml_text)

    vertices: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    vertex_index: Dict[Tuple[Any, ...], int] = {}

    for cell in root.findall(".//mxCell"):
        if cell.get("edge") == "1":
            path = _extract_edge_path(cell, width, height)
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
        point = _extract_vertex_point(cell, width, height)
        if point is not None:
            _dedupe_append(vertices, vertex_index, point)

    meta = {
        "source_hash": source_hash,
        "source_title": item.get("title"),
        "source_dimensions": {"w": width, "h": height},
    }
    return StencilTemplate(
        name=name,
        width=width,
        height=height,
        vertices=vertices,
        edges=edges,
        source_xml=xml_text,
        meta=meta,
    )


def build_database(input_path: Path) -> Dict[str, Any]:
    items, raw_bytes, body = _read_mxlibrary(input_path)
    source_hash = hashlib.sha256(raw_bytes).hexdigest()
    source_hash_u64 = int.from_bytes(hashlib.sha256(raw_bytes).digest()[:8], "big")
    templates = [
        dataclasses.asdict(_extract_template(item, source_hash, idx))
        for idx, item in enumerate(items)
    ]
    return {
        "schema": "schemzip.template-db",
        "schema_version": SCHEMA_VERSION,
        "program_version": PROGRAM_VERSION,
        "source_file": input_path.name,
        "source_hash": source_hash,
        "source_hash_u64": source_hash_u64,
        "template_count": len(templates),
        "templates": templates,
    }


def write_outputs(database: Dict[str, Any], json_path: Path, pickle_path: Path) -> None:
    json_path.write_text(json.dumps(database, indent=2, ensure_ascii=True, sort_keys=False) + "\n")
    with pickle_path.open("wb") as fh:
        pickle.dump(database, fh, protocol=pickle.HIGHEST_PROTOCOL)


def _default_output_paths(input_path: Path) -> Tuple[Path, Path]:
    base = input_path.parent
    return base / "template_db.json", base / "template_db.pkl"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input",
        nargs="?",
        default="Analog.xml",
        help="Path to the mxlibrary file",
    )
    parser.add_argument("--json", dest="json_path", help="Output JSON path")
    parser.add_argument("--pickle", dest="pickle_path", help="Output pickle path")
    args = parser.parse_args(argv)

    input_path = Path(args.input).resolve()
    json_path, pickle_path = _default_output_paths(input_path)
    if args.json_path:
        json_path = Path(args.json_path).resolve()
    if args.pickle_path:
        pickle_path = Path(args.pickle_path).resolve()

    database = build_database(input_path)
    write_outputs(database, json_path, pickle_path)
    print(
        json.dumps(
            {
                "program_version": PROGRAM_VERSION,
                "schema_version": SCHEMA_VERSION,
                "templates": database["template_count"],
                "json": str(json_path),
                "pickle": str(pickle_path),
            },
            ensure_ascii=True,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
