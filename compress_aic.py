#!/usr/bin/env python3
"""Compress draw.io schematics into a table-based AIC archive."""

from __future__ import annotations

import argparse
import dataclasses
import gzip
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from graph_builder import CellRecord, build_components, parse_cell
from matcher import build_template_index, canonical_shape_from_cells, load_template_db, match_component


PROGRAM_VERSION = "0.1.0"
SCHEMA_VERSION = 1


def _load_drawio(path: Path) -> ET.Element:
    return ET.fromstring(path.read_text())


def _find_graph_model(diagram: ET.Element) -> ET.Element:
    graph_model = diagram.find("mxGraphModel")
    if graph_model is not None:
        return graph_model
    text = (diagram.text or "").strip()
    if not text:
        raise ValueError("diagram contains no mxGraphModel")
    return ET.fromstring(text)


def _page_attrs(graph_model: ET.Element, diagram: ET.Element) -> Dict[str, Any]:
    return {
        "name": diagram.get("name"),
        "id": diagram.get("id"),
        "graph": {k: graph_model.get(k) for k in graph_model.keys()},
    }


def _extract_cells(graph_model: ET.Element) -> Tuple[List[CellRecord], Dict[str, ET.Element]]:
    root = graph_model.find("root")
    if root is None:
        raise ValueError("mxGraphModel is missing root")
    cells: List[CellRecord] = []
    elements: Dict[str, ET.Element] = {}
    for cell in root.findall("mxCell"):
        cell_id = cell.get("id") or ""
        if cell_id:
            elements[cell_id] = cell
        cells.append(parse_cell(cell))
    return cells, elements


def _component_order(cells: List[CellRecord], component_cell_ids: List[str]) -> int:
    order = {cell.id: idx for idx, cell in enumerate(cells) if cell.id}
    return min(order[cell_id] for cell_id in component_cell_ids if cell_id in order)


def _serialize_cell(cell: ET.Element) -> str:
    return ET.tostring(cell, encoding="unicode")


def _component_cells(component: Any, cell_elements: Dict[str, ET.Element]) -> List[ET.Element]:
    return [cell_elements[cell_id] for cell_id in component.cell_ids if cell_id in cell_elements]


def _component_placement(component: Any, component_cells: List[ET.Element]) -> Dict[str, Any]:
    for cell in component_cells:
        if cell.get("style") == "group" and cell.get("vertex") == "1":
            geom = cell.find("mxGeometry")
            if geom is not None:
                return {
                    "x": float(geom.get("x") or 0.0),
                    "y": float(geom.get("y") or 0.0),
                    "width": float(geom.get("width") or 0.0),
                    "height": float(geom.get("height") or 0.0),
                }
    return {
        "x": component.bbox["x"],
        "y": component.bbox["y"],
        "width": component.bbox["width"],
        "height": component.bbox["height"],
    }


def _build_instance_item(
    template: Dict[str, Any],
    component_cells: List[ET.Element],
    placement: Dict[str, Any],
    template_entry_index: int,
) -> Dict[str, Any]:
    return {
        "kind": "template",
        "template_index": template_entry_index,
        "template_name": template.get("name"),
        "placement": placement,
        "cell_count": len(component_cells),
    }


def _build_literal_item(component_cells: List[ET.Element], shape: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "kind": "literal",
        "bbox": shape["bbox"],
        "cell_count": len(component_cells),
        "cells": [_serialize_cell(cell) for cell in component_cells],
    }


def compress_drawio(path: Path, template_db_path: Path) -> Dict[str, Any]:
    templates = load_template_db(template_db_path)
    template_index = build_template_index(templates)
    template_list = templates.get("templates", [])

    root = _load_drawio(path)
    pages: List[Dict[str, Any]] = []

    for diagram in root.findall("diagram"):
        graph_model = _find_graph_model(diagram)
        cells, cell_elements = _extract_cells(graph_model)
        components = build_components(cells)

        ordered_components = sorted(
            components,
            key=lambda component: _component_order(cells, component.cell_ids),
        )

        items: List[Dict[str, Any]] = []
        matched_templates: Dict[str, int] = {}

        for component in ordered_components:
            component_cells = _component_cells(component, cell_elements)
            shape = canonical_shape_from_cells(component_cells)
            placement = _component_placement(component, component_cells)
            match = match_component(component_cells, template_index)
            if match.matched and match.template is not None:
                template_name = match.template.get("name")
                if template_name not in matched_templates:
                    matched_templates[template_name] = len(matched_templates)
                template_entry_index = matched_templates[template_name]
                items.append(
                    {
                        "order": _component_order(cells, component.cell_ids),
                        **_build_instance_item(
                            match.template,
                            component_cells,
                            placement,
                            template_entry_index,
                        ),
                    }
                )
                continue
            items.append(
                {
                    "order": _component_order(cells, component.cell_ids),
                    **_build_literal_item(component_cells, shape),
                }
            )

        dictionary = [
            {
                "template_index": index,
                "name": template_name,
            }
            for template_name, index in sorted(matched_templates.items(), key=lambda item: item[1])
        ]

        pages.append(
            {
                **_page_attrs(graph_model, diagram),
                "items": items,
                "component_count": len(ordered_components),
                "matched_count": sum(1 for item in items if item["kind"] == "template"),
                "literal_count": sum(1 for item in items if item["kind"] == "literal"),
                "dictionary": dictionary,
            }
        )

    return {
        "schema": "schemzip.aic-archive",
        "schema_version": SCHEMA_VERSION,
        "program_version": PROGRAM_VERSION,
        "source_file": path.name,
        "library_hash": templates.get("source_hash"),
        "page_count": len(pages),
        "pages": pages,
    }


def write_json(data: Dict[str, Any], path: Path) -> None:
    payload = json.dumps(data, ensure_ascii=True, sort_keys=False, separators=(",", ":")).encode("utf-8")
    path.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to draw.io file")
    parser.add_argument("--templates", default="template_db.json", help="Path to template_db.json")
    parser.add_argument("--output", "-o", help="Output .aic path")
    args = parser.parse_args(argv)

    input_path = Path(args.input).resolve()
    template_db_path = Path(args.templates).resolve()
    output_path = Path(args.output).resolve() if args.output else input_path.with_suffix(".aic")

    data = compress_drawio(input_path, template_db_path)
    write_json(data, output_path)
    print(
        json.dumps(
            {
                "archive": str(output_path),
                "matched": sum(page["matched_count"] for page in data["pages"]),
                "literal": sum(page["literal_count"] for page in data["pages"]),
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
