import json
import logging
import re
from sqlalchemy import select
from ..model.prod_runtime_env import ProdRuntimeEnv
from ..obj.tobj_prod_runtime_env import ProdRuntimeEnvForm
from ..obj.vobj_prod_runtime_env import ProdRuntimeEnvObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Resp
from . import msg_err_db

logger = logging.getLogger(__name__)

# 运行环境模板默认值（取自标准《2.4 运行环境》模板）。
DEFAULT_RUNTIME_ENV = {
    "arch": "软件为B/S架构",
    "srv_cpu": "主频：至少为2GHz\n核心数：10核及以上\n指令集：x86指令集",
    "srv_memory": "容量至少为64G",
    "srv_gpu": "厂商：英伟达\n显存：至少8GB\nFP16计算性能：14TFLOPS",
    "srv_disk": "系统盘：至少为500GB\n存储盘：至少为3TB",
    "srv_nic": "千兆 PCI-E 网卡（支持 Linux 系统）",
    "srv_os": "Ubuntu 24.04LTS（64位）",
    "srv_cuda": "12.6",
    "cli_cpu": "英特尔酷睿 i5及以上",
    "cli_memory": "至少16GB",
    "cli_resolution": "1920*1080",
    "cli_os": "Windows 10 专业版（64位）及兼容版本",
    "cli_browser": "Chrome 137.0 及兼容版本",
    "net_lan": "100Mbps 及以上",
    "net_wan": "1000Mbps 及以上",
}

# 允许写入的字段（排除 id / prod_id / tables）
_EDITABLE_FIELDS = list(DEFAULT_RUNTIME_ENV.keys())

_HW_LABELS = {"CPU": "srv_cpu", "内存": "srv_memory", "GPU": "srv_gpu", "硬盘": "srv_disk", "网卡": "srv_nic"}
_CLI_LABELS = {
    "CPU": "cli_cpu",
    "内存": "cli_memory",
    "显示器分辨率": "cli_resolution",
    "操作系统": "cli_os",
    "浏览器": "cli_browser",
}
_SW_HEADERS = {"操作系统": "srv_os", "CUDA": "srv_cuda"}
_NET_HEADERS = {"局域网": "net_lan", "广域网": "net_wan"}


def default_tables(fields=None):
    f = fields or DEFAULT_RUNTIME_ENV
    return [
        {
            "key": "srv_hw",
            "title": "表1 服务器硬件配置要求",
            "cells": [
                ["配置", "要求"],
                ["CPU", f.get("srv_cpu") or ""],
                ["内存", f.get("srv_memory") or ""],
                ["GPU", f.get("srv_gpu") or ""],
                ["硬盘", f.get("srv_disk") or ""],
                ["网卡", f.get("srv_nic") or ""],
            ],
        },
        {
            "key": "srv_sw",
            "title": "表2 服务器软件配置要求",
            "cells": [
                ["操作系统", "CUDA"],
                [f.get("srv_os") or "", f.get("srv_cuda") or ""],
            ],
        },
        {
            "key": "cli",
            "title": "表3 用户端配置要求",
            "cells": [
                ["配置", "要求"],
                ["CPU", f.get("cli_cpu") or ""],
                ["内存", f.get("cli_memory") or ""],
                ["显示器分辨率", f.get("cli_resolution") or ""],
                ["操作系统", f.get("cli_os") or ""],
                ["浏览器", f.get("cli_browser") or ""],
            ],
        },
        {
            "key": "net",
            "title": "表4 网络要求",
            "cells": [
                ["配置", "局域网", "广域网"],
                ["带宽", f.get("net_lan") or "", f.get("net_wan") or ""],
            ],
        },
    ]


def fields_from_tables(tables):
    """按表头/行标签把动态表回写到固定字段；表中已删的列对应字段置空。"""
    out = {k: "" for k in _EDITABLE_FIELDS if k != "arch"}
    by_key = {}
    for t in tables or []:
        if isinstance(t, dict) and t.get("key"):
            by_key[t["key"]] = t

    def fill_label_rows(table, mapping):
        cells = (table or {}).get("cells") or []
        for row in cells[1:]:
            if not isinstance(row, list) or not row:
                continue
            field = mapping.get(str(row[0]).strip())
            if field:
                out[field] = row[1] if len(row) > 1 else ""

    def fill_header_row(table, mapping):
        cells = (table or {}).get("cells") or []
        if not cells:
            return
        headers = cells[0] if isinstance(cells[0], list) else []
        data = cells[1] if len(cells) > 1 and isinstance(cells[1], list) else []
        for i, h in enumerate(headers):
            field = mapping.get(str(h).strip())
            if field:
                out[field] = data[i] if i < len(data) else ""

    fill_label_rows(by_key.get("srv_hw"), _HW_LABELS)
    fill_header_row(by_key.get("srv_sw"), _SW_HEADERS)
    fill_label_rows(by_key.get("cli"), _CLI_LABELS)
    fill_header_row(by_key.get("net"), _NET_HEADERS)
    return out


