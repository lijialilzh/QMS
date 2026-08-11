#!/usr/bin/env python
# encoding: utf-8
"""从 HLD Word 模板提取章节默认值，写入 standard_nodes.json，并回写指定 doc。"""

import asyncio
import io
import json
import re
import sys
from copy import deepcopy
from pathlib import Path

from sqlalchemy import create_engine, delete, select, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.model.hld_doc import HldDoc, HldNode  # noqa: E402
from src.obj.tobj_hld_doc import HldNodeForm  # noqa: E402
from src.serv.serv_hld_doc import Server  # noqa: E402
from src.utils.sql_ctx import db, init as db_init  # noqa: E402

STANDARD_PATH = ROOT.parent / "trace-web/trace/src/pages/hld_doc/data/standard_nodes.json"
WORD_PATH = Path(
    "/Users/lijiali/Desktop/E/体系-工作文件/1·体系-文件/31·NMPA-recist/体系文件/开发文件/"
    "TX-TF-RCN3V2000-SD-004-A0 软件概要设计.docx"
)
DB_URL = "postgresql://trace:test@127.0.0.1:55432/trace"


def norm_title(value: str) -> str:
    t = re.sub(r"^\s*\d+(?:\.\d+)*[\s、.．]*", "", str(value or "").strip())
    return re.sub(r"[\s（）()\-–—_]+", "", t).lower()


def split_numbered_sections(text: str) -> dict[str, str]:
    """按 '1.1.1. 标题' 样式切段，返回 {norm_title(标题): 正文}。"""
    if not text:
        return {}
    src = str(text).strip()
    parts = re.split(r"\n(?=\d+(?:\.\d+)*\.\s+)", src)
    out: dict[str, str] = {}
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\d+(?:\.\d+)*)\.\s*(.+?)(?:\n|$)", part)
        if not m:
            continue
        title = m.group(2).strip()
        body = part[m.end() :].strip()
        content = f"{title}\n{body}".strip() if body else title
        out[norm_title(title)] = content
    return out


def table_to_json(table) -> dict | None:
    if not table:
        return None
    if isinstance(table, dict):
        return deepcopy(table)
    if isinstance(table, str):
        try:
            return json.loads(table)
        except Exception:
            return None
    if hasattr(table, "dict"):
        return table.dict()
    return None


def load_tree(doc_id: int) -> dict[int, dict]:
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                'SELECT n_id, p_id, priority, title, ref_type, text, img_url, "table" '
                "FROM hld_node WHERE doc_id=:doc_id ORDER BY n_id"
            ),
            {"doc_id": doc_id},
        ).mappings().all()
    nodes: dict[int, dict] = {}
    for row in rows:
        item = dict(row)
        item["table"] = table_to_json(item.get("table"))
        item["children"] = []
        nodes[item["n_id"]] = item
    for node in nodes.values():
        parent = nodes.get(node["p_id"])
        if parent:
            parent["children"].append(node)
        node["children"].sort(key=lambda x: x["priority"])
    return nodes


def node_by_norm(nodes: dict[int, dict], *titles: str) -> dict | None:
    keys = {norm_title(t) for t in titles}
    for node in nodes.values():
        if norm_title(node.get("title") or "") in keys:
            return node
    return None


def embedded_table(node: dict | None) -> dict | None:
    if not node:
        return None
    if node.get("table"):
        return node["table"]
    for child in node.get("children") or []:
        title = str(child.get("title") or "")
        if child.get("table") and re.match(r"^导入表格\d*$", title):
            return child["table"]
    return None


