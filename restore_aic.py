#!/usr/bin/env python3
"""Restore draw.io files from schemzip AIC archives."""

from __future__ import annotations

import argparse
import copy
import gzip
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

from matcher import load_template_db


PROGRAM_VERSION = "0.1.0"
SCHEMA_VERSION = 1


def _scale_number(value: Optional[str], scale: float) -> Optional[str]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except ValueError:
        return value
    return str(round(numeric * scale, 6))


def _scale_geometry(geom: ET.Element, scale_x: float, scale_y: float) -> None:
    if geom.get("x") is not None:
        geom.set("x", _scale_number(geom.get("x"), scale_x) or geom.get("x") or "")
    if geom.get("y") is not None:
        geom.set("y", _scale_number(geom.get("y"), scale_y) or geom.get("y") or "")
    if geom.get("width") is not None:
        try:
            geom.set("width", str(round(float(geom.get("width")) * scale_x, 6)))
        except ValueError:
            pass
    if geom.get("height") is not None:
        try:
            geom.set("height", str(round(float(geom.get("height")) * scale_y, 6)))
        except ValueError:
            pass
    for point in geom.findall(".//mxPoint"):
        if point.get("x") is not None:
            point.set("x", _scale_number(point.get("x"), scale_x) or point.get("x") or "")
        if point.get("y") is not None:
            point.set("y", _scale_number(point.get("y"), scale_y) or point.get("y") or "")


def _expand_template_item(item: Dict[str, Any], source_xml: str) -> List[ET.Element]:
    prefix = item["id_prefix"]
    placement = item["placement"]

    graph_model = ET.fromstring(source_xml)
    root = graph_model.find("root")
    if root is None:
        raise ValueError("template xml missing root")

    cells = [cell for cell in root.findall("mxCell") if cell.get("id") not in {"0", "1"}]
    group_cell = next((cell for cell in cells if cell.get("style") == "group" and cell.get("vertex") == "1"), None)
    if group_cell is None:
        raise ValueError("template xml missing group cell")
    group_geom = group_cell.find("mxGeometry")
    if group_geom is None:
        raise ValueError("template group missing geometry")
    template_width = float(group_geom.get("width") or 1.0)
    template_height = float(group_geom.get("height") or 1.0)
    target_x = float(placement.get("x") or 0.0)
    target_y = float(placement.get("y") or 0.0)
    target_width = float(placement.get("width") or template_width)
    target_height = float(placement.get("height") or template_height)
    scale_x = target_width / template_width if template_width else 1.0
    scale_y = target_height / template_height if template_height else 1.0

    id_map = {"0": "0", "1": "1"}
    for cell in cells:
        cell_id = cell.get("id")
        if not cell_id:
            continue
        id_map[cell_id] = f"{prefix}{cell_id}"

    expanded: List[ET.Element] = []
    for cell in cells:
        cloned = copy.deepcopy(cell)
        cell_id = cloned.get("id")
        if cell_id:
            cloned.set("id", id_map[cell_id])
        parent = cloned.get("parent")
        if parent in id_map and parent not in {"0", "1"}:
            cloned.set("parent", id_map[parent])
        elif parent == "0":
            cloned.set("parent", "1")

        geom = cloned.find("mxGeometry")
        if geom is not None:
            if cell is group_cell:
                if geom.get("x") is not None:
                    geom.set("x", str(round(target_x, 6)))
                else:
                    geom.set("x", str(round(target_x, 6)))
                if geom.get("y") is not None:
                    geom.set("y", str(round(target_y, 6)))
                else:
                    geom.set("y", str(round(target_y, 6)))
                if geom.get("width") is not None:
                    geom.set("width", str(round(target_width, 6)))
                if geom.get("height") is not None:
                    geom.set("height", str(round(target_height, 6)))
            else:
                _scale_geometry(geom, scale_x, scale_y)
        expanded.append(cloned)
    return expanded


