#!/usr/bin/env python3
"""Parse draw.io diagrams into CellGraph data."""

from __future__ import annotations

import argparse
import dataclasses
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from graph_builder import CellRecord, build_components, parse_cell, summarize_components


PROGRAM_VERSION = "0.1.0"
SCHEMA_VERSION = 1


@dataclasses.dataclass
class PageRecord:
    name: str
    id: str
    graph: Dict[str, Any]
    cells: List[Dict[str, Any]]
    components: Dict[str, Any]


def _load_xml(path: Path) -> ET.Element:
    return ET.fromstring(path.read_text())


def _find_graph_model(diagram: ET.Element) -> ET.Element:
    graph_model = diagram.find("mxGraphModel")
    if graph_model is not None:
        return graph_model
    text = (diagram.text or "").strip()
    if not text:
        raise ValueError("diagram contains no mxGraphModel")
    return ET.fromstring(text)


def _parse_cells(graph_model: ET.Element) -> List[CellRecord]:
    root = graph_model.find("root")
    if root is None:
        raise ValueError("mxGraphModel is missing root")
    cells = []
    for cell in root.findall("mxCell"):
        cells.append(parse_cell(cell))
    return cells


def _page_size(graph_model: ET.Element) -> Dict[str, Optional[float]]:
    return {
        "dx": _to_float(graph_model.get("dx")),
        "dy": _to_float(graph_model.get("dy")),
        "gridSize": _to_float(graph_model.get("gridSize")),
        "pageWidth": _to_float(graph_model.get("pageWidth")),
        "pageHeight": _to_float(graph_model.get("pageHeight")),
    }


def _to_float(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def build_drawio_graph(path: Path) -> Dict[str, Any]:
    root = _load_xml(path)
    pages: List[Dict[str, Any]] = []
    for diagram in root.findall("diagram"):
        graph_model = _find_graph_model(diagram)
        cells = _parse_cells(graph_model)
        components = build_components(cells)
        pages.append(
            {
                "name": diagram.get("name"),
                "id": diagram.get("id"),
                "graph": _page_size(graph_model),
                "cells": [dataclasses.asdict(cell) for cell in cells],
                "components": summarize_components(components),
            }
        )
    return {
        "schema": "schemzip.drawio-graph",
        "schema_version": SCHEMA_VERSION,
        "program_version": PROGRAM_VERSION,
        "source_file": path.name,
        "page_count": len(pages),
        "pages": pages,
    }


def write_json(data: Dict[str, Any], path: Path) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=True, sort_keys=False) + "\n")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", default="drawio_samples/AnlogIC.drawio")
    parser.add_argument("--json", dest="json_path")
    args = parser.parse_args(argv)

    input_path = Path(args.input).resolve()
    output_path = Path(args.json_path).resolve() if args.json_path else input_path.with_suffix(".graph.json")
    data = build_drawio_graph(input_path)
    write_json(data, output_path)
    print(
        json.dumps(
            {
                "program_version": PROGRAM_VERSION,
                "schema_version": SCHEMA_VERSION,
                "pages": data["page_count"],
                "json": str(output_path),
            },
            ensure_ascii=True,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