def build_defaults_from_import_tree(nodes: dict[int, dict]) -> dict[str, str | dict]:
    defaults: dict[str, str | dict] = {}

    def put_text(title: str, value: str | None):
        if value and str(value).strip():
            defaults[f"text::{norm_title(title)}"] = str(value).strip()

    def put_table(title: str, table):
        tbl = table_to_json(table)
        if tbl:
            defaults[f"table::{norm_title(title)}"] = tbl

    put_text("1.1 目的", (node_by_norm(nodes, "1.1 目的") or {}).get("text"))
    put_text("1.2 范围", (node_by_norm(nodes, "1.2 范围") or {}).get("text"))
    put_text("1.3 参考资料", (node_by_norm(nodes, "1.3 参考资料") or {}).get("text"))
    put_table("1.4 术语", embedded_table(node_by_norm(nodes, "1.4 术语")))

    product = node_by_norm(nodes, "2.2 产品功能") or {}
    sections = split_numbered_sections(product.get("text") or "")
    mapping = {
        "2.2.1 功能模块定义": ["功能模块定义"],
        "2.2.2 DataProcessing（DP）": ["dataprocessing（dp）", "dataprocessing"],
        "2.2.3 DLServer": ["dlserver"],
        "2.2.4 RePACS": ["repacs"],
        "2.2.5 NeoViewer": ["neoviewer"],
        "2.2.6 系统性能": ["系统性能"],
    }
    for title, keys in mapping.items():
        for key in keys:
            nk = norm_title(key)
            if nk in sections:
                put_text(title, sections[nk])
                break

    runtime = node_by_norm(nodes, "2.3 运行环境") or {}
    put_text("2.3 运行环境", runtime.get("text"))
    runtime_map = {
        "2.4.1 服务器硬件环境配置见表1": ["2.4.1 服务器硬件环境配置见表1", "2.4.1服务器硬件环境配置见表1"],
        "2.4.2 服务器软件环境配置": ["2.4.2 服务器软件环境配置", "2.4.2服务器软件环境配置"],
        "2.4.3 用户端配置": ["2.4.3 用户端配置", "2.4.3用户端配置"],
        "2.4.4 服务器及用户端网络条件": ["2.4.4 服务器及用户端网络条件", "2.4.4服务器及用户端网络条件"],
    }
    for std_title, aliases in runtime_map.items():
        node = None
        for alias in aliases:
            node = node_by_norm(nodes, alias)
            if node:
                break
        put_table(std_title, embedded_table(node))

    submodule = node_by_norm(nodes, "2.4 子模块结构", "2.5 子模块结构") or {}
    sub_sections = split_numbered_sections(submodule.get("text") or "")
    sub_map = {
        "2.4.2 DP模块结构设计": ["dp模块结构设计"],
        "2.4.3 DLserver模块结构设计": ["dlserver模块结构设计"],
        "2.4.4 RePACS模块结构设计": ["repacs模块结构设计"],
        "2.4.5 NeoViewer模块结构设计": ["neoviewer模块结构设计"],
    }
    for title, keys in sub_map.items():
        for key in keys:
            nk = norm_title(key)
            if nk in sub_sections:
                put_text(title, sub_sections[nk])
                break

    put_table(
        "2.5 现成软件的功能和性能描述",
        embedded_table(node_by_norm(nodes, "2.5 现成软件的功能和性能描述", "2.6 现成软件的功能和性能描述")),
    )
    put_text(
        "2.6 现成软件项所要求的系统硬件和软件",
        (node_by_norm(nodes, "2.6 现成软件项所要求的系统硬件和软件", "2.7 现成软件项所要求的系统硬件和软件") or {}).get("text"),
    )

    put_text("3.1 用户接口", (node_by_norm(nodes, "3.1 用户接口") or {}).get("text"))
    put_text("3.2 外部接口", (node_by_norm(nodes, "3.2 外部接口") or {}).get("text"))

    internal = node_by_norm(nodes, "3.3 内部接口") or {}
    internal_sections = split_numbered_sections(internal.get("text") or "")
    internal_map = {
        "3.3.1 DataProcessing与RePACS的接口": ["dataprocessing与repacs的接口"],
        "3.3.2 RePACS与DLServer的接口": ["repacs与dlserver的接口"],
        "3.3.4 NeoViewer的接口": ["neoviewer的接口"],
    }
    for title, keys in internal_map.items():
        for key in keys:
            nk = norm_title(key)
            if nk in internal_sections:
                put_text(title, internal_sections[nk])
                break

    section_keys = list(internal_sections.keys())
    start_idx = end_idx = None
    for idx, key in enumerate(section_keys):
        if "repacs" in key and "neoviewer" in key and start_idx is None:
            start_idx = idx
        if key == norm_title("NeoViewer的接口"):
            end_idx = idx
            break
    if start_idx is not None and end_idx is not None and end_idx > start_idx:
        combined_333 = "\n\n".join(internal_sections[k] for k in section_keys[start_idx:end_idx])
        put_text("3.3.3 RePACS与NeoViewer的接口", combined_333)
    else:
        nk = norm_title("repacs与neoviewer的接口")
        if nk in internal_sections:
            put_text("3.3.3 RePACS与NeoViewer的接口", internal_sections[nk])

    put_text("4.1 逻辑结构设计要点", (node_by_norm(nodes, "4.1 逻辑结构设计要点") or {}).get("text"))
    put_table("5.1 出错信息", embedded_table(node_by_norm(nodes, "5.1 出错信息")))
    put_text("5.2 补救措施", (node_by_norm(nodes, "5.2 补救措施") or {}).get("text"))
    put_text("5.3 系统维护设计", (node_by_norm(nodes, "5.3 系统维护设计") or {}).get("text"))
    return defaults