def _parse_tables(raw, fields):
    if raw:
        try:
            tables = json.loads(raw)
            if isinstance(tables, list) and tables:
                return tables
        except Exception:
            logger.exception("")
    return default_tables(fields)


def _row_payload(row: ProdRuntimeEnv):
    data = row.dict()
    raw = data.pop("tables_json", None)
    data["tables"] = _parse_tables(raw, data)
    return data


def get_runtime_payload(prod_id):
    """供其它文档自动获取：字段 + tables（无记录时用模板默认值）。"""
    data = dict(DEFAULT_RUNTIME_ENV)
    data["tables"] = default_tables(data)
    if not prod_id:
        return data
    row: ProdRuntimeEnv = db.session.execute(
        select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == prod_id)
    ).scalars().first()
    if not row:
        return data
    payload = _row_payload(row)
    out = dict(DEFAULT_RUNTIME_ENV)
    for key in _EDITABLE_FIELDS:
        if key in payload and payload[key] is not None:
            out[key] = payload[key]
    out["tables"] = payload.get("tables") or default_tables(out)
    return out


def _nget(node, key, default=None):
    if isinstance(node, dict):
        return node.get(key, default)
    return getattr(node, key, default)


def _nset(node, key, value):
    if isinstance(node, dict):
        node[key] = value
    else:
        setattr(node, key, value)


def _heading_no(title):
    matched = re.match(r"^\s*(\d+(?:\.\d+)*)", str(title or "").strip())
    return matched.group(1) if matched else ""


def _plain_title(title):
    return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()


def find_srs_runtime_node(nodes):
    for node in nodes or []:
        title = _nget(node, "title") or ""
        if _heading_no(title) == "2.4" or _plain_title(title) == "运行环境":
            return node
        hit = find_srs_runtime_node(_nget(node, "children") or [])
        if hit:
            return hit
    return None


def cells_to_srs_table(cells, title=""):
    from ..obj.tobj_srs_doc import Table, TabHeader, TableCell
    grid = [list(row or []) for row in (cells or []) if isinstance(row, list)]
    if not grid:
        return None
    col_count = max(len(row) for row in grid)
    grid = [row + [""] * (col_count - len(row)) for row in grid]
    headers = [TabHeader(code=f"col_{i + 1}", name=str(grid[0][i] or f"列{i + 1}")) for i in range(col_count)]
    rows = []
    for body in grid[1:]:
        rows.append({f"col_{i + 1}": str(body[i] if i < len(body) else "" or "") for i in range(col_count)})
    cell_objs = [[TableCell(value=str(c or "")) for c in row] for row in grid]
    return Table(name=title or None, headers=headers, rows=rows, cells=cell_objs, show_header=1)


def srs_table_to_cells(table):
    if not table:
        return []
    data = table.dict() if hasattr(table, "dict") else (table or {})
    raw_cells = data.get("cells")
    if raw_cells:
        out = []
        for row in raw_cells:
            line = []
            for cell in row or []:
                if isinstance(cell, dict):
                    line.append(cell.get("value") or "")
                else:
                    line.append(getattr(cell, "value", None) or str(cell or ""))
            out.append(line)
        return out
    headers = data.get("headers") or []
    rows = data.get("rows") or []
    names = []
    codes = []
    for header in headers:
        if isinstance(header, dict):
            names.append(header.get("name") or "")
            codes.append(header.get("code") or "")
        else:
            names.append(getattr(header, "name", "") or "")
            codes.append(getattr(header, "code", "") or "")
    if not codes:
        return []
    grid = [names]
    for row in rows:
        grid.append([str((row or {}).get(code, "") or "") for code in codes])
    return grid


def _collect_srs_runtime_tables(node):
    collected = []
    table = _nget(node, "table")
    cells = srs_table_to_cells(table)
    if cells:
        name = ""
        if table is not None:
            name = getattr(table, "name", None) or (table.get("name") if isinstance(table, dict) else "") or ""
        collected.append({"title": name, "cells": cells})
    extras = []
    if table is not None:
        extras = getattr(table, "extra_tables", None) if not isinstance(table, dict) else table.get("extra_tables")
    for extra in extras or []:
        extra_table = extra.get("table") if isinstance(extra, dict) else getattr(extra, "table", None)
        extra_title = extra.get("title") if isinstance(extra, dict) else getattr(extra, "title", "")
        extra_cells = srs_table_to_cells(extra_table)
        if extra_cells:
            collected.append({"title": extra_title or "", "cells": extra_cells})
    for child in _nget(node, "children") or []:
        child_cells = srs_table_to_cells(_nget(child, "table"))
        if child_cells:
            collected.append({"title": _nget(child, "title") or "", "cells": child_cells})
    return collected