def _literal_cells(item: Dict[str, Any]) -> List[ET.Element]:
    return [ET.fromstring(cell_xml) for cell_xml in item.get("cells", [])]


def _build_graph_model(page: Dict[str, Any]) -> ET.Element:
    graph_attrs = page.get("graph") or {}
    attrs: Dict[str, str] = {
        "dx": str(graph_attrs.get("dx", 0) or 0),
        "dy": str(graph_attrs.get("dy", 0) or 0),
        "grid": str(graph_attrs.get("grid", 1) or 1),
        "gridSize": str(graph_attrs.get("gridSize", 10) or 10),
        "guides": str(graph_attrs.get("guides", 1) or 1),
        "tooltips": str(graph_attrs.get("tooltips", 1) or 1),
        "connect": str(graph_attrs.get("connect", 0) or 0),
        "arrows": str(graph_attrs.get("arrows", 0) or 0),
        "fold": str(graph_attrs.get("fold", 1) or 1),
        "page": str(graph_attrs.get("page", 0) or 0),
        "pageScale": str(graph_attrs.get("pageScale", 1) or 1),
        "pageWidth": str(graph_attrs.get("pageWidth", 827) or 827),
        "pageHeight": str(graph_attrs.get("pageHeight", 1169) or 1169),
        "math": str(graph_attrs.get("math", 0) or 0),
        "shadow": str(graph_attrs.get("shadow", 0) or 0),
    }
    graph_model = ET.Element("mxGraphModel", attrs)
    root = ET.SubElement(graph_model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})
    return graph_model


def restore_archive(path: Path) -> ET.Element:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    data = json.loads(raw.decode("utf-8"))
    if data.get("schema") != "schemzip.aic-archive":
        raise ValueError("unsupported archive schema")

    template_db = load_template_db(Path(__file__).with_name("template_db.json"))
    if data.get("library_hash") and template_db.get("source_hash") != data.get("library_hash"):
        raise ValueError("template database hash mismatch")
    template_by_name = {template.get("name"): template for template in template_db.get("templates", [])}

    mxfile = ET.Element("mxfile", {"host": "app.diagrams.net"})
    for page in data.get("pages", []):
        diagram = ET.SubElement(
            mxfile,
            "diagram",
            {
                "name": str(page.get("name") or "Page"),
                "id": str(page.get("id") or ""),
            },
        )
        graph_model = _build_graph_model(page)
        root = graph_model.find("root")
        assert root is not None

        dictionary = {entry["template_index"]: entry for entry in page.get("dictionary", [])}

        items = sorted(page.get("items", []), key=lambda item: item.get("order", 0))
        for item_index, item in enumerate(items):
            if item.get("kind") == "template":
                dict_entry = dictionary.get(item.get("template_index"))
                if dict_entry is None:
                    raise ValueError("missing template dictionary entry")
                template_name = dict_entry["name"]
                template = template_by_name.get(template_name)
                if template is None:
                    raise ValueError(f"missing template source for {template_name}")
                enriched_item = dict(item)
                enriched_item["id_prefix"] = f"p{item_index}_"
                for cell in _expand_template_item(enriched_item, template["source_xml"]):
                    root.append(cell)
                continue
            if item.get("kind") == "literal":
                for cell in _literal_cells(item):
                    root.append(cell)
                continue
            raise ValueError(f"unknown item kind: {item.get('kind')}")

        diagram.append(graph_model)
    return mxfile


def write_drawio(root: ET.Element, path: Path) -> None:
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(path, encoding="utf-8", xml_declaration=False)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to .aic archive")
    parser.add_argument("--output", "-o", help="Output draw.io path")
    args = parser.parse_args(argv)

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve() if args.output else input_path.with_suffix(".restored.drawio")
    root = restore_archive(input_path)
    write_drawio(root, output_path)
    print(
        json.dumps(
            {
                "archive": str(input_path),
                "output": str(output_path),
                "program_version": PROGRAM_VERSION,
                "schema_version": SCHEMA_VERSION,
            },
            ensure_ascii=True,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