def build_img_defaults_from_import_tree(nodes: dict[int, dict]) -> dict[str, str]:
    """从 Word 导入树提取图片 URL，仅映射「图 N …」节点。"""
    defaults: dict[str, str] = {}
    for node in nodes.values():
        title = str(node.get("title") or "").strip()
        if not re.match(r"^图\s*\d", title):
            continue
        url = str(node.get("img_url") or "").strip()
        if url:
            defaults[f"img::{norm_title(title)}"] = url
    return defaults


def apply_defaults_to_nodes(nodes: list[dict], defaults: dict[str, str | dict]):
    for node in nodes or []:
        key = norm_title(node.get("title") or "")
        text_key = f"text::{key}"
        table_key = f"table::{key}"
        img_key = f"img::{key}"
        if text_key in defaults:
            node["text"] = defaults[text_key]
        if table_key in defaults:
            node["table"] = defaults[table_key]
        if img_key in defaults:
            node["img_url"] = defaults[img_key]
        if node.get("children"):
            apply_defaults_to_nodes(node["children"], defaults)


async def import_word_to_temp(product_id: int, version: str) -> int:
    srv = Server()
    with open(WORD_PATH, "rb") as fs:
        data = fs.read()

        class F:
            filename = WORD_PATH.name

            async def read(self_inner):
                return data

        with db():
            resp = await srv.import_hld_doc_word(product_id, version, "", F())
    if resp.code != 1 or not resp.data or not resp.data.id:
        raise SystemExit(f"import failed: {resp.msg}")
    return resp.data.id


def rebuild_doc_from_standard(doc_id: int, standard_nodes: list[dict]):
    async def _run():
        srv = Server()
        with db():
            hld = db.session.execute(select(HldDoc).where(HldDoc.id == doc_id)).scalars().first()
            if not hld:
                raise SystemExit(f"doc {doc_id} not found")
            db.session.execute(delete(HldNode).where(HldNode.doc_id == doc_id))
            hld.n_id = 0
            db.session.flush()

            def to_form(node: dict) -> HldNodeForm:
                table = node.get("table")
                if table == {}:
                    table = None
                return HldNodeForm(
                    doc_id=doc_id,
                    n_id=0,
                    p_id=0,
                    title=node.get("title") or "",
                    text=node.get("text") or "",
                    img_url=node.get("img_url") or "",
                    ref_type=node.get("ref_type"),
                    table=table,
                    children=[to_form(c) for c in (node.get("children") or [])],
                )

            content = [to_form(n) for n in standard_nodes]
            srv._reset_tree_node_ids(content)
            srv._update_nodes(hld, 0, content)
            db.session.commit()

    asyncio.run(_run())


def main():
    target_doc_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    product_id = int(sys.argv[2]) if len(sys.argv) > 2 else 9
    temp_version = "__hld_default_extract__"

    engine = create_engine(DB_URL)
    db_init(engine)

    async def _extract():
        with db():
            db.session.execute(delete(HldNode).where(HldNode.doc_id.in_(
                select(HldDoc.id).where(HldDoc.product_id == product_id, HldDoc.version == temp_version)
            )))
            db.session.execute(delete(HldDoc).where(HldDoc.product_id == product_id, HldDoc.version == temp_version))
            db.session.commit()
        temp_id = await import_word_to_temp(product_id, temp_version)
        nodes = load_tree(temp_id)
        defaults = build_defaults_from_import_tree(nodes)
        defaults.update(build_img_defaults_from_import_tree(nodes))
        with db():
            db.session.execute(delete(HldNode).where(HldNode.doc_id == temp_id))
            db.session.execute(delete(HldDoc).where(HldDoc.id == temp_id))
            db.session.commit()
        return defaults

    defaults = asyncio.run(_extract())
    standard = json.loads(STANDARD_PATH.read_text(encoding="utf-8"))
    filled = deepcopy(standard)
    apply_defaults_to_nodes(filled, defaults)
    STANDARD_PATH.write_text(json.dumps(filled, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
    print(f"updated {STANDARD_PATH} with {len(defaults)} defaults")
    rebuild_doc_from_standard(target_doc_id, filled)
    print(f"rebuilt hld_doc id={target_doc_id}")


if __name__ == "__main__":
    main()