def _assign_runtime_tables(collected):
    tables = default_tables()
    keywords = [
        ("srv_hw", ("硬件", "服务器硬件")),
        ("srv_sw", ("软件", "CUDA")),
        ("cli", ("用户端", "客户端")),
        ("net", ("网络", "局域网", "广域网")),
    ]
    used = set()
    assigned = {}
    for key, words in keywords:
        for idx, item in enumerate(collected):
            if idx in used:
                continue
            blob = f"{item.get('title') or ''} {' '.join((item.get('cells') or [[]])[0])}"
            if any(word in blob for word in words):
                assigned[key] = item
                used.add(idx)
                break
    leftovers = [item for idx, item in enumerate(collected) if idx not in used]
    for table in tables:
        src = assigned.get(table["key"])
        if not src and leftovers:
            src = leftovers.pop(0)
        if src:
            if src.get("title"):
                table["title"] = src["title"]
            if src.get("cells"):
                table["cells"] = src["cells"]
    return tables


def apply_runtime_to_srs_tree(nodes, payload):
    """打开/导出需求文档时，用运行环境覆盖 2.4。"""
    node = find_srs_runtime_node(nodes)
    if not node or not payload:
        return nodes
    arch = payload.get("arch") or ""
    if arch:
        _nset(node, "text", arch)
    env_tables = payload.get("tables") or []
    srs_tables = []
    for item in env_tables:
        table = cells_to_srs_table(item.get("cells"), item.get("title") or "")
        if table:
            srs_tables.append((item.get("title") or "", table))
    if not srs_tables:
        return nodes
    children = _nget(node, "children") or []
    table_children = [child for child in children if srs_table_to_cells(_nget(child, "table"))]
    if table_children:
        for idx, child in enumerate(table_children):
            if idx >= len(srs_tables):
                break
            _nset(child, "table", srs_tables[idx][1])
        return nodes
    from ..obj.tobj_srs_doc import ExtraTable
    title0, first = srs_tables[0]
    first.extra_tables = [ExtraTable(title=title, table=table) for title, table in srs_tables[1:]]
    first.name = title0 or first.name
    _nset(node, "table", first)
    return nodes


def upsert_runtime_from_srs_tree(prod_id, nodes):
    """保存/导入需求文档时，把 2.4 回写到运行环境。"""
    if not prod_id:
        return False
    node = find_srs_runtime_node(nodes)
    if not node:
        return False
    collected = _collect_srs_runtime_tables(node)
    if not collected:
        return False
    tables = _assign_runtime_tables(collected)
    arch = str(_nget(node, "text") or "").strip()
    row: ProdRuntimeEnv = db.session.execute(
        select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == prod_id)
    ).scalars().first()
    if not row:
        row = ProdRuntimeEnv(prod_id=prod_id)
        db.session.add(row)
    if arch:
        row.arch = arch
    row.tables_json = json.dumps(tables, ensure_ascii=False)
    for key, value in fields_from_tables(tables).items():
        setattr(row, key, value)
    return True


def copy_prod_runtime_env_for_product(source_prod_id: int, target_prod_id: int) -> bool:
    """产品复制时：若源产品已保存运行环境，则为目标产品复制一份（目标已有则跳过）。"""
    if not source_prod_id or not target_prod_id or source_prod_id == target_prod_id:
        return False
    target_exists = db.session.execute(
        select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == target_prod_id)
    ).scalars().first()
    if target_exists:
        return False
    source = db.session.execute(
        select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == source_prod_id)
    ).scalars().first()
    if not source:
        return False
    new_row = ProdRuntimeEnv(prod_id=target_prod_id)
    for key in _EDITABLE_FIELDS:
        setattr(new_row, key, getattr(source, key, None))
    new_row.tables_json = getattr(source, "tables_json", None)
    db.session.add(new_row)
    return True


class Server(object):

    async def get_prod_runtime_env(self, prod_id: int):
        if not prod_id:
            return Resp.resp_err(msg=ts("msg_err_param"))
        row: ProdRuntimeEnv = db.session.execute(
            select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == prod_id)
        ).scalars().first()
        if row:
            return Resp.resp_ok(data=ProdRuntimeEnvObj(**_row_payload(row)))
        # 未建记录：返回模板默认值供前端预填（不落库，首次保存才创建）
        data = dict(DEFAULT_RUNTIME_ENV)
        data["prod_id"] = prod_id
        data["tables"] = default_tables(data)
        return Resp.resp_ok(data=ProdRuntimeEnvObj(**data))

    async def save_prod_runtime_env(self, form: ProdRuntimeEnvForm):
        try:
            if not form.prod_id:
                return Resp.resp_err(msg=ts("msg_err_param"))
            row: ProdRuntimeEnv = db.session.execute(
                select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == form.prod_id)
            ).scalars().first()
            if not row:
                row = ProdRuntimeEnv(prod_id=form.prod_id)
                db.session.add(row)
            payload = form.dict()
            for key in _EDITABLE_FIELDS:
                if key in payload and payload[key] is not None:
                    setattr(row, key, payload[key])
            tables = payload.get("tables")
            if isinstance(tables, list) and tables:
                row.tables_json = json.dumps(tables, ensure_ascii=False)
                for key, value in fields_from_tables(tables).items():
                    setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok(data={"id": row.id})
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
