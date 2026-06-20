#!/usr/bin/env python3
"""Build connected-component graphs from draw.io mxGraphModel data."""

from __future__ import annotations

import dataclasses
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


@dataclasses.dataclass
class CellRecord:
    id: str
    parent: Optional[str]
    kind: str
    style: Optional[str]
    value: Optional[str]
    geometry: Dict[str, Any]
    points: List[Dict[str, Any]]


@dataclasses.dataclass
class ComponentRecord:
    id: int
    cell_ids: List[str]
    bbox: Dict[str, Optional[float]]
    normalized_bbox: Dict[str, Optional[float]]


def _to_float(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _round(value: Optional[float], digits: int = 3) -> Optional[float]:
    if value is None:
        return None
    return round(value, digits)


def _point_key(x: Optional[float], y: Optional[float], digits: int = 3) -> Optional[Tuple[float, float]]:
    if x is None or y is None:
        return None
    return (_round(x, digits), _round(y, digits))


def _geometry_bbox(geometry: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
    x = geometry.get("x")
    y = geometry.get("y")
    w = geometry.get("width")
    h = geometry.get("height")
    if x is None or y is None or w is None or h is None:
        return None
    return x, y, x + w, y + h


def _point_bbox(points: Sequence[Dict[str, Any]]) -> Optional[Tuple[float, float, float, float]]:
    xs = [p.get("x") for p in points if p.get("x") is not None]
    ys = [p.get("y") for p in points if p.get("y") is not None]
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def parse_cell(cell: Any) -> CellRecord:
    geom_el = cell.find("mxGeometry")
    geometry = {
        "x": _to_float(geom_el.get("x")) if geom_el is not None else None,
        "y": _to_float(geom_el.get("y")) if geom_el is not None else None,
        "width": _to_float(geom_el.get("width")) if geom_el is not None else None,
        "height": _to_float(geom_el.get("height")) if geom_el is not None else None,
        "relative": geom_el.get("relative") == "1" if geom_el is not None else False,
    }
    points: List[Dict[str, Any]] = []
    if geom_el is not None:
        sequence = 0
        for child in list(geom_el):
            if child.tag == "Array":
                for pt in child.findall("mxPoint"):
                    points.append(
                        {
                            "x": _to_float(pt.get("x")),
                            "y": _to_float(pt.get("y")),
                            "role": pt.get("as") or "points",
                            "seq": sequence,
                        }
                    )
                    sequence += 1
                continue
            if child.tag != "mxPoint":
                continue
            points.append(
                {
                    "x": _to_float(child.get("x")),
                    "y": _to_float(child.get("y")),
                    "role": child.get("as") or "point",
                    "seq": sequence,
                }
            )
            sequence += 1
    return CellRecord(
        id=cell.get("id") or "",
        parent=cell.get("parent"),
        kind="edge" if cell.get("edge") == "1" else "vertex" if cell.get("vertex") == "1" else "other",
        style=cell.get("style"),
        value=cell.get("value"),
        geometry=geometry,
        points=points,
    )


class UnionFind:
    def __init__(self, items: Iterable[str]):
        items = list(items)
        self.parent = {item: item for item in items}
        self.rank = {item: 0 for item in items}

    def find(self, item: str) -> str:
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, a: str, b: str) -> None:
        ra = self.find(a)
        rb = self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb
        elif self.rank[ra] > self.rank[rb]:
            self.parent[rb] = ra
        else:
            self.parent[rb] = ra
            self.rank[ra] += 1


def _attachment_points(cell: CellRecord) -> List[Tuple[float, float]]:
    geometry = cell.geometry
    bbox = _geometry_bbox(geometry)
    if bbox is None:
        return []
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    anchors = [(cx, cy)]
    if cell.kind == "vertex":
        anchors.extend([(cx, y1), (cx, y2), (x1, cy), (x2, cy)])
    return anchors


def _collect_points(cell: CellRecord) -> List[Tuple[float, float]]:
    points: List[Tuple[float, float]] = []
    bbox = _geometry_bbox(cell.geometry)
    if bbox is not None:
        points.extend(_attachment_points(cell))
    for point in cell.points:
        if point.get("x") is not None and point.get("y") is not None:
            points.append((point["x"], point["y"]))
    return points


def build_components(cells: Sequence[CellRecord], tolerance_digits: int = 3) -> List[ComponentRecord]:
    graph_cells = [cell for cell in cells if cell.id not in {"0", "1"}]
    uf = UnionFind(cell.id for cell in graph_cells if cell.id)
    cell_by_id = {cell.id: cell for cell in graph_cells if cell.id}
    order = {cell.id: idx for idx, cell in enumerate(graph_cells) if cell.id}

    parent_map = {cell.id: cell.parent for cell in graph_cells if cell.id}

    def top_root(cell: CellRecord) -> str:
        parent = cell.parent
        if parent in {None, "0", "1"}:
            return cell.id
        while parent in parent_map and parent_map[parent] not in {None, "0", "1"}:
            parent = parent_map[parent]
        return parent if parent not in {None, "0", "1"} else cell.id

    scope_map = {cell.id: top_root(cell) for cell in graph_cells if cell.id}
    point_index: Dict[Tuple[str, float, float], List[str]] = defaultdict(list)

    for cell in graph_cells:
        if not cell.id:
            continue
        if cell.parent and cell.parent in cell_by_id and cell.parent not in {"0", "1"}:
            if scope_map.get(cell.parent) == scope_map.get(cell.id):
                uf.union(cell.id, cell.parent)
        scope = scope_map[cell.id]
        for x, y in _collect_points(cell):
            point_index[(scope, *_point_key(x, y, tolerance_digits))].append(cell.id)  # type: ignore[arg-type]

    for ids in point_index.values():
        if len(ids) < 2:
            continue
        head = ids[0]
        for other in ids[1:]:
            uf.union(head, other)

    grouped: Dict[str, List[CellRecord]] = defaultdict(list)
    for cell in graph_cells:
        if not cell.id:
            continue
        grouped[uf.find(cell.id)].append(cell)

    components: List[ComponentRecord] = []
    for comp_id, (root, comp_cells) in enumerate(
        sorted(grouped.items(), key=lambda item: min(order[c.id] for c in item[1]))
    ):
        cell_ids = [cell.id for cell in sorted(comp_cells, key=lambda c: order[c.id])]
        bbox = _component_bbox(comp_cells)
        normalized_bbox = _normalized_bbox(bbox)
        components.append(
            ComponentRecord(
                id=comp_id,
                cell_ids=cell_ids,
                bbox=bbox,
                normalized_bbox=normalized_bbox,
            )
        )
    return components


def _component_bbox(cells: Sequence[CellRecord]) -> Dict[str, Optional[float]]:
    mins_x: List[float] = []
    mins_y: List[float] = []
    maxs_x: List[float] = []
    maxs_y: List[float] = []
    for cell in cells:
        bbox = _geometry_bbox(cell.geometry)
        if bbox is not None:
            x1, y1, x2, y2 = bbox
            mins_x.append(x1)
            mins_y.append(y1)
            maxs_x.append(x2)
            maxs_y.append(y2)
        for point in cell.points:
            if point.get("x") is not None:
                mins_x.append(point["x"])
                maxs_x.append(point["x"])
            if point.get("y") is not None:
                mins_y.append(point["y"])
                maxs_y.append(point["y"])
    if not mins_x or not mins_y:
        return {"x": None, "y": None, "width": None, "height": None}
    x1 = min(mins_x)
    y1 = min(mins_y)
    x2 = max(maxs_x)
    y2 = max(maxs_y)
    return {
        "x": _round(x1),
        "y": _round(y1),
        "width": _round(x2 - x1),
        "height": _round(y2 - y1),
    }


def _normalized_bbox(bbox: Dict[str, Optional[float]]) -> Dict[str, Optional[float]]:
    x = bbox.get("x")
    y = bbox.get("y")
    w = bbox.get("width")
    h = bbox.get("height")
    if x is None or y is None or w is None or h is None or not w or not h:
        return {"x": None, "y": None, "width": None, "height": None}
    return {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}


def summarize_components(components: Sequence[ComponentRecord]) -> Dict[str, Any]:
    return {
        "component_count": len(components),
        "components": [dataclasses.asdict(component) for component in components],
    }
