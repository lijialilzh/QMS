"""SDS 获取 SRS 追溯、图2 追溯表、第6章功能设计同步 — 与 SRS 独立维护。"""

import re
import difflib
import logging
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select, delete, desc

from ..model.sds_doc import SdsDoc, SdsNode
from ..model.sds_trace import SdsTrace
from ..model.srs_doc import SrsDoc
from ..model.srs_req import SrsReq
from ..model.srs_reqd import SrsReqd
from ..obj.tobj_sds_doc import SdsNodeForm, SdsTable, SdsExtraTable
from ..obj.tobj_srs_doc import Table, TabHeader
from ..obj.vobj_sds_trace import SdsTraceObj
from ..obj import Resp
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from .serv_sds_trace import Server as ServSdsTrace, NAME_DICT, fixed_rcn300_sds_codes
from .serv_sds_reqd import Server as ServSdsReqd

logger = logging.getLogger(__name__)

sdstrace_serv = ServSdsTrace()
sdstreqd_serv = ServSdsReqd()
DELETED_SRS_VERSION_PREFIX = "__deleted_srs__"
SDS_TRACES_REF = "sds_traces"


def _trace_ensure_sds_traces(**kwargs):
    """Mixin 类内不能直接写 sdstrace_serv.__xxx，会被名称改写。"""
    return getattr(sdstrace_serv, "_Server__ensure_sds_traces")(**kwargs)


def _trace_load_srs_req_hierarchy_map(srs_doc_id: int):
    return getattr(sdstrace_serv, "_Server__load_srs_req_hierarchy_map")(srs_doc_id)


def _trace_resolve_sds_tree_location(*args, **kwargs):
    return getattr(sdstrace_serv, "_Server__resolve_sds_tree_location")(*args, **kwargs)


def _trace_name_match_variants(value: str):
    return getattr(ServSdsTrace, "_Server__name_match_variants")(value)


def _reqd_compose_srs_function_for_design(row):
    return getattr(ServSdsReqd, "_Server__compose_srs_function_for_design")(row)


class SdsSrsTraceSyncMixin:
    """SDS 侧 SRS 追溯同步（图2 + 第6章设计树），不影响 serv_srs_doc。"""

    FIXED_TEMPLATE_SECTION_MAX = 5
    SYNC_ZONE_SECTION_MIN = 6

    async def _refresh_trace_table_nodes(self, doc_id: int, roots: List[SdsNodeForm], mark_synced: bool = False):
        def normalize_code(value: str):
            return re.sub(r"\s+", "", str(value or "").strip().upper())

        def split_lines(value: str):
            lines = [line.strip() for line in str(value or "").replace("\r", "").split("\n")]
            while len(lines) > 1 and not lines[-1]:
                lines.pop()
            return lines or [""]

        def parse_heading(value: str):
            matched = re.match(r"^\s*(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))", str(value or "").strip())
            return matched.group(1) if matched else ""

        def is_trace_node(node: SdsNodeForm):
            title = str(getattr(node, "title", "") or "")
            ref_type = str(getattr(node, "ref_type", "") or "")
            return ref_type == SDS_TRACES_REF or "设计与需求追溯表" in title or "设计与需求追溯列表" in title

        def has_trace_node(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                if is_trace_node(node) or has_trace_node(getattr(node, "children", None) or []):
                    return True
            return False

        if not doc_id or not roots or not has_trace_node(roots):
            return roots

        location_by_code, location_by_title = self._build_sds_tree_location_indexes(roots)

        resp = await sdstrace_serv.list_sds_trace(None, doc_id=doc_id, page_size=10000, from_sync=mark_synced)
        rows: List[SdsTraceObj] = resp.data.rows or []
        normal_rows = [
            row for row in rows
            if str(getattr(row, "type_code", "") or "").strip() in ["", "1", "2"]
        ]
        change_groups: List[Tuple[str, str, List[SdsTraceObj]]] = []
        change_group_index: Dict[str, int] = {}
        def normalize_type_name_key(value: str):
            return re.sub(r"\s+", "", str(value or "").replace("：", ":").rstrip(":").strip())
        for row in rows:
            type_code = str(getattr(row, "type_code", "") or "").strip()
            if not type_code or type_code in ["1", "2"]:
                continue
            type_name = str(getattr(row, "type_name", "") or "").strip() or "变更需求"
            group_key = normalize_type_name_key(type_name) or type_code
            if group_key not in change_group_index:
                change_group_index[group_key] = len(change_groups)
                change_groups.append((group_key, type_name, []))
            change_groups[change_group_index[group_key]][2].append(row)

        def build_chapter_cell(row: SdsTraceObj):
            sds_codes = split_lines(getattr(row, "sds_code", "") or "")
            chapters = sdstrace_serv.trace_chapter_lines(
                getattr(row, "chapter", "") or "",
                srs_code=getattr(row, "srs_code", None),
                sub_function=getattr(row, "sub_function", None),
                function=getattr(row, "function", None),
                module=getattr(row, "module", None),
            )
            locations = split_lines(getattr(row, "location", "") or "")
            count = max(1, len(sds_codes), len(chapters), len(locations))
            values = []
            for idx in range(count):
                chapter = chapters[idx].strip() if idx < len(chapters) else (chapters[0].strip() if chapters else "")
                sds_code = normalize_code(sds_codes[idx] if idx < len(sds_codes) else "")
                location = locations[idx].strip() if idx < len(locations) else ""
                if not location and sds_code:
                    location = location_by_code.get(sds_code, "")
                if not location:
                    req_proxy = SimpleNamespace(
                        sub_function=getattr(row, "sub_function", None),
                        function=getattr(row, "function", None),
                        module=getattr(row, "module", None),
                    )
                    location = _trace_resolve_sds_tree_location(
                        sds_code or getattr(row, "sds_code", "") or "",
                        req_proxy,
                        roots,
                        location_by_code,
                    )
                values.append(f"{chapter}{f'（章节 {location}）' if location else ''}")
            return "\n".join(values)

        trace_headers = [
                TabHeader(code="srs_code", name="需求编号"),
                TabHeader(code="sds_code", name="设计编号"),
                TabHeader(code="chapter", name="需求/代码"),
            ]

        def build_trace_rows(table_rows: List[SdsTraceObj]):
            return [
                {
                    "srs_code": getattr(row, "srs_code", "") or "",
                    "sds_code": getattr(row, "sds_code", "") or "",
                    "chapter": build_chapter_cell(row),
                }
                for row in table_rows
            ]

        table = SdsTable(
            headers=trace_headers,
            rows=build_trace_rows(normal_rows),
            extra_tables=[
                SdsExtraTable(
                    title=type_name,
                    table=Table(headers=trace_headers, rows=build_trace_rows(group_rows)),
                )
                for _type_code, type_name, group_rows in change_groups
            ],
            trace_synced=mark_synced or None,
        )

        def apply(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                if is_trace_node(node):
                    node.ref_type = "" if mark_synced else node.ref_type
                    node.table = table
                apply(getattr(node, "children", None) or [])
        apply(roots)
        return roots

    async def _refresh_trace_table_for_display(
        self,
        doc_id: int,
        roots: List[SdsNodeForm],
        persist: bool = False,
    ) -> List[SdsNodeForm]:
        _trace_ensure_sds_traces(doc_id=doc_id)
        def has_synced_trace_table(nodes: List[SdsNodeForm]) -> bool:
            for node in nodes or []:
                table = getattr(node, "table", None)
                if getattr(table, "trace_synced", None):
                    return True
                if has_synced_trace_table(getattr(node, "children", None) or []):
                    return True
            return False

        if self._is_word_imported_doc(roots) and not has_synced_trace_table(roots):
            return roots

        refreshed = await self._refresh_trace_table_nodes(doc_id, roots, mark_synced=has_synced_trace_table(roots))
        if persist:
            row = db.session.execute(select(SdsDoc).where(SdsDoc.id == doc_id)).scalars().first()
            if row:
                self._persist_sds_tree(row, refreshed)
        return refreshed

    async def sync_srs_trace(self, doc_id: int):
        """点击「获取SRS追溯」：补章节、写追溯表、同步功能设计（已存在的需求不重复生成）。"""
        row: SdsDoc = db.session.execute(select(SdsDoc).where(SdsDoc.id == doc_id)).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        srs_row = db.session.execute(select(SrsDoc).where(SrsDoc.id == row.srsdoc_id)).scalars().first()
        if srs_row and str(srs_row.version or "").startswith(DELETED_SRS_VERSION_PREFIX):
            active_srs = db.session.execute(
                select(SrsDoc)
                .where(
                    SrsDoc.product_id == srs_row.product_id,
                    SrsDoc.version == row.version,
                    ~SrsDoc.version.like(f"{DELETED_SRS_VERSION_PREFIX}%"),
                )
                .order_by(desc(SrsDoc.create_time), desc(SrsDoc.id))
                .limit(1)
            ).scalars().first()
            if active_srs is None:
                active_srs = db.session.execute(
                    select(SrsDoc)
                    .where(
                        SrsDoc.product_id == srs_row.product_id,
                        ~SrsDoc.version.like(f"{DELETED_SRS_VERSION_PREFIX}%"),
                    )
                    .order_by(desc(SrsDoc.create_time), desc(SrsDoc.id))
                    .limit(1)
                ).scalars().first()
            if active_srs is not None:
                row.srsdoc_id = active_srs.id
                db.session.execute(delete(SdsTrace).where(SdsTrace.doc_id == row.id))
                db.session.flush()

        sql = select(SdsNode).where(SdsNode.doc_id == doc_id).order_by(SdsNode.priority)
        nodes: list[SdsNode] = db.session.execute(sql).scalars().all()
        objs_dict = {}
        roots: List[SdsNodeForm] = []
        for node in nodes:
            table = self._parse_sds_table(node.table)
            obj = SdsNodeForm(
                children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                title=node.title, label=node.label, img_url=node.img_url, text=node.text,
                ref_type=node.ref_type, table=table, sds_code=node.sds_code,
            )
            objs_dict[obj.n_id] = obj
        for obj in objs_dict.values():
            if obj.p_id == 0:
                roots.append(obj)
            else:
                parent = objs_dict.get(obj.p_id)
                if parent:
                    parent.children.append(obj)

        _trace_ensure_sds_traces(doc_id=doc_id)
        if self._is_word_imported_doc(roots):
            self._normalize_word_imported_chapter_numbers(roots)
            self._bind_word_leaf_codes_from_srs(roots, doc_id)
        roots = await self._sync_missing_design_nodes_from_srs(doc_id, roots)
        if self._is_word_imported_doc(roots):
            self._bind_word_leaf_codes_from_srs(roots, doc_id)
        for product_root in self._find_design_chapter_roots(roots):
            self._sort_and_renumber_sync_area_by_sds_code(product_root)
        location_by_code, location_by_title = self._build_sds_tree_location_indexes(roots)
        self._persist_trace_chapters_from_srs(doc_id, location_by_code, location_by_title, roots)
        roots = self._remove_stray_image_display_modules(roots)
        roots = await self._refresh_trace_table_nodes(doc_id, roots, mark_synced=True)
        self._persist_sds_tree(row, roots)

        trace_resp = await sdstrace_serv.list_sds_trace(None, doc_id=doc_id, page_size=10000, from_sync=True)
        return Resp.resp_ok(data={
            "trace_rows": trace_resp.data.rows if trace_resp.data else [],
            "content": roots,
        })

    async def sync_design_text_only(self, doc_id: int):
        """页面加载自动同步：仅对功能设计为空的章节，按编号从 SRS 补全内容。
        已有内容一律不动（以详细设计为准、只补空），不重排结构/编号/标题。"""
        row: SdsDoc = db.session.execute(select(SdsDoc).where(SdsDoc.id == doc_id)).scalars().first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))

        nodes: list[SdsNode] = db.session.execute(
            select(SdsNode).where(SdsNode.doc_id == doc_id).order_by(SdsNode.priority)
        ).scalars().all()
        objs_dict: Dict[int, SdsNodeForm] = {}
        roots: List[SdsNodeForm] = []
        for node in nodes:
            obj = SdsNodeForm(
                children=[], doc_id=node.doc_id, n_id=node.n_id, p_id=node.p_id,
                title=node.title, label=node.label, img_url=node.img_url, text=node.text,
                ref_type=node.ref_type, table=self._parse_sds_table(node.table), sds_code=node.sds_code,
            )
            objs_dict[obj.n_id] = obj
        for obj in objs_dict.values():
            if obj.p_id == 0:
                roots.append(obj)
            else:
                parent = objs_dict.get(obj.p_id)
                if parent:
                    parent.children.append(obj)

        hierarchy_map = _trace_load_srs_req_hierarchy_map(getattr(row, "srsdoc_id", None) or 0)
        trace_rows = db.session.execute(
            select(SdsTrace, SrsReq)
            .join(SrsReq, SrsReq.id == SdsTrace.req_id)
            .where(SdsTrace.doc_id == doc_id)
            .where(SrsReq.type_code != "reqd")
        ).all()
        if not trace_rows:
            return Resp.resp_ok(data={"updated": 0})

        srs_codes = list({
            str(getattr(req, "code", "") or "").strip()
            for _t, req in trace_rows if str(getattr(req, "code", "") or "").strip()
        })
        trace_req_ids = [getattr(req, "id", None) for _t, req in trace_rows if getattr(req, "id", None)]
        reqd_by_srs_code: Dict[str, SrsReqd] = {}
        reqd_by_req_id: Dict[int, SrsReqd] = {}
        if srs_codes or trace_req_ids:
            reqd_query = (
                select(SrsReqd, SrsReq)
                .join(SrsReq, SrsReq.id == SrsReqd.req_id)
                .where(SrsReq.doc_id == getattr(row, "srsdoc_id", None))
            )
            if srs_codes and trace_req_ids:
                reqd_query = reqd_query.where(
                    (SrsReq.code.in_(srs_codes)) | (SrsReq.id.in_(trace_req_ids))
                )
            elif srs_codes:
                reqd_query = reqd_query.where(SrsReq.code.in_(srs_codes))
            else:
                reqd_query = reqd_query.where(SrsReq.id.in_(trace_req_ids))
            for reqd_row, req_row in db.session.execute(reqd_query).all():
                ccode = str(getattr(req_row, "code", "") or "").strip()
                if ccode and ccode not in reqd_by_srs_code:
                    reqd_by_srs_code[ccode] = reqd_row
                rid = getattr(req_row, "id", None)
                if rid is not None and rid not in reqd_by_req_id:
                    reqd_by_req_id[rid] = reqd_row

        def _norm(v) -> str:
            return re.sub(r"\s+", "", str(v or "").strip().upper())

        code_to_req: Dict[str, SrsReq] = {}
        for _trace, req in trace_rows:
            sds_code = _norm(getattr(_trace, "sds_code", "") or "") or _norm(
                str(getattr(req, "code", "") or "").replace("SRS", "SDS")
            )
            if sds_code and sds_code not in code_to_req:
                code_to_req[sds_code] = req

        updated = 0

        def walk(node_list):
            nonlocal updated
            for node in node_list or []:
                code = _norm(getattr(node, "sds_code", "") or "")
                # 仅处理有编号、且功能设计为空（无实质内容）的章节
                if code and not self._node_has_substantive_design_body(node):
                    req = code_to_req.get(code)
                    if req is not None:
                        design_text = self._compose_design_text_for_trace_sync(
                            req, str(getattr(req, "code", "") or ""), getattr(req, "id", None),
                            reqd_by_srs_code, reqd_by_req_id, hierarchy_map, trace_rows,
                        )
                        if self._design_text_is_substantive(design_text) and \
                                design_text.strip() != (getattr(node, "text", "") or "").strip():
                            node.text = design_text
                            updated += 1
                walk(getattr(node, "children", None) or [])

        walk(roots)
        if updated:
            self._persist_sds_tree(row, roots)
        return Resp.resp_ok(data={"updated": updated})

    @staticmethod
    def _parse_sds_node_heading(value: str) -> str:
        matched = re.match(
            r"^\s*(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            str(value or "").strip(),
        )
        return matched.group(1) if matched else ""

    @staticmethod
    def _strip_sds_heading_text(value: str) -> str:
        """去掉章节号前缀（6 / 6.10.1），不剥离需求名前缀数字（如 111111测试）。"""
        txt = str(value or "").strip()
        matched = re.match(
            r"^\s*((?:\d+(?:\.\d+)+|\d{1,2}))(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            txt,
        )
        if not matched:
            return txt
        prefix = matched.group(1)
        if "." not in prefix and len(prefix) > 2:
            return txt
        return txt[matched.end():].strip()

    @staticmethod
    def _normalize_sds_node_title(value: str) -> str:
        txt = SdsSrsTraceSyncMixin._strip_sds_heading_text(value)
        return re.sub(r"\s+", "", txt).lower()

    @staticmethod
    def _heading_depth(value: str) -> int:
        txt = str(value or "").strip()
        return len(txt.split(".")) if txt else 0

    @staticmethod
    def _extract_sds_code_token(txt: str) -> str:
        matched = re.search(
            r"SDS\s*-\s*[A-Za-z0-9._-]+(?:\s*[-_]\s*[A-Za-z0-9._-]+)*",
            str(txt or ""),
            flags=re.I,
        )
        return re.sub(r"\s+", "", matched.group(0)).upper() if matched else ""

    @classmethod
    def _extract_node_sds_codes(cls, node: SdsNodeForm) -> List[str]:
        codes: List[str] = []
        seen = set()

        def add(raw: str):
            code = re.sub(r"\s+", "", str(raw or "").strip().upper())
            if code and code not in seen:
                seen.add(code)
                codes.append(code)

        field = str(getattr(node, "sds_code", "") or "")
        for token in re.split(r"[\r\n,，;；]+", field):
            add(token)
        lines = str(getattr(node, "text", "") or "").replace("\r", "").split("\n")
        for idx, line in enumerate(lines):
            matched = re.match(r"设计编号\s*[：:]\s*(.*)$", str(line or "").strip())
            if not matched:
                continue
            part = str(matched.group(1) or "").strip()
            token = cls._extract_sds_code_token(part)
            if not token and idx + 1 < len(lines):
                token = cls._extract_sds_code_token(f"{part}\n{lines[idx + 1]}")
            if token:
                add(token)
        return codes

    def _build_sds_tree_location_indexes(self, roots: List[SdsNodeForm]):
        """从 SDS 编辑页树读取章节号：优先 sds_code / 正文设计编号，其次叶子标题。"""
        by_code: dict = {}
        by_title: dict = {}

        def put_code(code: str, heading: str):
            if not code or not heading:
                return
            prev = by_code.get(code)
            if not prev or self._heading_depth(heading) >= self._heading_depth(prev):
                by_code[code] = heading

        def put_title(title: str, heading: str, is_leaf: bool):
            if not is_leaf:
                return
            variants = list(_trace_name_match_variants(title or ""))
            norm = self._normalize_sds_node_title(title)
            if norm and norm not in variants:
                variants.append(norm)
            for variant in variants:
                if not variant or not heading:
                    continue
                prev = by_title.get(variant)
                if not prev or self._heading_depth(heading) >= self._heading_depth(prev):
                    by_title[variant] = heading

        def walk(items: List[SdsNodeForm]):
            for node in items or []:
                heading = self._parse_sds_node_heading(getattr(node, "title", "") or "")
                node_codes = self._extract_node_sds_codes(node)
                is_leaf = bool(node_codes) or self._heading_depth(heading) >= 3
                if heading:
                    for code in node_codes:
                        put_code(code, heading)
                    leaf_title = self._strip_sds_heading_text(getattr(node, "title", "") or "")
                    if leaf_title:
                        put_title(leaf_title, heading, is_leaf)
                walk(getattr(node, "children", None) or [])

        walk(roots or [])
        return by_code, by_title

    def _bind_word_leaf_codes_from_srs(self, roots: List[SdsNodeForm], doc_id: int):
        """Word 导入：按 模块+功能+子功能 路径绑定树上未编码叶子，避免同名子功能串号。"""
        rows = db.session.execute(
            select(SdsTrace, SrsReq)
            .join(SrsReq, SrsReq.id == SdsTrace.req_id)
            .where(SdsTrace.doc_id == doc_id)
        ).all()
        if not rows:
            return

        def normalize_title(value: str) -> str:
            txt = self._strip_sds_heading_text(value)
            return re.sub(r"\s+", "", txt).lower()

        def node_codes(node: SdsNodeForm) -> set:
            return {re.sub(r"\s+", "", c.upper()) for c in self._extract_node_sds_codes(node)}

        def walk(items: List[SdsNodeForm], ancestors: List[str]):
            for node in items or []:
                chain = ancestors + [normalize_title(getattr(node, "title", "") or "")]
                yield node, chain
                yield from walk(getattr(node, "children", None) or [], chain)

        indexed = list(walk(roots or [], []))

        for trace, req in rows:
            code = re.sub(r"\s+", "", (getattr(trace, "sds_code", "") or "").replace("SRS", "SDS").upper())
            if not code:
                continue
            if any(code in node_codes(node) for node, _chain in indexed):
                continue
            sub = normalize_title(getattr(req, "sub_function", None) or "")
            func = normalize_title(getattr(req, "function", None) or "")
            mod = normalize_title(getattr(req, "module", None) or "")
            leaf_name = sub or func or mod
            if not leaf_name:
                continue
            candidates = []
            for node, chain in indexed:
                node_name = normalize_title(getattr(node, "title", "") or "")
                if node_name != leaf_name and (sub and node_name != sub):
                    continue
                if node_codes(node):
                    continue
                parent_func = chain[-2] if len(chain) >= 2 else ""
                parent_mod = chain[-3] if len(chain) >= 3 else ""
                func_ok = node_name == leaf_name
                if sub:
                    func_ok = func_ok and (not func or parent_func == func)
                elif func:
                    func_ok = func_ok and (not mod or parent_mod == mod)
                mod_ok = not mod or parent_mod == mod
                if func_ok and mod_ok:
                    candidates.append(node)
            if len(candidates) == 1:
                candidates[0].sds_code = code

    def _is_descendant_of(self, ancestor: SdsNodeForm, node: SdsNodeForm, parent_map: Dict[int, Optional[SdsNodeForm]]) -> bool:
        if ancestor is None or node is None:
            return False
        current = node
        while current is not None:
            if current is ancestor:
                return True
            current = parent_map.get(id(current))
        return False

    def _find_word_leaf_for_req(
        self,
        roots: List[SdsNodeForm],
        req: SrsReq,
        hierarchy_map: dict,
        code: str,
        module_name: str = None,
    ) -> Optional[SdsNodeForm]:
        """Word 导入：按模块路径 + 子功能名查找未绑定叶子（与 bind 规则一致）。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        sub = self._normalize_sds_node_title(fields.get("sub_function") or "")
        func = self._normalize_sds_node_title(fields.get("function") or "")
        mod = self._normalize_sds_node_title(module_name or fields.get("module") or "")
        leaf_name = sub or func or mod
        if not leaf_name:
            leaf_name = self._normalize_sds_node_title(
                sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
            )
        if not leaf_name:
            return None

        module_node = self._find_module_node_for_req(
            roots,
            module_name or fields.get("module") or "",
            code,
            getattr(req, "type_code", None),
        ) if (module_name or fields.get("module")) else None
        scope = [module_node] if module_node else (roots or [])

        def node_codes(node: SdsNodeForm) -> set:
            return {re.sub(r"\s+", "", c.upper()) for c in self._extract_node_sds_codes(node)}

        def walk(items: List[SdsNodeForm], ancestors: List[str]):
            for node in items or []:
                chain = ancestors + [self._normalize_sds_node_title(getattr(node, "title", "") or "")]
                yield node, chain
                yield from walk(getattr(node, "children", None) or [], chain)

        candidates = []
        for node, chain in walk(scope, []):
            node_name = self._normalize_sds_node_title(getattr(node, "title", "") or "")
            if node_name != leaf_name and (sub and node_name != sub):
                continue
            if node_codes(node):
                continue
            parent_func = chain[-2] if len(chain) >= 2 else ""
            parent_mod = chain[-3] if len(chain) >= 3 else ""
            func_ok = node_name == leaf_name
            if sub:
                func_ok = func_ok and (not func or parent_func == func)
            elif func:
                func_ok = func_ok and (not mod or parent_mod == mod)
            mod_ok = not mod or parent_mod == mod
            if func_ok and mod_ok:
                candidates.append(node)
        if len(candidates) == 1:
            candidates[0].sds_code = code
            return candidates[0]
        return None

    def _node_matches_req_hierarchy(
        self,
        node: SdsNodeForm,
        req: SrsReq,
        hierarchy_map: dict,
        module_name: str = None,
    ) -> bool:
        """校验 SDS 节点标题是否与 SRS 章节名（子功能/功能/模块）严格一致。"""
        if node is None or req is None:
            return False
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
        chapter_norm = self._normalize_sds_node_title(chapter or "")
        if not chapter_norm:
            return False
        node_name = self._normalize_sds_node_title(
            self._strip_sds_heading_text(getattr(node, "title", "") or "")
        )
        return node_name == chapter_norm

    def _try_rename_module_title_to_function(
        self,
        node: SdsNodeForm,
        req: SrsReq,
        hierarchy_map: dict,
        module_name: str,
        display_title: str,
    ) -> bool:
        """Word 章节标题常为模块名（登录），SRS 章节名为功能名（用户登录）→ 原地改标题。"""
        if node is None or req is None or not display_title:
            return False
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        mod = self._normalize_sds_node_title(module_name or fields.get("module") or "")
        func = self._normalize_sds_node_title(fields.get("function") or "")
        sub = self._normalize_sds_node_title(fields.get("sub_function") or "")
        if not mod or not func or mod == func or sub:
            return False
        body = self._normalize_sds_node_title(
            self._strip_sds_heading_text(getattr(node, "title", "") or "")
        )
        if body != mod or self._normalize_sds_node_title(display_title) != func:
            return False
        heading = self._parse_sds_node_heading(getattr(node, "title", "") or "")
        node.title = f"{heading} {display_title}".strip() if heading else display_title
        return True

    def _promote_function_chapter_over_module_header(
        self,
        roots: List[SdsNodeForm],
        existing: SdsNodeForm,
        module_name: str,
        display_title: str,
        code: str,
        design_text: str,
    ) -> Optional[SdsNodeForm]:
        """Word 结构为「6.6 登录 > 6.6.1 用户登录」，SRS 应为「6.6 用户登录」单章节。"""
        if existing is None or not module_name or not display_title:
            return existing
        parent_map = self._build_node_parent_map(roots)
        parent = parent_map.get(id(existing))
        if parent is None:
            return existing
        mod_norm = self._normalize_sds_node_title(module_name)
        display_norm = self._normalize_sds_node_title(display_title)
        body_norm = self._normalize_sds_node_title(
            self._strip_sds_heading_text(getattr(existing, "title", "") or "")
        )
        parent_body = self._normalize_sds_node_title(
            self._strip_sds_heading_text(getattr(parent, "title", "") or "")
        )
        if body_norm != display_norm or parent_body != mod_norm:
            return existing
        # 原功能节点已有实质设计内容：说明这是『真实模块 > 功能』正确两级结构，
        # 不是 Word 多套的冗余空壳层，保持原结构、不合并，避免丢失内容。
        if self._node_has_substantive_design_body(existing):
            return existing
        parent.sds_code = code
        if design_text:
            parent.text = design_text
        parent_heading = self._parse_sds_node_heading(getattr(parent, "title", "") or "")
        parent.title = f"{parent_heading} {display_title}".strip() if parent_heading else display_title
        self._detach_node(roots, existing)
        return parent

    def _resolve_srs_hierarchy_levels(self, req: SrsReq, hierarchy_map: dict) -> dict:
        """按 SRS 字段判定层级：模块=二级、功能=三级、子功能=四级；容器模块不参与章节。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        containers = self._container_title_norms()

        def valid(value: str) -> bool:
            txt = str(value or "").strip()
            return bool(txt) and txt not in ("/", "-", "\\")

        def real_module(value: str) -> bool:
            return valid(value) and self._normalize_sds_node_title(value) not in containers

        mod = str(fields.get("module") or "").strip()
        func = str(fields.get("function") or "").strip()
        sub = str(fields.get("sub_function") or "").strip()
        return {
            "module": mod if real_module(mod) else "",
            "function": func if valid(func) else "",
            "sub_function": sub if valid(sub) else "",
        }

    def _sync_module_name_from_fields(self, fields: dict) -> str:
        """同步用模块名：严格读 SRS 表 module 列；容器名在含功能/子功能时仍作二级模块。"""
        raw_module = str(fields.get("module") or "").strip()
        if not raw_module:
            return ""
        raw_func = str(fields.get("function") or "").strip()
        raw_sub = str(fields.get("sub_function") or "").strip()
        if self._is_container_title(raw_module):
            return raw_module if (raw_func or raw_sub) else ""
        return raw_module

    def _resolve_standard_container_module(
        self,
        req: SrsReq,
        hierarchy_map: dict,
        trace_rows,
    ) -> Optional[str]:
        """标准需求：容器模块下列功能/子功能时，解析二级模块名（如 事件时间线）。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        raw_mod = str(fields.get("module") or "").strip()
        if not raw_mod or not self._is_container_title(raw_mod):
            return None
        container_norm = self._normalize_sds_node_title(raw_mod)
        func_modules: Dict[str, str] = {}
        leaf_funcs: List[str] = []
        for _trace, row in trace_rows or []:
            row_fields = sdstrace_serv.hierarchy_for_req(row, hierarchy_map)
            row_mod = str(row_fields.get("module") or "").strip()
            if self._normalize_sds_node_title(row_mod) != container_norm:
                continue
            func = str(row_fields.get("function") or "").strip()
            sub = str(row_fields.get("sub_function") or "").strip()
            if not func:
                continue
            if sub:
                func_modules[self._normalize_sds_node_title(func)] = func
            else:
                leaf_funcs.append(func)
        func = str(fields.get("function") or "").strip()
        sub = str(fields.get("sub_function") or "").strip()
        func_norm = self._normalize_sds_node_title(func)
        if sub and func_norm in func_modules:
            return func_modules[func_norm]
        if func_norm in func_modules:
            return func_modules[func_norm]
        if len(leaf_funcs) == 1:
            return None
        if len(leaf_funcs) > 1:
            shared = self._normalize_sds_node_title(leaf_funcs[0])
            if all(self._normalize_sds_node_title(name) == shared for name in leaf_funcs):
                return leaf_funcs[0]
        return None

    def _collapse_same_title_module_function_shells(self, roots: List[SdsNodeForm]) -> List[SdsNodeForm]:
        """去掉二级模块壳与三级功能同名、且模块壳无编号的误生成层级。"""
        def clean(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
            kept: List[SdsNodeForm] = []
            for node in nodes or []:
                node.children = clean(getattr(node, "children", None) or [])
                children = list(getattr(node, "children", None) or [])
                body_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(node, "title", "") or "")
                )
                if (
                    not getattr(node, "sds_code", None)
                    and len(children) == 1
                    and body_norm
                ):
                    child = children[0]
                    child_norm = self._normalize_sds_node_title(
                        self._strip_sds_heading_text(getattr(child, "title", "") or "")
                    )
                    if body_norm == child_norm and getattr(child, "sds_code", None):
                        kept.append(child)
                        continue
                kept.append(node)
            return kept

        return clean(roots or [])

    def _req_hierarchy_path(
        self,
        req: SrsReq,
        hierarchy_map: dict,
        is_change_req: bool = False,
        trace_rows=None,
    ) -> List[str]:
        """SRS 章节路径：模块(二级) → 功能(三级) → 子功能(四级)，去掉新增/变更/标准需求容器层。"""
        lv = self._resolve_srs_hierarchy_levels(req, hierarchy_map)
        mod = lv["module"]
        func = lv["function"]
        sub = lv["sub_function"]
        if sub:
            if mod:
                return [mod, func, sub] if func else [mod, sub]
            if func:
                raw_fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
                raw_mod = str(raw_fields.get("module") or "").strip()
                if raw_mod and self._is_container_title(raw_mod) and not is_change_req:
                    group_mod = self._resolve_standard_container_module(req, hierarchy_map, trace_rows)
                    if group_mod:
                        return [group_mod, func, sub]
                    return [raw_mod, func, sub]
                return [func, func, sub] if is_change_req else [func, sub]
            return [sub]
        if func:
            if mod:
                return [mod, func]
            raw_fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
            raw_mod = str(raw_fields.get("module") or "").strip()
            if raw_mod and self._is_container_title(raw_mod) and not is_change_req:
                group_mod = self._resolve_standard_container_module(req, hierarchy_map, trace_rows)
                if group_mod and self._normalize_sds_node_title(group_mod) != self._normalize_sds_node_title(func):
                    return [group_mod, func]
                return [raw_mod, func]
            if is_change_req:
                return [func, func]
            return [func]
        if mod:
            return [mod]
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
        if chapter and self._normalize_sds_node_title(chapter) not in self._container_title_norms():
            return [chapter]
        return []

    def _ensure_child_node_by_title(self, parent: SdsNodeForm, title: str) -> SdsNodeForm:
        """在 parent 下按标题精确查找或创建中间层级节点。"""
        norm = self._normalize_sds_node_title(title)
        for child in getattr(parent, "children", None) or []:
            child_norm = self._normalize_sds_node_title(
                self._strip_sds_heading_text(getattr(child, "title", "") or "")
            )
            if child_norm == norm:
                if child.children is None:
                    child.children = []
                return child
        if parent.children is None:
            parent.children = []
        node = SdsNodeForm(title=title, children=[])
        parent.children.append(node)
        return node

    def _place_leaf_at_hierarchy_path(
        self,
        roots: List[SdsNodeForm],
        product_root: Optional[SdsNodeForm],
        path_titles: List[str],
        code: str,
        design_text: str,
    ) -> Optional[SdsNodeForm]:
        """按 SRS 路径在产品章下放置叶子：path[0] 二级模块，[-1] 为带 SDS 编号的叶子。"""
        path = [str(t or "").strip() for t in (path_titles or []) if str(t or "").strip()]
        if not path or product_root is None:
            return None
        parent = product_root
        for segment in path[:-1]:
            parent = self._ensure_child_node_by_title(parent, segment)
        leaf_norm = self._normalize_sds_node_title(path[-1])
        norm_code = re.sub(r"\s+", "", str(code or "").strip().upper())
        for child in getattr(parent, "children", None) or []:
            child_norm = self._normalize_sds_node_title(
                self._strip_sds_heading_text(getattr(child, "title", "") or "")
            )
            if child_norm != leaf_norm:
                continue
            child_code = re.sub(r"\s+", "", str(getattr(child, "sds_code", "") or "").strip().upper())
            if child_code and child_code != norm_code:
                continue
            child.sds_code = code
            if design_text and not (getattr(child, "text", "") or "").strip():
                child.text = design_text
            return child
        new_node = SdsNodeForm(title=path[-1], sds_code=code, text=design_text, children=[])
        if parent.children is None:
            parent.children = []
        parent.children.append(new_node)
        return new_node

    def _should_skip_module_hierarchy_nest(
        self,
        is_change_req: bool,
        sync_path_titles: Optional[List[str]],
        display_title: str,
        module_name: str,
    ) -> bool:
        """模块名仅作 SRS 分组，功能名才是单叶子章节时不挂模块容器下。"""
        if is_change_req or not module_name or not display_title:
            return False
        titles = [str(t or "").strip() for t in (sync_path_titles or []) if str(t or "").strip()]
        if len(titles) != 1:
            return False
        return (
            self._normalize_sds_node_title(titles[0]) == self._normalize_sds_node_title(display_title)
            and self._normalize_sds_node_title(module_name) != self._normalize_sds_node_title(display_title)
        )

    def _text_mentions_feature(self, text: str, feature_name: str) -> bool:
        """正文/标题是否提及当前功能名（严格优先，避免「测试」误命中「111111测试」）。"""
        text_norm = self._normalize_sds_node_title(re.sub(r"\s+", " ", str(text or "")))
        name_norm = self._normalize_sds_node_title(str(feature_name or ""))
        if not name_norm or not text_norm:
            return False
        if name_norm == text_norm:
            return True
        if len(name_norm) >= 3 and name_norm in text_norm:
            return True
        return False

    def _req_feature_names(
        self,
        req: SrsReq,
        hierarchy_map: dict,
        module_name: str = "",
        node: Optional[SdsNodeForm] = None,
    ) -> List[str]:
        """当前 SRS 需求对应的功能/章节名（用于判断正文是否属于该需求）。"""
        if req is None:
            return []
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
        node_name = self._strip_sds_heading_text(getattr(node, "title", "") or "") if node else ""
        names = [chapter, fields.get("sub_function"), fields.get("function"), node_name]
        seen = set()
        result = []
        for name in names:
            norm = self._normalize_sds_node_title(str(name or ""))
            if norm and norm not in seen:
                seen.add(norm)
                result.append(norm)
        return result

    def _req_chapter_norm(self, req: SrsReq, hierarchy_map: dict) -> str:
        if req is None:
            return ""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
        return self._normalize_sds_node_title(chapter or "")

    def _body_mentions_other_trace_req(
        self,
        node: SdsNodeForm,
        req_id: Optional[int],
        req: SrsReq,
        hierarchy_map: dict,
        trace_rows,
    ) -> bool:
        """正文是否提及其他 trace 需求的章节名（旧编号被新 req_id 占用时识别旧正文）。"""
        existing = (getattr(node, "text", "") or "").strip()
        if not existing or not trace_rows or req is None:
            return False
        current_chapter = self._req_chapter_norm(req, hierarchy_map)
        for _trace, other in trace_rows:
            other_id = getattr(other, "id", None)
            if other_id is None or other_id == req_id:
                continue
            other_chapter = self._req_chapter_norm(other, hierarchy_map)
            if not other_chapter or other_chapter == current_chapter:
                continue
            if self._text_mentions_feature(existing, other_chapter):
                return True
        return False

    def _node_content_belongs_to_req(
        self,
        node: SdsNodeForm,
        req: SrsReq,
        req_id: Optional[int],
        hierarchy_map: dict,
        module_name: str,
        expected_text: str,
        trace_rows=None,
        by_req_id: Optional[Dict[int, SdsNodeForm]] = None,
    ) -> bool:
        """节点正文/标题是否属于当前 req_id（身份看 key，不是 SDS 编号）。"""
        if node is None or req is None:
            return False
        by_req_id = by_req_id or {}
        if req_id is not None and by_req_id.get(req_id) is node:
            # by_req_id 由内容/功能名匹配确认是同一旧功能：直接认定属于该需求。
            # 不再用 _body_mentions_other_trace_req 否决——功能正文普遍含
            # “超级管理员…登录成功”等通用前缀，易被误判为提及其他功能，
            # 从而导致改名/编号偏移的旧功能内容被错误清空。
            return True
        if trace_rows and self._body_mentions_other_trace_req(
            node, req_id, req, hierarchy_map, trace_rows
        ):
            return False
        if self._node_owned_by_other_req(node, req_id, by_req_id):
            return False
        if not self._node_matches_req_hierarchy(node, req, hierarchy_map, module_name):
            return False
        return not self._node_has_foreign_feature_body(
            node, req, hierarchy_map, module_name, expected_text, trace_rows, req_id
        )

    def _node_has_foreign_feature_body(
        self,
        node: SdsNodeForm,
        req: SrsReq,
        hierarchy_map: dict,
        module_name: str = "",
        expected_text: str = "",
        trace_rows=None,
        req_id: Optional[int] = None,
    ) -> bool:
        """正文是否明显属于其他功能（标题已是新需求名、正文仍是旧功能）。"""
        existing = (getattr(node, "text", "") or "").strip()
        if not existing:
            return False
        if trace_rows and self._body_mentions_other_trace_req(
            node, req_id, req, hierarchy_map, trace_rows
        ):
            return True
        feature_names = self._req_feature_names(req, hierarchy_map, module_name, node)
        current_chapter = self._req_chapter_norm(req, hierarchy_map)
        if current_chapter and not self._text_mentions_feature(existing, current_chapter):
            if expected_text and self._node_text_matches_req(node, expected_text):
                if self._text_mentions_feature(expected_text, current_chapter):
                    return False
                return True
            return True
        if not feature_names:
            return bool(expected_text and not self._node_text_matches_req(node, expected_text))
        if any(self._text_mentions_feature(existing, name) for name in feature_names):
            if expected_text and self._node_text_matches_req(node, expected_text):
                return False
            return False
        return True

    def _is_new_req_reusing_sds_code_node(
        self,
        node: SdsNodeForm,
        req: SrsReq,
        req_id: Optional[int],
        by_req_id: Dict[int, SdsNodeForm],
        hierarchy_map: dict,
        module_name: str,
        expected_text: str = "",
        trace_rows=None,
    ) -> bool:
        """新 req_id（新 key）复用旧 SDS 编号 → 不得占旧章节、不得沿用旧正文。"""
        if node is None or req is None:
            return False
        return not self._node_content_belongs_to_req(
            node, req, req_id, hierarchy_map, module_name, expected_text, trace_rows, by_req_id
        )

    def _design_text_is_substantive(self, text: str) -> bool:
        """功能设计文本是否含实质内容（区别于『(1)总体描述 无 …』空模板）。"""
        if not text or not text.strip():
            return False
        stripped = re.sub(
            r"[（(]\s*\d+\s*[)）](总体描述|功能|程序逻辑|输入项|输出项|接口)?",
            "",
            re.sub(r"\s+", "", text),
        )
        stripped = stripped.replace("无", "").replace("。", "")
        return len(stripped) > 4

    def _node_has_substantive_design_body(self, node: SdsNodeForm) -> bool:
        """节点功能设计正文是否含实质内容（区别于『(1)总体描述 无 …』空模板）。"""
        ov = self._extract_design_overview(node)
        if ov and ov not in ("无", "无。"):
            return True
        return self._design_text_is_substantive(str(getattr(node, "text", "") or ""))

    def _node_text_matches_req(self, node: SdsNodeForm, expected_text: str) -> bool:
        """比对节点正文与 SRS 设计说明是否同源，避免新 key 复用旧编号时保留旧正文。"""
        existing = re.sub(r"\s+", " ", (getattr(node, "text", "") or "").strip())
        expected = re.sub(r"\s+", " ", (expected_text or "").strip())
        if not existing:
            return True
        if not expected:
            return not re.search(r"\(\d+\)\s*总体描述", existing)
        sample = min(120, len(existing), len(expected))
        if sample <= 0:
            return True
        if existing[:sample] == expected[:sample]:
            return True
        match_len = 0
        for left, right in zip(existing[:sample], expected[:sample]):
            if left != right:
                break
            match_len += 1
        return match_len >= 40

    def _reqd_detail_text(self, reqd_row) -> str:
        if not reqd_row:
            return ""
        parts = []
        for field in (
            "overview", "pre_condition", "trigger", "work_flow",
            "post_condition", "exception", "constraint",
        ):
            val = (getattr(reqd_row, field, None) or "").strip()
            if val:
                parts.append(val)
        return "\n".join(parts)

    def _reqd_belongs_to_req(self, reqd_row, req: SrsReq, hierarchy_map: dict) -> bool:
        """reqd 须属于当前 req：新 key 复用旧编号时，库内残留的其他功能描述不参与同步。"""
        if reqd_row is None or req is None:
            return True
        detail = self._reqd_detail_text(reqd_row)
        if not detail.strip():
            return True
        chapter = self._req_chapter_norm(req, hierarchy_map)
        if not chapter:
            return True
        if self._text_mentions_feature(detail, chapter):
            return True
        detail_cmp = re.sub(r"\s+", "", detail.lower())
        for marker in ("操作指南", "快捷键映射", "keymap"):
            if marker.replace(" ", "").lower() in detail_cmp:
                return False
        return True

    def _compose_design_text_for_trace_sync(
        self,
        req: Optional[SrsReq],
        srs_code: str,
        req_id: Optional[int],
        reqd_by_srs_code: Dict[str, SrsReqd],
        reqd_by_req_id: Dict[int, SrsReqd],
        hierarchy_map: dict,
        trace_rows,
    ) -> str:
        """功能设计正文严格来自 SRS reqd，不合成、不猜测。"""
        srs_reqd_row = None
        if req_id is not None:
            srs_reqd_row = reqd_by_req_id.get(req_id)
        if srs_reqd_row is None:
            srs_reqd_row = reqd_by_srs_code.get(str(srs_code or "").strip())
        if srs_reqd_row is not None and req is not None and not self._reqd_belongs_to_req(
            srs_reqd_row, req, hierarchy_map
        ):
            srs_reqd_row = None
        overview = (getattr(srs_reqd_row, "overview", None) or "").strip()
        func_detail = _reqd_compose_srs_function_for_design(srs_reqd_row) if srs_reqd_row else ""
        return sdstreqd_serv.compose_design_text_for_sync(overview, func_detail)

    def _ensure_leaf_title(self, node: Optional[SdsNodeForm], display_title: str):
        """叶子/绑定节点标题与 SRS 章节名保持一致。"""
        if node is None or not display_title:
            return
        body = self._strip_sds_heading_text(getattr(node, "title", "") or "") or ""
        if self._normalize_sds_node_title(body) == self._normalize_sds_node_title(display_title):
            return
        heading = self._parse_sds_node_heading(getattr(node, "title", "") or "")
        node.title = f"{heading} {display_title}".strip() if heading else display_title

    def _collect_active_trace_codes(self, trace_rows) -> set:
        codes = set()
        for trace, req in trace_rows or []:
            raw = getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS")
            for token in re.split(r"[\r\n,，;；]+", str(raw)):
                code = self._normalize_code(token)
                if code:
                    codes.add(code)
        return codes

    def _is_product_sync_area_node(
        self,
        roots: List[SdsNodeForm],
        node: SdsNodeForm,
        parent_map: Dict[int, Optional[SdsNodeForm]] = None,
        design_roots: List[SdsNodeForm] = None,
    ) -> bool:
        """产品章 X.6 之后同步区（含无章节号的 Word 导入残留）。"""
        if node is None:
            return False
        if self._is_in_fixed_template_zone(roots, node, parent_map, design_roots):
            return False
        parent_map = parent_map or self._build_node_parent_map(roots)
        design_roots = design_roots or self._find_design_chapter_roots(roots)
        product_root = self._find_product_root_for_node(roots, node, parent_map, design_roots)
        if product_root is None:
            return False
        major = self._product_chapter_major(product_root)
        if major is None:
            return True
        current = node
        while current is not None and current is not product_root:
            minor = self._heading_section_minor(getattr(current, "title", "") or "", major)
            if minor is not None:
                return minor > self.FIXED_TEMPLATE_SECTION_MAX
            current = parent_map.get(id(current))
        parent = parent_map.get(id(node))
        if parent is product_root:
            minor = self._heading_section_minor(getattr(node, "title", "") or "", major)
            return minor is None or minor > self.FIXED_TEMPLATE_SECTION_MAX
        return False

    def _node_subtree_has_active_trace_code(
        self,
        node: SdsNodeForm,
        active_codes: set,
    ) -> bool:
        for code in self._extract_node_sds_codes(node):
            if self._normalize_code(code) in active_codes:
                return True
        field = self._normalize_code(getattr(node, "sds_code", "") or "")
        if field in active_codes:
            return True
        return any(
            self._node_subtree_has_active_trace_code(child, active_codes)
            for child in getattr(node, "children", None) or []
        )

    def _node_subtree_has_image(self, node: SdsNodeForm) -> bool:
        """子树内是否含图片（程序逻辑图等）：图节点无追溯编号，
        清理同步区残留章节时须按内容保留，避免误删用户导入的程序逻辑图。"""
        if node is None:
            return False
        if str(getattr(node, "img_url", "") or "").strip():
            return True
        return any(
            self._node_subtree_has_image(child)
            for child in getattr(node, "children", None) or []
        )

    def _remove_sync_title_duplicates_without_code(
        self,
        roots: List[SdsNodeForm],
        trace_rows,
    ) -> List[SdsNodeForm]:
        """去掉同步区内无追溯编号、但标题与已绑定节点重复的 Word 残留/空章节。"""
        active_codes = self._collect_active_trace_codes(trace_rows)
        if not active_codes:
            return roots
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        def body_norm(node: SdsNodeForm) -> str:
            return self._normalize_sds_node_title(
                self._strip_sds_heading_text(getattr(node, "title", "") or "")
            )

        def merge_content(keeper: SdsNodeForm, duplicate: SdsNodeForm):
            if not (getattr(keeper, "text", "") or "").strip() and (getattr(duplicate, "text", "") or "").strip():
                keeper.text = duplicate.text
            if not (getattr(keeper, "img_url", "") or "").strip() and (getattr(duplicate, "img_url", "") or "").strip():
                keeper.img_url = duplicate.img_url
            if not getattr(keeper, "table", None) and getattr(duplicate, "table", None):
                keeper.table = duplicate.table

        coded_by_title: Dict[tuple, SdsNodeForm] = {}

        def index_product(product_root: SdsNodeForm):
            product_key = id(product_root)

            def walk(node: SdsNodeForm):
                for child in getattr(node, "children", None) or []:
                    if not self._is_product_sync_area_node(
                        roots, child, parent_map, design_roots
                    ):
                        walk(child)
                        continue
                    norm = body_norm(child)
                    if norm and self._node_subtree_has_active_trace_code(child, active_codes):
                        key = (product_key, norm)
                        prev = coded_by_title.get(key)
                        if prev is None:
                            coded_by_title[key] = child
                        elif getattr(child, "sds_code", None) and not getattr(prev, "sds_code", None):
                            coded_by_title[key] = child
                    walk(child)

            walk(product_root)

        for product_root in design_roots:
            index_product(product_root)

        def clean(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
            kept: List[SdsNodeForm] = []
            for node in nodes or []:
                node.children = clean(getattr(node, "children", None) or [])
                if not self._is_product_sync_area_node(roots, node, parent_map, design_roots):
                    kept.append(node)
                    continue
                norm = body_norm(node)
                product_root = self._find_product_root_for_node(roots, node, parent_map, design_roots)
                key = (id(product_root), norm) if product_root and norm else None
                keeper = coded_by_title.get(key) if key else None
                if keeper is not None and keeper is not node:
                    if not self._node_subtree_has_active_trace_code(node, active_codes):
                        merge_content(keeper, node)
                        continue
                kept.append(node)
            return kept

        return clean(roots or [])

    def _prune_sync_branches_without_active_trace(
        self,
        roots: List[SdsNodeForm],
        trace_rows,
    ) -> List[SdsNodeForm]:
        """同步区只保留 SRS 追溯覆盖到的分支，去掉 Word 导入残留章节。"""
        active_codes = self._collect_active_trace_codes(trace_rows)
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        def prune(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
            kept = []
            for node in nodes or []:
                node.children = prune(getattr(node, "children", None) or [])
                if not self._is_product_sync_area_node(roots, node, parent_map, design_roots):
                    kept.append(node)
                    continue
                if self._node_subtree_has_active_trace_code(node, active_codes):
                    kept.append(node)
                elif self._node_subtree_has_image(node):
                    # 含程序逻辑图等图片内容的分支随所属功能保留，不当作残留删除
                    kept.append(node)
            return kept

        return prune(roots or [])

    def _node_owned_by_other_req(self, node: SdsNodeForm, req_id: int, by_req_id: Dict[int, SdsNodeForm]) -> bool:
        if node is None or req_id is None:
            return False
        owner = next((rid for rid, bound in by_req_id.items() if bound is node), None)
        return owner is not None and owner != req_id

    def _resolve_existing_node_for_trace(
        self,
        trace: SdsTrace,
        req: SrsReq,
        code: str,
        candidate_codes: List[str],
        by_code: dict,
        by_req_id: Dict[int, SdsNodeForm],
        saved_location: str,
        hierarchy_map: dict,
        module_name: str,
        expected_text: str,
        roots: List[SdsNodeForm],
        target_product: Optional[SdsNodeForm],
        word_imported: bool,
        trace_rows=None,
    ) -> Optional[SdsNodeForm]:
        """仅 req_id 绑定或 location 确认时复用；新 key 复用旧 SDS 编号时不得占旧章节。"""
        req_id = getattr(req, "id", None)
        req_bound = by_req_id.get(req_id)
        if req_bound is not None and self._node_content_belongs_to_req(
            req_bound, req, req_id, hierarchy_map, module_name, expected_text, trace_rows, by_req_id
        ):
            return req_bound
        norm_code = re.sub(r"\s+", "", str(code or "").strip().upper())
        candidate = by_code.get(code)
        if candidate is None:
            for old_code in candidate_codes:
                if old_code == code:
                    continue
                candidate = by_code.get(old_code)
                if candidate is not None:
                    break
        if candidate is not None and not self._node_owned_by_other_req(candidate, req_id, by_req_id):
            bound_code = re.sub(r"\s+", "", str(getattr(candidate, "sds_code", "") or "").strip().upper())
            if bound_code == norm_code:
                if self._is_new_req_reusing_sds_code_node(
                    candidate, req, req_id, by_req_id, hierarchy_map, module_name, expected_text, trace_rows
                ):
                    self._release_node_sds_code(candidate, norm_code, by_code, candidate_codes)
                    if self._node_has_foreign_feature_body(
                        candidate, req, hierarchy_map, module_name, expected_text, trace_rows, req_id
                    ):
                        self._detach_node(roots, candidate)
                    return None
                if not self._node_matches_req_hierarchy(candidate, req, hierarchy_map, module_name):
                    self._release_node_sds_code(candidate, norm_code, by_code, candidate_codes)
                    return None
                return candidate
            if self._trace_can_reuse_node(
                trace, req, candidate, hierarchy_map, module_name,
                expected_text, roots, target_product, req_bound, by_req_id, trace_rows,
            ):
                return candidate
        if saved_location:
            candidate = self._find_design_node_by_heading(roots, saved_location, target_product)
            if candidate is not None and not self._node_owned_by_other_req(candidate, req_id, by_req_id):
                if not self._node_matches_req_hierarchy(candidate, req, hierarchy_map, module_name):
                    return None
                if self._trace_can_reuse_node(
                    trace, req, candidate, hierarchy_map, module_name,
                    expected_text, roots, target_product, req_bound, by_req_id, trace_rows,
                ):
                    return candidate
        return None

    def _dedupe_sync_area_siblings_by_title(self, roots: List[SdsNodeForm]) -> List[SdsNodeForm]:
        """合并同一父级下标题相同的重复章节，保留有 SDS 编号/正文更完整者。"""
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        def node_score(node: SdsNodeForm) -> tuple:
            code = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "").strip().upper())
            text_len = len(str(getattr(node, "text", "") or ""))
            child_len = len(getattr(node, "children", None) or [])
            return (1 if code else 0, text_len, child_len)

        def merge_nodes(keeper: SdsNodeForm, duplicate: SdsNodeForm):
            if not (getattr(keeper, "sds_code", "") or "").strip() and (getattr(duplicate, "sds_code", "") or "").strip():
                keeper.sds_code = duplicate.sds_code
            if not (getattr(keeper, "text", "") or "").strip() and (getattr(duplicate, "text", "") or "").strip():
                keeper.text = duplicate.text
            if not (getattr(keeper, "img_url", "") or "").strip() and (getattr(duplicate, "img_url", "") or "").strip():
                keeper.img_url = duplicate.img_url
            if not getattr(keeper, "table", None) and getattr(duplicate, "table", None):
                keeper.table = duplicate.table
            keeper.children = list(getattr(keeper, "children", None) or [])
            for child in getattr(duplicate, "children", None) or []:
                if child not in keeper.children:
                    keeper.children.append(child)

        def in_sync_area(node: SdsNodeForm) -> bool:
            if self._is_in_fixed_template_zone(roots, node, parent_map, design_roots):
                return False
            product_root = self._find_product_root_for_node(roots, node, parent_map, design_roots)
            if product_root is None:
                return False
            major = self._product_chapter_major(product_root)
            if major is None:
                return False
            current = node
            while current is not None and current is not product_root:
                minor = self._heading_section_minor(getattr(current, "title", "") or "", major)
                if minor is not None:
                    return minor > self.FIXED_TEMPLATE_SECTION_MAX
                current = parent_map.get(id(current))
            return False

        def dedupe_children(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
            kept: List[SdsNodeForm] = []
            index: Dict[str, SdsNodeForm] = {}
            for node in nodes or []:
                node.children = dedupe_children(getattr(node, "children", None) or [])
                if not in_sync_area(node):
                    kept.append(node)
                    continue
                body_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(node, "title", "") or "")
                )
                if not body_norm:
                    kept.append(node)
                    continue
                prev = index.get(body_norm)
                if prev is None:
                    index[body_norm] = node
                    kept.append(node)
                    continue
                if node_score(node) > node_score(prev):
                    merge_nodes(node, prev)
                    kept[kept.index(prev)] = node
                    index[body_norm] = node
                else:
                    merge_nodes(prev, node)
            return kept

        return dedupe_children(roots or [])

    def _is_change_requirement(self, code: str, type_code: str) -> bool:
        series_num = self._rcn_series_num(code)
        type_code = str(type_code or "").strip()
        if series_num == 307:
            return True
        if type_code in ("1", "2", "reqd", ""):
            return False
        if series_num is not None and 301 <= series_num <= 308:
            return True
        return True

    _CHANGE_CONTAINER_TITLES = ("新增需求", "变更需求", "标准需求")
    _ALGORITHM_REQ_TITLES = ("算法和数据要求", "算法要求")

    def _algorithm_req_title_norms(self) -> set:
        return {self._normalize_sds_node_title(x) for x in self._ALGORITHM_REQ_TITLES}

    def _is_algorithm_requirement(self, req: SrsReq, hierarchy_map: dict) -> bool:
        """算法和数据要求 / 算法要求：保留追溯行，不生成 SDS 章节。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        names = [
            fields.get("module"),
            fields.get("function"),
            fields.get("sub_function"),
            sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields),
        ]
        norms = self._algorithm_req_title_norms()
        return any(self._normalize_sds_node_title(name or "") in norms for name in names)

    def _container_title_norms(self) -> set:
        return {self._normalize_sds_node_title(x) for x in self._CHANGE_CONTAINER_TITLES}

    def _is_container_title(self, title: str) -> bool:
        return self._normalize_sds_node_title(str(title or "")) in self._container_title_norms()

    def _effective_display_title(
        self,
        req: SrsReq,
        hierarchy_map: dict,
        child_titles: Optional[List[str]] = None,
    ) -> str:
        """章节显示名：容器层（新增需求等）不能作为叶子标题，取子功能/功能名。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        containers = self._container_title_norms()
        sub = str(fields.get("sub_function") or "").strip()
        if sub and self._normalize_sds_node_title(sub) not in containers:
            chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
            return chapter or sub
        title = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
        if title and self._normalize_sds_node_title(title) not in containers:
            return title
        for item in reversed(child_titles or []):
            txt = str(item or "").strip()
            if txt and not self._is_container_title(txt):
                return txt
        return title or sub or str(fields.get("function") or "").strip()

    def _raw_hierarchy_titles(self, req: SrsReq, hierarchy_map: dict) -> List[str]:
        """SRS 完整层级（含容器模块），用于识别「新增需求/测试」等路径。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        titles: List[str] = []
        seen: set = set()
        for key in ("module", "function", "sub_function"):
            txt = str(fields.get(key) or "").strip()
            if not txt or txt in ("/", "-", "\\"):
                continue
            norm = self._normalize_sds_node_title(txt)
            if norm and norm not in seen:
                seen.add(norm)
                titles.append(txt)
        if not titles:
            leaf = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
            if leaf:
                titles.append(leaf)
        return titles

    def _standard_leaf_after_container_strip(
        self,
        child_titles: Optional[List[str]],
        is_change_req: bool,
        req: Optional[SrsReq] = None,
        hierarchy_map: dict = None,
    ) -> bool:
        """标准需求：原路径以「新增需求」等容器开头，去掉容器后只剩单叶子。"""
        if is_change_req:
            return False
        if req is not None and hierarchy_map is not None:
            fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
            raw_mod = str(fields.get("module") or "").strip()
            func = str(fields.get("function") or "").strip()
            if func and raw_mod and self._is_container_title(raw_mod):
                return False
        raw = [str(t or "").strip() for t in (child_titles or []) if str(t or "").strip()]
        if len(raw) < 2 or not self._is_container_title(raw[0]):
            return False
        stripped = self._standard_sync_titles(False, raw, "", "") or []
        return len(stripped) == 1

    def _standard_sync_titles(
        self,
        is_change_req: bool,
        child_titles: Optional[List[str]],
        display_title: str,
        module_name: str = "",
    ) -> Optional[List[str]]:
        """标准需求保留 功能→子功能 层级；307/308 变更区内新需求才压平为单叶子。"""
        containers = self._container_title_norms()
        titles = [str(t or "").strip() for t in (child_titles or []) if str(t or "").strip()]
        while titles and self._normalize_sds_node_title(titles[0]) in containers:
            titles.pop(0)
        if is_change_req and module_name:
            mod_norm = self._normalize_sds_node_title(module_name)
            while titles and self._normalize_sds_node_title(titles[0]) == mod_norm:
                titles.pop(0)
        deduped: List[str] = []
        prev_norm = None
        for title in titles:
            norm = self._normalize_sds_node_title(title)
            if norm and norm != prev_norm:
                deduped.append(title)
                prev_norm = norm
        titles = deduped
        if is_change_req:
            display_norm = self._normalize_sds_node_title(display_title or "")
            if display_norm:
                if not titles:
                    return [display_title]
                if self._normalize_sds_node_title(titles[-1]) == display_norm:
                    return [display_title]
        if not titles and display_title:
            return [display_title]
        return titles

    def _sync_design_text_to_node(
        self,
        node: Optional[SdsNodeForm],
        expected_text: str,
        req: Optional[SrsReq] = None,
        hierarchy_map: Optional[dict] = None,
        module_name: str = "",
        by_req_id: Optional[Dict[int, SdsNodeForm]] = None,
        trace_rows=None,
    ):
        """追溯同步：同 req_id 且正文已匹配 SRS 则保留；否则写入 SRS reqd 正文。"""
        if node is None or not expected_text:
            return
        existing = (getattr(node, "text", "") or "").strip()
        if existing == expected_text.strip():
            return
        req_id = getattr(req, "id", None) if req is not None else None
        if (
            req is not None
            and by_req_id is not None
            and req_id is not None
            and by_req_id.get(req_id) is node
        ):
            # 该节点已被内容/功能名匹配确认是同一功能：
            # 1) 节点有实质设计内容 → 保留（改名/编号偏移不丢内容）；
            if self._node_has_substantive_design_body(node):
                return
            # 2) 节点为空、SRS 设计有实质内容 → 取 SRS 填充（新增功能补全内容）；
            if self._design_text_is_substantive(expected_text):
                node.text = expected_text
                return
            # 3) 正文与 SRS 同源，或两者皆空 → 维持现状。
            return
        if (
            req is not None
            and hierarchy_map is not None
            and self._node_has_foreign_feature_body(
                node, req, hierarchy_map, module_name, expected_text, trace_rows, req_id
            )
        ):
            node.text = expected_text
            return
        if not existing:
            node.text = expected_text
            return
        if req is not None and hierarchy_map is not None and self._node_content_belongs_to_req(
            node, req, req_id, hierarchy_map, module_name, expected_text, trace_rows, by_req_id
        ):
            return
        node.text = expected_text

    def _sync_path_titles(
        self,
        is_change_req: bool,
        child_titles: Optional[List[str]],
        display_title: str,
        module_name: str = "",
    ) -> List[str]:
        """兼容旧调用：优先使用 child_titles 作为已算好的路径。"""
        path = [str(t or "").strip() for t in (child_titles or []) if str(t or "").strip()]
        if path:
            return path
        if display_title:
            return [display_title]
        return self._standard_sync_titles(
            is_change_req, child_titles, display_title, module_name
        ) or []

    def _module_insert_titles(
        self,
        is_change_req: bool,
        child_titles: Optional[List[str]],
        display_title: str,
        module_name: str = "",
    ) -> Optional[List[str]]:
        """模块下插入：单叶子走平级；仅多级且确有分组时才 append_hierarchy。"""
        titles = self._standard_sync_titles(
            is_change_req, child_titles, display_title, module_name
        ) or []
        return titles if len(titles) > 1 else None

    def _remove_empty_duplicate_sync_containers(self, roots: List[SdsNodeForm]) -> List[SdsNodeForm]:
        """去掉同步区内与父级同名、无编号/正文的空容器，子节点上提。"""
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)
        design_root_ids = {id(r) for r in design_roots}

        def in_sync_area(node: SdsNodeForm) -> bool:
            current = node
            while current is not None:
                if id(current) in design_root_ids:
                    major = self._product_chapter_major(current)
                    if major is not None:
                        minor = self._heading_section_minor(getattr(node, "title", "") or "", major)
                        if minor is not None:
                            return minor > self.FIXED_TEMPLATE_SECTION_MAX
                    return True
                current = parent_map.get(id(current))
            return False

        def clean(nodes: List[SdsNodeForm], parent: Optional[SdsNodeForm] = None) -> List[SdsNodeForm]:
            kept: List[SdsNodeForm] = []
            for node in nodes or []:
                node.children = clean(getattr(node, "children", None) or [], node)
                if not in_sync_area(node):
                    kept.append(node)
                    continue
                has_code = bool(getattr(node, "sds_code", None))
                has_text = bool((getattr(node, "text", "") or "").strip())
                has_image = bool(str(getattr(node, "img_url", "") or "").strip())
                children = getattr(node, "children", None) or []
                if parent is not None and not has_code and not has_text and not has_image and children:
                    node_norm = self._normalize_sds_node_title(
                        self._strip_sds_heading_text(getattr(node, "title", "") or "")
                    )
                    parent_norm = self._normalize_sds_node_title(
                        self._strip_sds_heading_text(getattr(parent, "title", "") or "")
                    )
                    if node_norm and node_norm == parent_norm:
                        kept.extend(children)
                        continue
                # 含图片（程序逻辑图等）的节点不是空容器，须随功能保留
                if not has_code and not has_text and not children and not has_image:
                    continue
                kept.append(node)
            return kept

        return clean(roots or [])

    def _remove_stray_image_display_modules(self, roots: List[SdsNodeForm]) -> List[SdsNodeForm]:
        """删除产品章节下多余的「图像显示」节点（第 6 章 NeoViewer 即图像显示）。"""
        target_norm = self._normalize_sds_node_title("图像显示")
        design_roots = self._find_design_chapter_roots(roots)

        for product_root in design_roots:
            kept = []
            for child in list(getattr(product_root, "children", None) or []):
                body_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(child, "title", "") or "")
                )
                if body_norm == target_norm:
                    orphans = list(getattr(child, "children", None) or [])
                    kept.extend(orphans)
                    continue
                kept.append(child)
            product_root.children = kept

        def walk(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
            kept = []
            for node in nodes or []:
                node.children = walk(getattr(node, "children", None) or [])
                body_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(node, "title", "") or "")
                )
                heading = self._parse_sds_node_heading(getattr(node, "title", "") or "")
                if body_norm == target_norm and not getattr(node, "sds_code", None):
                    if not heading or not getattr(node, "children", None):
                        continue
                kept.append(node)
            return kept

        return walk(roots or [])

    def _sync_trace_locations_from_tree(
        self,
        doc_id: int,
        roots: List[SdsNodeForm],
        by_code: dict,
        by_title: dict,
    ):
        rows = db.session.execute(
            select(SdsTrace, SrsReq).join(SrsReq, SrsReq.id == SdsTrace.req_id).where(SdsTrace.doc_id == doc_id)
        ).all()
        for trace, req in rows:
            trace_code = self._normalize_code(
                getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS")
            )
            type_code = str(getattr(req, "type_code", "") or "").strip()
            location = _trace_resolve_sds_tree_location(
                getattr(trace, "sds_code", "") or "",
                req,
                roots,
                by_code,
                by_title or {},
            )
            if location and trace_code and not self._is_valid_sync_location_for_req(
                location.split("\n")[0].strip(), trace_code, type_code
            ):
                location = ""
            trace.location = location or None
        db.session.flush()

    def _trace_can_reuse_node(
        self,
        trace: SdsTrace,
        req: SrsReq,
        node: SdsNodeForm,
        hierarchy_map: dict,
        module_name: str,
        expected_text: str,
        roots: List[SdsNodeForm],
        target_product: Optional[SdsNodeForm],
        bound_by_req_id: Optional[SdsNodeForm] = None,
        by_req_id: Optional[Dict[int, SdsNodeForm]] = None,
        trace_rows=None,
    ) -> bool:
        """同一 req_id 已绑定且正文属于该需求才可复用。"""
        if node is None or req is None:
            return False
        req_id = getattr(req, "id", None)
        by_req_id = by_req_id or {}
        return self._node_content_belongs_to_req(
            node, req, req_id, hierarchy_map, module_name, expected_text, trace_rows, by_req_id
        )

    def _is_misplaced_after_prev_sds(
        self,
        node: SdsNodeForm,
        code: str,
        prev_code: str,
        by_code: dict,
    ) -> bool:
        """当前 SDS 编号更大，但章节号却排在前序编号之前。"""
        if not node or not code or not prev_code:
            return False
        if self._sds_code_sort_key(code) <= self._sds_code_sort_key(prev_code):
            return False
        prev_node = by_code.get(prev_code)
        if prev_node is None or prev_node is node:
            return False
        node_heading = self._parse_sds_node_heading(getattr(node, "title", "") or "")
        prev_heading = self._parse_sds_node_heading(getattr(prev_node, "title", "") or "")
        if not node_heading or not prev_heading:
            return False
        return self._heading_tuple(node_heading) <= self._heading_tuple(prev_heading)

    def _release_node_sds_code(self, node: SdsNodeForm, code: str, by_code: dict, extra_codes: Optional[List[str]] = None):
        if node is None or not code:
            return
        if self._normalize_code(getattr(node, "sds_code", "") or "") == code:
            node.sds_code = None
        by_code.pop(code, None)
        for item in extra_codes or []:
            if item and item != code:
                by_code.pop(item, None)

    def _prev_code_in_module(
        self,
        current_code: str,
        ordered_codes: List[str],
        by_code: dict,
        module_name: str,
        roots: List[SdsNodeForm],
        parent_map: Dict[int, Optional[SdsNodeForm]],
        product_root: Optional[SdsNodeForm] = None,
    ) -> Optional[str]:
        module_node = self._find_module_node(product_root, module_name) if (module_name and product_root) else None
        if module_node is None:
            module_node = self._find_module_node_global(roots, module_name) if module_name else None
        if module_node is None:
            return None
        prev = None
        for item_code in ordered_codes:
            if item_code == current_code:
                break
            node = by_code.get(item_code)
            if not node:
                continue
            if module_node is not None and not self._is_descendant_of(module_node, node, parent_map):
                continue
            prev = item_code
        return prev

    def _build_sds_code_location_map(self, roots: List[SdsNodeForm]) -> dict:
        by_code, _by_title = self._build_sds_tree_location_indexes(roots)
        return by_code

    def _infer_node_for_missing_sds_code(self, roots: List[SdsNodeForm], sds_code: str) -> Optional[SdsNodeForm]:
        target = self._normalize_code(sds_code or "")
        if not target:
            return None

        def code_key(value: str):
            nums = re.findall(r"\d+", self._normalize_code(value or ""))
            return tuple(int(num) for num in nums) if nums else tuple()

        target_key = code_key(target)
        if not target_key:
            return None

        flat = []

        def walk(nodes: List[SdsNodeForm], parent: Optional[SdsNodeForm] = None):
            for node in nodes or []:
                flat.append((node, parent))
                if self._normalize_code(getattr(node, "sds_code", "") or "") == target:
                    return node
                found = walk(getattr(node, "children", None) or [], node)
                if found:
                    return found
            return None

        exact = walk(roots or [])
        if exact:
            return exact

        previous = None
        previous_key = tuple()
        for node, parent in flat:
            code = self._normalize_code(getattr(node, "sds_code", "") or "")
            key = code_key(code)
            if key and key < target_key and (not previous_key or key > previous_key):
                previous = (node, parent)
                previous_key = key
        if not previous:
            return None

        prev_node, parent = previous
        siblings = getattr(parent, "children", None) if parent else roots
        try:
            start = list(siblings or []).index(prev_node) + 1
        except ValueError:
            return None
        prev_heading = self._parse_sds_node_heading(getattr(prev_node, "title", "") or "")
        prev_depth = len(prev_heading.split(".")) if prev_heading else 0
        for candidate in list(siblings or [])[start:]:
            title = str(getattr(candidate, "title", "") or "")
            if self._normalize_code(getattr(candidate, "sds_code", "") or ""):
                break
            if self._is_function_stopper_title(title):
                break
            heading = self._parse_sds_node_heading(title)
            if prev_depth and heading and len(heading.split(".")) != prev_depth:
                continue
            stripped = self._strip_heading_number(title)
            if not stripped or stripped.startswith("图 ") or stripped.startswith("导入"):
                continue
            candidate.sds_code = target
            return candidate
        return None

    def _persist_trace_chapters_from_srs(self, doc_id: int, by_code: dict, by_title: dict, roots: List[SdsNodeForm]):
        rows = db.session.execute(
            select(SdsTrace, SrsReq).join(SrsReq, SrsReq.id == SdsTrace.req_id).where(SdsTrace.doc_id == doc_id)
        ).all()
        srs_doc_id = db.session.execute(select(SdsDoc.srsdoc_id).where(SdsDoc.id == doc_id)).scalar()
        hierarchy_map = _trace_load_srs_req_hierarchy_map(srs_doc_id)
        self._restore_product_root_headings(roots)
        strict_location_map = self._build_strict_srs_trace_location_map(rows, hierarchy_map, roots)
        for trace, req in rows:
            req_fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
            chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **req_fields)
            trace_code = self._normalize_code(getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS"))
            type_code = str(getattr(req, "type_code", "") or "").strip()
            if self._is_algorithm_requirement(req, hierarchy_map):
                trace.chapter = chapter or None
                trace.location = None
                continue
            location = strict_location_map.get(trace_code) or ""
            if not location:
                location = _trace_resolve_sds_tree_location(
                getattr(trace, "sds_code", "") or "",
                req,
                roots,
                by_code,
                by_title or {},
            )
            inferred_node = None
            if not location:
                inferred_node = self._infer_node_for_missing_sds_code(roots, getattr(trace, "sds_code", "") or "")
                if inferred_node:
                    inferred_heading = self._parse_sds_node_heading(getattr(inferred_node, "title", "") or "")
                    location = inferred_heading or location
            if location and not self._is_valid_sync_location_for_req(location, trace_code, type_code):
                location = ""
            if inferred_node and not (req_fields.get("module") or req_fields.get("sub_function")):
                inferred_name = self._strip_heading_number(getattr(inferred_node, "title", "") or "")
                if inferred_name:
                    chapter = inferred_name
                    req.function = inferred_name
            if chapter:
                trace.chapter = chapter
            else:
                trace.chapter = None
            trace.location = location or None
        self._apply_strict_srs_trace_headings(rows, hierarchy_map, roots, strict_location_map)
        db.session.flush()

    def _restore_product_root_headings(self, roots: List[SdsNodeForm]):
        for root in self._find_design_chapter_roots(roots):
            major = self._product_chapter_major(root)
            if major is None:
                continue
            heading = self._parse_sds_node_heading(getattr(root, "title", "") or "")
            if heading == str(major):
                continue
            body = self._strip_sds_heading_text(getattr(root, "title", "") or "") or getattr(root, "title", "") or ""
            root.title = f"{major} {body}".strip() if body else str(major)

    def _apply_strict_srs_trace_headings(self, rows, hierarchy_map: dict, roots: List[SdsNodeForm], strict_location_map: Dict[str, str]):
        parent_map = self._build_node_parent_map(roots)
        design_root_ids = {id(root) for root in self._find_design_chapter_roots(roots)}

        def is_placeholder(value: str) -> bool:
            txt = str(value or "").strip()
            return not txt or txt in {"/", "-", "\\", "--", "无", "暂无"}

        def set_heading(node: SdsNodeForm, heading: str):
            if node is None or not heading:
                return
            if id(node) in design_root_ids:
                return
            body = self._strip_sds_heading_text(getattr(node, "title", "") or "") or getattr(node, "title", "") or ""
            node.title = f"{heading} {body}".strip() if body else heading

        for trace, req in rows or []:
            sds_code = self._normalize_code(getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS"))
            location = strict_location_map.get(sds_code)
            if not location:
                continue
            node = self._find_node_by_code_in_tree(roots, sds_code)
            if node is None:
                continue
            lv = self._resolve_srs_hierarchy_levels(req, hierarchy_map)
            has_function = not is_placeholder(lv.get("function"))
            has_sub = not is_placeholder(lv.get("sub_function"))
            parts = location.split(".")
            if has_sub and len(parts) >= 4:
                set_heading(node, location)
                function_node = parent_map.get(id(node))
                module_node = parent_map.get(id(function_node)) if function_node is not None else None
                set_heading(function_node, ".".join(parts[:3]))
                set_heading(module_node, ".".join(parts[:2]))
            elif has_function and len(parts) >= 3:
                set_heading(node, location)
                module_node = parent_map.get(id(node))
                set_heading(module_node, ".".join(parts[:2]))
            elif len(parts) >= 2:
                set_heading(node, location)

    def _build_strict_srs_trace_location_map(self, rows, hierarchy_map: dict, roots: List[SdsNodeForm]) -> Dict[str, str]:
        """按 SDS 编号顺序严格编号：模块=二级，功能=三级，子功能=四级（标准/变更需求统一）。"""
        result: Dict[str, str] = {}
        module_seq_by_base: Dict[str, Dict[str, int]] = {}
        function_seq_by_module: Dict[Tuple[str, str], Dict[str, int]] = {}
        sub_seq_by_function: Dict[Tuple[str, str, str], Dict[str, int]] = {}
        base_heading_by_root: Dict[int, str] = {}

        def norm_name(value: str) -> str:
            return self._normalize_sds_node_title(value or "") or str(value or "").strip()

        def is_placeholder(value: str) -> bool:
            txt = str(value or "").strip()
            return not txt or txt in {"/", "-", "\\", "--", "无", "暂无"}

        def module_heading_for(base_heading: str, module_key: str) -> str:
            module_seq = module_seq_by_base.setdefault(base_heading, {})
            module_idx = module_seq.setdefault(module_key, len(module_seq) + 1)
            base_parent = ".".join(base_heading.split(".")[:-1])
            try:
                return (
                    f"{base_parent}.{int(base_heading.split('.')[-1]) + module_idx - 1}"
                    if base_parent
                    else str(int(base_heading) + module_idx - 1)
                )
            except Exception:
                return f"{base_heading}.{module_idx}"

        sorted_rows = sorted(
            rows or [],
            key=lambda item: self._sds_code_sort_key(
                getattr(item[0], "sds_code", "") or str(getattr(item[1], "code", "") or "").replace("SRS", "SDS")
            ),
        )
        for trace, req in sorted_rows:
            type_code = str(getattr(req, "type_code", "") or "").strip()
            sds_code = self._normalize_code(getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS"))
            if not sds_code:
                continue
            if self._is_algorithm_requirement(req, hierarchy_map):
                continue
            product_root = self._resolve_product_root_for_req(
                roots,
                sds_code,
                getattr(req, "module", "") or "",
                type_code,
            )
            major = self._product_chapter_major(product_root) if product_root is not None else None
            if major is None:
                major = self._resolve_product_major_for_req(sds_code, type_code)
            if major is None:
                continue
            root_heading = str(major)
            root_key = id(product_root) if product_root is not None else hash(root_heading)
            base_heading = base_heading_by_root.get(root_key)
            if not base_heading:
                base_heading = f"{root_heading}.6"
                base_heading_by_root[root_key] = base_heading
            is_change = self._is_change_requirement(sds_code, type_code)
            path = self._req_hierarchy_path(req, hierarchy_map, is_change, rows)
            if not path:
                continue
            module_key = norm_name(path[0])
            module_heading = module_heading_for(base_heading, module_key)
            if len(path) == 1:
                result[sds_code] = module_heading
                continue
            function_key = norm_name(path[1])
            function_seq = function_seq_by_module.setdefault((base_heading, module_key), {})
            function_idx = function_seq.setdefault(function_key, len(function_seq) + 1)
            if len(path) == 2:
                result[sds_code] = f"{module_heading}.{function_idx}"
                continue
            sub_key = norm_name(path[2])
            sub_seq = sub_seq_by_function.setdefault((base_heading, module_key, function_key), {})
            sub_idx = sub_seq.setdefault(sub_key, len(sub_seq) + 1)
            result[sds_code] = f"{module_heading}.{function_idx}.{sub_idx}"
        return result

    @staticmethod
    def _is_function_stopper_title(title: str) -> bool:
        txt = re.sub(r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))?", "", str(title or "")).strip()
        txt = re.sub(r"\s+", "", txt).lower()
        return "限制条件" in txt or "尚未解决的问题" in txt

    def _find_chapter6_root(self, roots: List[SdsNodeForm]) -> Optional[SdsNodeForm]:
        def parse_heading(value: str):
            matched = re.match(
                r"^\s*(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
                str(value or "").strip(),
            )
            if not matched:
                return None
            return [int(p) for p in matched.group(1).split(".") if p != ""]

        def walk(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                nums = parse_heading(getattr(node, "title", "") or "")
                title_txt = self._normalize_sds_node_title(getattr(node, "title", "") or "")
                if nums == [6] or "功能设计" in title_txt:
                    return node
                found = walk(getattr(node, "children", None) or [])
                if found:
                    return found
            return None

        return walk(roots or [])

    @staticmethod
    def _is_front_matter_root(title: str) -> bool:
        body = SdsSrsTraceSyncMixin._normalize_sds_node_title(title)
        return any(
            key in body
            for key in ("软件详细设计", "概述", "系统结构", "目录", "需求规格说明", "文件修订记录")
        )

    def _find_design_chapter_roots(self, roots: List[SdsNodeForm]) -> List[SdsNodeForm]:
        """各产品模块根节点（如 4 DataProcessing、7 NeoViewer），不含前言章节。"""
        out: List[SdsNodeForm] = []
        for node in roots or []:
            title = str(getattr(node, "title", "") or "")
            if self._is_front_matter_root(title):
                continue
            if self._parse_sds_node_heading(title):
                out.append(node)
        return out

    def _product_chapter_major(self, node: SdsNodeForm) -> Optional[int]:
        heading = self._parse_sds_node_heading(getattr(node, "title", "") or "")
        if not heading:
            return None
        part = heading.split(".")[0]
        try:
            return int(part)
        except Exception:
            return None

    def _heading_section_minor(self, title: str, major: int) -> Optional[int]:
        heading = self._parse_sds_node_heading(title or "")
        if not heading:
            return None
        try:
            parts = [int(p) for p in heading.split(".") if p != ""]
        except Exception:
            return None
        if not parts or parts[0] != major:
            return None
        return parts[1] if len(parts) >= 2 else None

    def _build_node_parent_map(self, roots: List[SdsNodeForm]) -> Dict[int, Optional[SdsNodeForm]]:
        parent_map: Dict[int, Optional[SdsNodeForm]] = {}

        def walk(nodes: List[SdsNodeForm], parent: Optional[SdsNodeForm] = None, seen: set = None):
            seen = seen or set()
            for node in nodes or []:
                if id(node) in seen:
                    continue
                seen.add(id(node))
                parent_map[id(node)] = parent
                walk(getattr(node, "children", None) or [], node, seen)

        walk(roots or [])
        return parent_map

    def _find_product_root_for_node(
        self,
        roots: List[SdsNodeForm],
        node: SdsNodeForm,
        parent_map: Dict[int, Optional[SdsNodeForm]] = None,
        design_roots: List[SdsNodeForm] = None,
    ) -> Optional[SdsNodeForm]:
        if node is None:
            return None
        design_roots = design_roots if design_roots is not None else self._find_design_chapter_roots(roots)
        design_root_ids = {id(root) for root in design_roots}
        if id(node) in design_root_ids:
            return node
        parent_map = parent_map or self._build_node_parent_map(roots)
        current = node
        while current is not None:
            if id(current) in design_root_ids:
                return current
            current = parent_map.get(id(current))
        return None

    def _is_in_fixed_template_zone(
        self,
        roots: List[SdsNodeForm],
        node: SdsNodeForm,
        parent_map: Dict[int, Optional[SdsNodeForm]] = None,
        design_roots: List[SdsNodeForm] = None,
    ) -> bool:
        """产品章节 X.1~X.5 及其子树：Word 导入后不可被追溯同步修改。"""
        product_root = self._find_product_root_for_node(roots, node, parent_map, design_roots)
        if product_root is None or node is product_root:
            return False
        major = self._product_chapter_major(product_root)
        if major is None:
            return False
        parent_map = parent_map or self._build_node_parent_map(roots)
        current = node
        while current is not None and current is not product_root:
            minor = self._heading_section_minor(getattr(current, "title", "") or "", major)
            if minor is not None and minor <= self.FIXED_TEMPLATE_SECTION_MAX:
                return True
            current = parent_map.get(id(current))
        return False

    def _resolve_product_root(self, roots: List[SdsNodeForm], module_name: str) -> Optional[SdsNodeForm]:
        """按模块名或 NAME_DICT 映射定位产品章节根（NeoViewer / RePACS 等）。"""
        design_roots = self._find_design_chapter_roots(roots)
        if not design_roots:
            return self._find_chapter6_root(roots)
        if not module_name:
            return design_roots[0]

        norm = self._normalize_sds_node_title(module_name)
        mapped = NAME_DICT.get(str(module_name or "").strip())
        if mapped:
            mapped_norm = self._normalize_sds_node_title(mapped)
            for root in design_roots:
                body = self._normalize_sds_node_title(getattr(root, "title", "") or "")
                if mapped_norm in body or body in mapped_norm:
                    return root

        for root in design_roots:
            body = self._normalize_sds_node_title(getattr(root, "title", "") or "")
            if norm and (norm in body or body in norm):
                return root
        return None

    def _find_product_root_by_name(self, roots: List[SdsNodeForm], product_name: str) -> Optional[SdsNodeForm]:
        norm = self._normalize_sds_node_title(product_name or "")
        if not norm:
            return None
        for root in self._find_design_chapter_roots(roots):
            body = self._normalize_sds_node_title(getattr(root, "title", "") or "")
            if norm and (norm in body or body in norm):
                return root
        return None

    @staticmethod
    def _rcn_series_num(code: str) -> Optional[int]:
        matched = re.search(r"RCN(\d+)", str(code or "").upper())
        return int(matched.group(1)) if matched else None

    def _resolve_product_root_for_req(
        self,
        roots: List[SdsNodeForm],
        code: str,
        module_name: str = None,
        type_code: str = None,
    ) -> Optional[SdsNodeForm]:
        """按 SDS 编号段 / 需求类型确定目标产品章节，优先按产品名而非章节号。"""
        series = self._rcn_series_num(code)
        type_code = str(type_code or "").strip()
        preferred_product = None
        if series is not None and 301 <= series <= 307:
            preferred_product = "NeoViewer"
        elif type_code and type_code not in ("1", "2", "reqd"):
            preferred_product = "NeoViewer"
        if preferred_product:
            root = self._find_product_root_by_name(roots, preferred_product)
            if root:
                return root
        major = self._resolve_product_major_for_req(code, type_code)
        if major is not None:
            root = self._find_product_root_by_major(roots, major)
            if root:
                return root
        return self._resolve_product_root(roots, module_name)

    @staticmethod
    def _resolve_product_major_for_req(code: str, type_code: str = None) -> Optional[int]:
        series = SdsSrsTraceSyncMixin._rcn_series_num(code)
        type_code = str(type_code or "").strip()
        if series is not None and 301 <= series <= 307:
            return 6
        if type_code and type_code not in ("1", "2", "reqd"):
            return 6
        return None

    def _is_valid_sync_location_for_req(self, location: str, code: str, type_code: str = None) -> bool:
        heading = str(location or "").strip().split("\n")[0].strip()
        if not heading:
            return False
        expected_major = self._resolve_product_major_for_req(code, type_code)
        if expected_major is None:
            return True
        try:
            parts = [int(part) for part in heading.split(".") if part != ""]
        except Exception:
            return False
        if not parts or parts[0] != expected_major:
            return False
        # 产品章节 X.1~X.5 是模板区，SRS 追溯生成/同步只能落在 X.6 及以后。
        return len(parts) >= 2 and parts[1] > self.FIXED_TEMPLATE_SECTION_MAX

    def _node_in_product_root(
        self, roots: List[SdsNodeForm], node: SdsNodeForm, product_root: Optional[SdsNodeForm]
    ) -> bool:
        if node is None or product_root is None:
            return False
        return self._find_product_root_for_node(roots, node) is product_root

    def _find_module_node(self, chapter_root: SdsNodeForm, module_name: str) -> Optional[SdsNodeForm]:
        """在产品章节同步区（X.6 起）按模块名查找节点，如「7.9 工作站」。"""
        norm = self._normalize_sds_node_title(module_name or "")
        if not norm:
            return None
        major = self._product_chapter_major(chapter_root)
        exact_best = None
        exact_depth = 999

        def walk(nodes: List[SdsNodeForm], depth: int = 0):
            nonlocal exact_best, exact_depth
            for node in nodes or []:
                title = str(getattr(node, "title", "") or "")
                if self._is_function_stopper_title(title):
                    continue
                if major is not None and depth == 0:
                    minor = self._heading_section_minor(title, major)
                    if minor is not None and minor <= self.FIXED_TEMPLATE_SECTION_MAX:
                        continue
                body_norm = self._normalize_sds_node_title(self._strip_sds_heading_text(title))
                heading = self._parse_sds_node_heading(title)
                heading_depth = len(heading.split(".")) if heading else depth
                if body_norm == norm:
                    if heading_depth < exact_depth:
                        exact_best = node
                        exact_depth = heading_depth
                walk(getattr(node, "children", None) or [], depth + 1)

        walk(getattr(chapter_root, "children", None) or [])
        return exact_best

    def _find_module_node_global(self, roots: List[SdsNodeForm], module_name: str) -> Optional[SdsNodeForm]:
        """在全文档各产品章节中查找模块节点。"""
        best = None
        best_depth = 999
        for root in self._find_design_chapter_roots(roots):
            found = self._find_module_node(root, module_name)
            if not found:
                continue
            heading = self._parse_sds_node_heading(getattr(found, "title", "") or "")
            depth = len(heading.split(".")) if heading else 999
            if best is None or depth < best_depth:
                best = found
                best_depth = depth
        return best

    def _find_direct_product_module_node(
        self, product_root: Optional[SdsNodeForm], module_name: str
    ) -> Optional[SdsNodeForm]:
        norm = self._normalize_sds_node_title(module_name or "")
        if product_root is None or not norm:
            return None
        for child in getattr(product_root, "children", None) or []:
            if self._is_function_stopper_title(getattr(child, "title", "") or ""):
                continue
            child_norm = self._normalize_sds_node_title(
                self._strip_sds_heading_text(getattr(child, "title", "") or "")
            )
            if child_norm == norm and not getattr(child, "sds_code", None):
                return child
        return None

    def _find_module_node_for_req(
        self,
        roots: List[SdsNodeForm],
        module_name: str,
        code: str = None,
        type_code: str = None,
    ) -> Optional[SdsNodeForm]:
        """先按需求编号限定产品章，再找模块，避免「编辑」误命中 RePACS 接口章节。"""
        product_root = self._resolve_product_root_for_req(roots, code or "", module_name, type_code)
        if product_root is not None:
            found = self._find_module_node(product_root, module_name)
            if found is not None:
                return found
        return self._find_module_node_global(roots, module_name)

    def _ensure_module_node(self, roots: List[SdsNodeForm], module_name: str) -> Optional[SdsNodeForm]:
        found = self._find_module_node_global(roots, module_name)
        if found:
            return found
        product_root = self._resolve_product_root(roots, module_name) or self._find_chapter6_root(roots)
        if product_root is None:
            return None
        if product_root.children is None:
            product_root.children = []
        children = list(product_root.children)
        stopper_idx = len(children)
        for idx, child in enumerate(children):
            title = str(getattr(child, "title", "") or "")
            if self._is_function_stopper_title(title):
                stopper_idx = idx
                break
        module_title = str(module_name or "").strip() or "未命名模块"
        new_node = SdsNodeForm(title=module_title, children=[])
        children.insert(stopper_idx, new_node)
        product_root.children = children
        return new_node

    def _ensure_existing_node_in_srs_hierarchy(
        self,
        roots: List[SdsNodeForm],
        existing_node: SdsNodeForm,
        product_root: Optional[SdsNodeForm],
        path_titles: List[str],
    ) -> Optional[SdsNodeForm]:
        """按 SRS 路径（模块→功能→子功能）把节点挂到正确父级下。"""
        path = [str(t or "").strip() for t in (path_titles or []) if str(t or "").strip()]
        if not path or product_root is None or existing_node is None:
            return existing_node
        parent = product_root
        for segment in path[:-1]:
            parent = self._ensure_child_node_by_title(parent, segment)
        target_parent = parent
        parent_map = self._build_node_parent_map(roots)
        current_parent = parent_map.get(id(existing_node))
        if target_parent is existing_node:
            return existing_node
        if self._is_descendant_of(existing_node, target_parent, parent_map):
            return existing_node
        if current_parent is not target_parent:
            self._detach_node(roots, existing_node)
            if target_parent.children is None:
                target_parent.children = []
            if existing_node not in target_parent.children:
                target_parent.children.append(existing_node)
        return existing_node

    def _reparent_misplaced_sync_leaves(
        self,
        roots: List[SdsNodeForm],
        trace_rows,
        hierarchy_map: dict,
        hierarchy_titles_fn,
    ):
        """获取 SRS 追溯后：把 SDS 节点移回 SRS 模块/功能/子功能层级。"""
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        for trace, req in trace_rows or []:
            fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
            type_code = str(getattr(req, "type_code", "") or "").strip()
            code = self._normalize_code(
                getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS")
            )
            if not code:
                continue
            if self._is_algorithm_requirement(req, hierarchy_map):
                continue
            node = self._find_node_by_code_in_tree(roots, code)
            if node is None or self._is_in_fixed_template_zone(roots, node, parent_map, design_roots):
                continue
            product_root = self._resolve_product_root_for_req(
                roots, code, str(fields.get("module") or "").strip(), type_code
            )
            if product_root is None:
                product_root = self._find_product_root_for_node(roots, node, parent_map, design_roots)
            if product_root is None:
                continue
            is_change = self._is_change_requirement(code, type_code)
            hierarchy_path = self._req_hierarchy_path(req, hierarchy_map, is_change, trace_rows)
            if not hierarchy_path:
                continue
            self._ensure_existing_node_in_srs_hierarchy(
                roots, node, product_root, hierarchy_path
            )
            parent_map = self._build_node_parent_map(roots)

    def _sort_product_sync_siblings_by_sds_code(self, product_root: SdsNodeForm):
        """产品章节内：X.1~X.5 固定，X.6 之后各层兄弟节点按 SDS 编号排序，不重排章节号。"""
        major = self._product_chapter_major(product_root)
        root_heading = self._parse_sds_node_heading(getattr(product_root, "title", "") or "")
        if major is None or not root_heading:
            return

        def is_stopper(node: SdsNodeForm) -> bool:
            return self._is_function_stopper_title(getattr(node, "title", "") or "")

        def sort_key(node: SdsNodeForm):
            return self._sds_code_sort_key(self._subtree_min_sds_code(node))

        def sort_children(parent: SdsNodeForm, split_fixed: bool = False):
            children = list(getattr(parent, "children", None) or [])
            if not children:
                return
            if split_fixed:
                fixed_children: List[SdsNodeForm] = []
                sync_children: List[SdsNodeForm] = []
                for child in children:
                    minor = self._heading_section_minor(getattr(child, "title", "") or "", major)
                    if minor is not None and minor <= self.FIXED_TEMPLATE_SECTION_MAX:
                        fixed_children.append(child)
                    else:
                        sync_children.append(child)
                regular = [child for child in sync_children if not is_stopper(child)]
                stoppers = [child for child in sync_children if is_stopper(child)]
                regular.sort(key=sort_key)
                parent.children = fixed_children + regular + stoppers
                ordered = fixed_children + regular + stoppers
            else:
                regular = [child for child in children if not is_stopper(child)]
                stoppers = [child for child in children if is_stopper(child)]
                regular.sort(key=sort_key)
                parent.children = regular + stoppers
                ordered = regular + stoppers
            for child in ordered:
                sort_children(child, False)

        sort_children(product_root, True)

    def _ensure_module_node_in_product(
        self, product_root: Optional[SdsNodeForm], module_name: str
    ) -> Optional[SdsNodeForm]:
        if product_root is None:
            return None
        found = self._find_module_node(product_root, module_name)
        if found:
            return found
        if product_root.children is None:
            product_root.children = []
        children = list(product_root.children)
        stopper_idx = len(children)
        for idx, child in enumerate(children):
            title = str(getattr(child, "title", "") or "")
            if self._is_function_stopper_title(title):
                stopper_idx = idx
                break
        module_title = str(module_name or "").strip() or "未命名模块"
        new_node = SdsNodeForm(title=module_title, children=[])
        children.insert(stopper_idx, new_node)
        product_root.children = children
        return new_node

    @staticmethod
    def _heading_tuple(heading: str) -> tuple:
        try:
            return tuple(int(part) for part in str(heading or "").split(".") if part != "")
        except Exception:
            return (9999,)

    def _find_product_root_by_major(self, roots: List[SdsNodeForm], major: int) -> Optional[SdsNodeForm]:
        for root in self._find_design_chapter_roots(roots):
            if self._product_chapter_major(root) == major:
                return root
        return None

    def _detach_node(self, roots: List[SdsNodeForm], node: SdsNodeForm):
        parent_map = self._build_node_parent_map(roots)
        parent = parent_map.get(id(node))
        if not parent:
            return
        parent.children = [child for child in (getattr(parent, "children", None) or []) if child is not node]

    def _find_node_by_code_in_tree(self, roots: List[SdsNodeForm], code: str) -> Optional[SdsNodeForm]:
        target = re.sub(r"\s+", "", str(code or "").strip().upper())
        if not target:
            return None

        def walk(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                for token in self._extract_node_sds_codes(node):
                    if re.sub(r"\s+", "", token.upper()) == target:
                        return node
                field = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "").strip().upper())
                if field == target:
                    return node
                found = walk(getattr(node, "children", None) or [])
                if found:
                    return found
            return None

        return walk(roots)

    def _find_design_node_by_heading(
        self,
        roots: List[SdsNodeForm],
        heading: str,
        product_root: Optional[SdsNodeForm] = None,
    ) -> Optional[SdsNodeForm]:
        target = str(heading or "").strip().split("\n")[0].strip()
        if not target:
            return None
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        def walk(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                if self._is_in_fixed_template_zone(roots, node, parent_map, design_roots):
                    continue
                if product_root is not None and not self._node_in_product_root(roots, node, product_root):
                    continue
                if self._parse_sds_node_heading(getattr(node, "title", "") or "") == target:
                    return node
                found = walk(getattr(node, "children", None) or [])
                if found:
                    return found
            return None

        return walk(roots or [])

    def _insert_leaf_by_location(
        self,
        roots: List[SdsNodeForm],
        location: str,
        display_title: str,
        code: str,
        design_text: str,
    ) -> Optional[SdsNodeForm]:
        loc = str(location or "").strip().split("\n")[0].strip()
        if not loc or not re.match(r"^\d", loc):
            return None
        try:
            major = int(loc.split(".")[0])
        except Exception:
            return None
        product_root = self._find_product_root_by_major(roots, major)
        if product_root is None:
            return None
        if product_root.children is None:
            product_root.children = []
        children = list(product_root.children)
        stopper_idx = len(children)
        for idx, child in enumerate(children):
            if self._is_function_stopper_title(getattr(child, "title", "") or ""):
                stopper_idx = idx
                break
        body = self._strip_sds_heading_text(display_title) or display_title
        leaf_title = f"{loc} {body}".strip()
        loc_tuple = self._heading_tuple(loc)
        insert_idx = stopper_idx
        for idx, child in enumerate(children[:stopper_idx]):
            child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
            if child_heading and self._heading_tuple(child_heading) < loc_tuple:
                insert_idx = idx + 1
        new_node = SdsNodeForm(title=leaf_title, sds_code=code, text=design_text, children=[])
        children.insert(insert_idx, new_node)
        product_root.children = children
        return new_node

    def _insert_leaf_sibling_after_anchor(
        self,
        roots: List[SdsNodeForm],
        anchor_code: str,
        display_title: str,
        code: str,
        design_text: str,
    ) -> Optional[SdsNodeForm]:
        anchor = self._find_node_by_code_in_tree(roots, anchor_code)
        if anchor is None:
            return None
        parent_map = self._build_node_parent_map(roots)
        parent = parent_map.get(id(anchor))
        if parent is None or self._is_in_fixed_template_zone(roots, parent):
            return None
        children = list(getattr(parent, "children", None) or [])
        try:
            anchor_idx = children.index(anchor)
        except ValueError:
            return None
        anchor_heading = self._parse_sds_node_heading(getattr(anchor, "title", "") or "")
        next_heading = ""
        if anchor_heading:
            parts = anchor_heading.split(".")
            try:
                parts[-1] = str(int(parts[-1]) + 1)
                next_heading = ".".join(parts)
            except Exception:
                next_heading = ""
        body = self._strip_sds_heading_text(display_title) or display_title
        title = f"{next_heading} {body}".strip() if next_heading else body
        new_node = SdsNodeForm(title=title, sds_code=code, text=design_text, children=[])
        children.insert(anchor_idx + 1, new_node)
        parent_heading = self._parse_sds_node_heading(getattr(parent, "title", "") or "")
        if parent_heading:
            parent_depth = len(parent_heading.split("."))
            seq = 0
            for child in children:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                if not child_heading or not child_heading.startswith(parent_heading + "."):
                    continue
                if len(child_heading.split(".")) != parent_depth + 1:
                    continue
                seq += 1
                child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                child.title = f"{parent_heading}.{seq} {child_body}".strip()
        parent.children = children
        return new_node

    def _insert_leaf_in_module(
        self,
        roots: List[SdsNodeForm],
        module_name: str,
        display_title: str,
        code: str,
        design_text: str,
        parent_map: Optional[Dict[int, Optional[SdsNodeForm]]] = None,
        product_root: Optional[SdsNodeForm] = None,
        child_titles: Optional[List[str]] = None,
    ) -> Optional[SdsNodeForm]:
        """Word 导入：在模块节点下追加叶子（模块切换或无模块内前序编号时使用）。"""
        module_node = self._find_module_node(product_root, module_name) if (module_name and product_root) else None
        if module_node is None:
            module_node = self._find_module_node_global(roots, module_name) if module_name else None
        if module_node is None:
            return None
        if parent_map is None:
            parent_map = self._build_node_parent_map(roots)
        if self._is_in_fixed_template_zone(roots, module_node, parent_map):
            return None
        if module_node.children is None:
            module_node.children = []
        if child_titles:
            return self._append_numbered_hierarchy(module_node, child_titles, code, design_text)
        children = list(module_node.children)
        module_heading = self._parse_sds_node_heading(getattr(module_node, "title", "") or "")
        module_depth = len(module_heading.split(".")) if module_heading else 0
        insert_idx = len(children)
        target_key = self._sds_code_sort_key(code)
        direct_children: List[SdsNodeForm] = []
        for idx, child in enumerate(children):
            child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
            if not child_heading or not module_heading:
                continue
            if not child_heading.startswith(module_heading + "."):
                continue
            parts = child_heading.split(".")
            if len(parts) != module_depth + 1:
                continue
            direct_children.append(child)
            child_code = re.sub(r"\s+", "", str(getattr(child, "sds_code", "") or "").strip().upper())
            if child_code and self._sds_code_sort_key(child_code) > target_key and insert_idx == len(children):
                insert_idx = idx
        body = self._strip_sds_heading_text(display_title) or display_title
        body_norm = self._normalize_sds_node_title(body)
        for child in children:
            child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
            if self._normalize_sds_node_title(child_body) != body_norm:
                continue
            child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
            if module_heading:
                parts = child_heading.split(".") if child_heading else []
                if parts and len(parts) != module_depth + 1:
                    continue
            existing_code = re.sub(r"\s+", "", str(getattr(child, "sds_code", "") or "").strip().upper())
            if existing_code and existing_code != re.sub(r"\s+", "", str(code or "").strip().upper()):
                continue
            child.sds_code = code
            if not (getattr(child, "text", "") or "").strip():
                child.text = design_text
            return child
        title = body
        new_node = SdsNodeForm(title=title, sds_code=code, text=design_text, children=[])
        children.insert(insert_idx, new_node)
        if module_heading:
            seq = 0
            for child in children:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                is_direct = child is new_node
                if child_heading and child_heading.startswith(module_heading + "."):
                    parts = child_heading.split(".")
                    is_direct = len(parts) == module_depth + 1
                if not is_direct:
                    continue
                seq += 1
                child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                child.title = f"{module_heading}.{seq} {child_body}".strip()
        module_node.children = children
        return new_node

    def _insert_leaf_in_product_module_before_stopper(
        self,
        product_root: Optional[SdsNodeForm],
        module_name: str,
        display_title: str,
        code: str,
        design_text: str,
        child_titles: Optional[List[str]] = None,
    ) -> Optional[SdsNodeForm]:
        """将变更需求按 模块 -> 功能 层级插在产品章限制条件前。"""
        if product_root is None:
            return None
        if product_root.children is None:
            product_root.children = []

        module_norm = self._normalize_sds_node_title(module_name or "")
        module_node = None
        if module_norm:
            for child in getattr(product_root, "children", None) or []:
                child_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(child, "title", "") or "")
                )
                if child_norm == module_norm and not getattr(child, "sds_code", None):
                    module_node = child
                    break
        if module_node is None:
            children = list(product_root.children)
            insert_idx = len(children)
            for idx, child in enumerate(children):
                if self._is_function_stopper_title(getattr(child, "title", "") or ""):
                    insert_idx = idx
                    break
            module_node = SdsNodeForm(title=str(module_name or "").strip() or "未命名模块", children=[])
            children.insert(insert_idx, module_node)
            product_root.children = children

            root_heading = self._parse_sds_node_heading(getattr(product_root, "title", "") or "")
            if root_heading:
                root_depth = len(root_heading.split("."))
                prev_seq = 0
                for child in children[:insert_idx]:
                    child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                    if not child_heading or not child_heading.startswith(root_heading + "."):
                        continue
                    parts = child_heading.split(".")
                    if len(parts) != root_depth + 1:
                        continue
                    try:
                        prev_seq = max(prev_seq, int(parts[-1]))
                    except Exception:
                        continue
                seq = prev_seq
                for child in children[insert_idx:]:
                    child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                    is_direct = child is module_node
                    if child_heading and child_heading.startswith(root_heading + "."):
                        is_direct = len(child_heading.split(".")) == root_depth + 1
                    if not is_direct:
                        continue
                    seq += 1
                    child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                    child.title = f"{root_heading}.{seq} {child_body}".strip()

        if module_node.children is None:
            module_node.children = []
        if child_titles:
            return self._append_numbered_hierarchy(module_node, child_titles, code, design_text)
        children = list(module_node.children)
        module_heading = self._parse_sds_node_heading(getattr(module_node, "title", "") or "")
        target_key = self._sds_code_sort_key(code)
        insert_idx = len(children)
        for idx, child in enumerate(children):
            child_code = re.sub(r"\s+", "", str(getattr(child, "sds_code", "") or "").strip().upper())
            if child_code and self._sds_code_sort_key(child_code) > target_key:
                insert_idx = idx
                break
        body = self._strip_sds_heading_text(display_title) or display_title
        new_node = SdsNodeForm(title=body, sds_code=code, text=design_text, children=[])
        children.insert(insert_idx, new_node)
        if module_heading:
            seq = 0
            for child in children:
                seq += 1
                child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                child.title = f"{module_heading}.{seq} {child_body}".strip()
        module_node.children = children
        return new_node

    def _remove_unheaded_nodes_by_code_title(
        self,
        nodes: List[SdsNodeForm],
        codes: set,
        titles: set,
    ) -> List[SdsNodeForm]:
        """清理由同步误建的无章节号固定追溯节点，如 300-007「图像显示」。"""
        cleaned = []
        norm_titles = {self._normalize_sds_node_title(title) for title in titles}
        norm_codes = {re.sub(r"\s+", "", str(code or "").upper()) for code in codes}
        for node in nodes or []:
            node_codes = {
                re.sub(r"\s+", "", str(code or "").upper())
                for code in self._extract_node_sds_codes(node)
            }
            field_code = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "").upper())
            if field_code:
                node_codes.add(field_code)
            title_norm = self._normalize_sds_node_title(getattr(node, "title", "") or "")
            body_norm = self._normalize_sds_node_title(
                self._strip_sds_heading_text(getattr(node, "title", "") or "")
            )
            should_remove = (
                not self._parse_sds_node_heading(getattr(node, "title", "") or "")
                and (
                    (bool(node_codes & norm_codes) and body_norm in norm_titles)
                    or body_norm in norm_titles
                )
            )
            if should_remove:
                continue
            node.children = self._remove_unheaded_nodes_by_code_title(
                getattr(node, "children", None) or [], norm_codes, norm_titles
            )
            cleaned.append(node)
        return cleaned

    def _relocate_unheaded_rcn301_modules(self, roots: List[SdsNodeForm]):
        """Word 导入：把无章节号的 301 新增模块按 SDS 编号移动到前序功能后。"""
        parent_map = self._build_node_parent_map(roots)

        def walk(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                yield node
                yield from walk(getattr(node, "children", None) or [])

        all_nodes = list(walk(roots or []))
        for product_root in self._find_design_chapter_roots(roots):
            product_heading = self._parse_sds_node_heading(getattr(product_root, "title", "") or "")
            if not product_heading:
                continue
            for module_node in list(getattr(product_root, "children", None) or []):
                title = getattr(module_node, "title", "") or ""
                if self._parse_sds_node_heading(title) or self._is_function_stopper_title(title):
                    continue
                module_codes = [
                    code
                    for node in walk([module_node])
                    for code in self._extract_node_sds_codes(node)
                    if self._rcn_series_num(code) == 301
                ]
                if not module_codes:
                    continue
                target_code = min(module_codes, key=self._sds_code_sort_key)
                target_key = self._sds_code_sort_key(target_code)
                anchor = None
                anchor_key = None
                for node in all_nodes:
                    if node is module_node or self._is_descendant_of(module_node, node, parent_map):
                        continue
                    if not self._node_in_product_root(roots, node, product_root):
                        continue
                    for code in self._extract_node_sds_codes(node):
                        if self._rcn_series_num(code) != 301:
                            continue
                        key = self._sds_code_sort_key(code)
                        if key >= target_key:
                            continue
                        if anchor_key is None or key > anchor_key:
                            anchor = node
                            anchor_key = key
                anchor_parent = parent_map.get(id(anchor)) if anchor is not None else None
                anchor_parent_heading = (
                    self._parse_sds_node_heading(getattr(anchor_parent, "title", "") or "")
                    if anchor_parent is not None else ""
                )
                if anchor is None or anchor_parent is None or not anchor_parent_heading or anchor_parent is product_root:
                    continue
                self._detach_node(roots, module_node)
                siblings = list(getattr(anchor_parent, "children", None) or [])
                try:
                    insert_idx = siblings.index(anchor) + 1
                except ValueError:
                    continue
                siblings.insert(insert_idx, module_node)
                parent_depth = len(anchor_parent_heading.split("."))
                seq = 0
                for child in siblings:
                    child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                    is_direct = child is module_node
                    if child_heading and child_heading.startswith(anchor_parent_heading + "."):
                        is_direct = len(child_heading.split(".")) == parent_depth + 1
                    if not is_direct:
                        continue
                    seq += 1
                    body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                    child.title = f"{anchor_parent_heading}.{seq} {body}".strip()
                module_heading = self._parse_sds_node_heading(getattr(module_node, "title", "") or "")
                if module_heading:
                    child_seq = 0
                    for child in getattr(module_node, "children", None) or []:
                        child_seq += 1
                        body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                        child.title = f"{module_heading}.{child_seq} {body}".strip()
                anchor_parent.children = siblings
                parent_map = self._build_node_parent_map(roots)
                all_nodes = list(walk(roots or []))

    def _is_product_chapter_root(self, roots: List[SdsNodeForm], node: SdsNodeForm) -> bool:
        if node is None:
            return False
        return node in self._find_design_chapter_roots(roots)

    async def _sync_missing_design_nodes_from_srs(self, doc_id: int, roots: List[SdsNodeForm]) -> List[SdsNodeForm]:
        """获取SRS追溯 / 页面加载：在各产品章节 X.6 同步区按 SDS 编号查找并生成功能章节；X.1~X.5 固定不动。"""
        if not self._find_design_chapter_roots(roots) and self._find_chapter6_root(roots) is None:
            return roots

        sds_doc = db.session.execute(select(SdsDoc).where(SdsDoc.id == doc_id)).scalars().first()
        hierarchy_map = _trace_load_srs_req_hierarchy_map(getattr(sds_doc, "srsdoc_id", None) or 0)
        trace_rows = db.session.execute(
            select(SdsTrace, SrsReq)
            .join(SrsReq, SrsReq.id == SdsTrace.req_id)
            .where(SdsTrace.doc_id == doc_id)
            .where(SrsReq.type_code != "reqd")
        ).all()
        trace_rows = sorted(
            trace_rows,
            key=lambda item: self._sds_code_sort_key(
                getattr(item[0], "sds_code", "") or str(getattr(item[1], "code", "") or "").replace("SRS", "SDS")
            ),
        )
        if not trace_rows:
            return self._prune_design_nodes_not_in_trace(roots, set())

        word_imported = self._is_word_imported_doc(roots)
        if word_imported:
            self._bind_word_leaf_codes_from_srs(roots, doc_id)

        srs_codes = list({
            str(getattr(req, "code", "") or "").strip()
            for _trace, req in trace_rows
            if str(getattr(req, "code", "") or "").strip()
        })
        reqd_by_srs_code: Dict[str, SrsReqd] = {}
        reqd_by_req_id: Dict[int, SrsReqd] = {}
        trace_req_ids = [getattr(req, "id", None) for _trace, req in trace_rows if getattr(req, "id", None)]
        if srs_codes or trace_req_ids:
            reqd_query = (
                select(SrsReqd, SrsReq)
                .join(SrsReq, SrsReq.id == SrsReqd.req_id)
                .where(SrsReq.doc_id == getattr(sds_doc, "srsdoc_id", None))
            )
            if srs_codes and trace_req_ids:
                reqd_query = reqd_query.where(
                    (SrsReq.code.in_(srs_codes)) | (SrsReq.id.in_(trace_req_ids))
                )
            elif srs_codes:
                reqd_query = reqd_query.where(SrsReq.code.in_(srs_codes))
            else:
                reqd_query = reqd_query.where(SrsReq.id.in_(trace_req_ids))
            reqd_rows = db.session.execute(reqd_query).all()
            for reqd_row, req_row in reqd_rows:
                code = str(getattr(req_row, "code", "") or "").strip()
                if code and code not in reqd_by_srs_code:
                    reqd_by_srs_code[code] = reqd_row
                rid = getattr(req_row, "id", None)
                if rid is not None and rid not in reqd_by_req_id:
                    reqd_by_req_id[rid] = reqd_row

        def normalize_code(value: str) -> str:
            return re.sub(r"\s+", "", str(value or "").strip().upper())

        def build_design_text(srs_code: str, req_id: Optional[int] = None, req_row: Optional[SrsReq] = None):
            if req_row is None and req_id is not None:
                req_row = next(
                    (item[1] for item in trace_rows if getattr(item[1], "id", None) == req_id),
                    None,
                )
            return self._compose_design_text_for_trace_sync(
                req_row, srs_code, req_id, reqd_by_srs_code, reqd_by_req_id, hierarchy_map, trace_rows
            )

        def hierarchy_titles(req_row: SrsReq, module_name: str = None, include_module: bool = False) -> List[str]:
            fields = sdstrace_serv.hierarchy_for_req(req_row, hierarchy_map)
            mod = str(fields.get("module") or "").strip()
            fn = str(fields.get("function") or "").strip()
            sub = str(fields.get("sub_function") or "").strip()
            titles = []
            seen = set()
            mod_norm = self._normalize_sds_node_title(mod)
            module_norm = self._normalize_sds_node_title(module_name or mod)
            skip_module = (
                not include_module
                and module_name
                and mod_norm
                and (mod_norm == module_norm or mod_norm in module_norm or module_norm in mod_norm)
            )
            for val in ([mod] if mod and not skip_module else []) + [fn, sub]:
                txt = str(val or "").strip()
                if not txt or txt in ("/", "-", "\\"):
                    continue
                norm = self._normalize_sds_node_title(txt)
                if norm and norm not in seen:
                    seen.add(norm)
                    titles.append(txt)
            if not titles:
                leaf = sdstrace_serv.compose_srs_req_chapter(req_row, hierarchy_map=hierarchy_map, **fields)
                if leaf:
                    titles.append(leaf)
            return titles

        algorithm_req_titles = self._algorithm_req_title_norms()

        def is_algorithm_requirement(req_row: SrsReq, fields: dict = None) -> bool:
            return self._is_algorithm_requirement(req_row, hierarchy_map)

        def trace_sds_codes(trace: SdsTrace, req_row: SrsReq) -> List[str]:
            raw_code = getattr(trace, "sds_code", "") or str(getattr(req_row, "code", "") or "").replace("SRS", "SDS")
            return [
                normalize_code(token)
                for token in re.split(r"[\r\n,，;；]+", str(raw_code or ""))
                if normalize_code(token)
            ]

        active_trace_codes = {
            code
            for trace, req in trace_rows
            for code in trace_sds_codes(trace, req)
        }
        roots = self._prune_design_nodes_not_in_trace(roots, active_trace_codes)

        algorithm_codes = {
            code
            for trace, req in trace_rows
            if is_algorithm_requirement(req)
            for code in trace_sds_codes(trace, req)
        }

        def prune_algorithm_generated_nodes(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
            if not algorithm_codes:
                return nodes

            def subtree_codes(node: SdsNodeForm) -> set:
                codes = set(self._extract_node_sds_codes(node))
                for child in getattr(node, "children", None) or []:
                    codes.update(subtree_codes(child))
                return codes

            cleaned = []
            for node in nodes or []:
                title_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(node, "title", "") or "")
                )
                codes = subtree_codes(node)
                if title_norm in algorithm_req_titles and bool(codes & algorithm_codes):
                    continue
                node.children = prune_algorithm_generated_nodes(getattr(node, "children", None) or [])
                cleaned.append(node)
            return cleaned

        roots = prune_algorithm_generated_nodes(roots)
        if algorithm_codes:
            def replace_heading_prefix(node: SdsNodeForm, old_prefix: str, new_prefix: str):
                for child in getattr(node, "children", None) or []:
                    heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                    if heading and (heading == old_prefix or heading.startswith(old_prefix + ".")):
                        body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                        new_heading = new_prefix + heading[len(old_prefix):]
                        child.title = f"{new_heading} {body}".strip()
                    replace_heading_prefix(child, old_prefix, new_prefix)

            def renumber_product_direct_children(product_root: SdsNodeForm):
                root_heading = self._parse_sds_node_heading(getattr(product_root, "title", "") or "")
                if not root_heading:
                    return
                root_depth = len(root_heading.split("."))
                seq = 0
                for child in getattr(product_root, "children", None) or []:
                    child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                    if not child_heading or not child_heading.startswith(root_heading + "."):
                        continue
                    if len(child_heading.split(".")) != root_depth + 1:
                        continue
                    seq += 1
                    new_heading = f"{root_heading}.{seq}"
                    if child_heading == new_heading:
                        continue
                    body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                    child.title = f"{new_heading} {body}".strip()
                    replace_heading_prefix(child, child_heading, new_heading)

            for product_root in self._find_design_chapter_roots(roots):
                renumber_product_direct_children(product_root)

        def append_hierarchy(level_nodes: List[SdsNodeForm], titles: List[str], code: str, design_text: str):
            for idx, title in enumerate(titles):
                is_leaf = idx == len(titles) - 1
                norm = self._normalize_sds_node_title(title)
                target = None
                if is_leaf:
                    for candidate in level_nodes:
                        if self._normalize_sds_node_title(getattr(candidate, "title", "") or "") != norm:
                            continue
                        existing_code = normalize_code(getattr(candidate, "sds_code", "") or "")
                        if not existing_code:
                            for item_code in self._extract_node_sds_codes(candidate):
                                existing_code = item_code
                                break
                        if not existing_code or existing_code == code:
                            target = candidate
                            break
                else:
                    target = next(
                        (n for n in level_nodes if self._normalize_sds_node_title(getattr(n, "title", "") or "") == norm),
                        None,
                    )
                if target is None:
                    target = SdsNodeForm(
                        title=title,
                        sds_code=code if is_leaf else None,
                        text=design_text if is_leaf else "",
                        children=[],
                    )
                    level_nodes.append(target)
                elif is_leaf:
                    if not getattr(target, "sds_code", None):
                        target.sds_code = code
                    if design_text and (
                        not (getattr(target, "text", "") or "").strip()
                        or not self._node_text_matches_req(target, design_text)
                    ):
                        target.text = design_text
                if target.children is None:
                    target.children = []
                level_nodes = target.children

        by_code, by_title = self._collect_design_req_index(roots)
        location_map = sdstrace_serv.build_sync_location_map(doc_id, roots)
        touched_modules: List[SdsNodeForm] = []
        ordered_codes: List[str] = []
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)
        by_req_id: Dict[int, SdsNodeForm] = {}
        self._bootstrap_by_req_id_by_content(
            trace_rows, roots, reqd_by_req_id, hierarchy_map, by_req_id
        )
        for _bootstrap_trace, _bootstrap_req in trace_rows:
            req_id = getattr(_bootstrap_req, "id", None)
            if req_id is None or req_id in by_req_id:
                continue
            bootstrap_fields = sdstrace_serv.hierarchy_for_req(_bootstrap_req, hierarchy_map)
            if is_algorithm_requirement(_bootstrap_req, bootstrap_fields):
                continue
            bootstrap_module = str(bootstrap_fields.get("module") or "").strip()
            bootstrap_type = str(getattr(_bootstrap_req, "type_code", "") or "").strip()
            bootstrap_code = normalize_code(
                str(getattr(_bootstrap_req, "code", "") or "").replace("SRS", "SDS")
            )
            bootstrap_product = self._resolve_product_root_for_req(
                roots, bootstrap_code, bootstrap_module, bootstrap_type
            )
            bootstrap_text = build_design_text(
                getattr(_bootstrap_req, "code", "") or "", req_id
            )
            saved_loc = (getattr(_bootstrap_trace, "location", "") or "").strip().split("\n")[0].strip()
            if saved_loc and not self._is_valid_sync_location_for_req(
                saved_loc, bootstrap_code, bootstrap_type
            ):
                saved_loc = ""
            candidate = None
            if saved_loc:
                candidate = self._find_design_node_by_heading(roots, saved_loc, bootstrap_product)
            if candidate is not None and self._trace_can_reuse_node(
                _bootstrap_trace,
                _bootstrap_req,
                candidate,
                hierarchy_map,
                bootstrap_module,
                bootstrap_text,
                roots,
                bootstrap_product,
                None,
                by_req_id,
                trace_rows,
            ):
                by_req_id[req_id] = candidate

        def register_code_node(code: str, node: SdsNodeForm):
            if not code or not node:
                return
            by_code[code] = node
            title_norm = self._normalize_sds_node_title(getattr(node, "title", "") or "")
            if title_norm:
                by_title[title_norm] = node

        def prev_code_with_node(current_code: str, product_root: Optional[SdsNodeForm] = None) -> Optional[str]:
            prev = None
            for item_code in ordered_codes:
                if item_code == current_code:
                    break
                node = by_code.get(item_code)
                if not node:
                    continue
                if product_root is not None and not self._node_in_product_root(roots, node, product_root):
                    continue
                prev = item_code
            return prev

        def prev_code_in_doc(current_code: str) -> Optional[str]:
            return prev_code_with_node(current_code, None)

        def prev_existing_code_by_sds_sort(
            current_code: str, product_root: Optional[SdsNodeForm] = None
        ) -> Optional[str]:
            current_key = self._sds_code_sort_key(current_code)
            prev = None
            prev_key = None
            for item_code, node in by_code.items():
                if item_code == current_code or not node:
                    continue
                if product_root is not None and not self._node_in_product_root(roots, node, product_root):
                    continue
                item_key = self._sds_code_sort_key(item_code)
                if item_key >= current_key:
                    continue
                if prev_key is None or item_key > prev_key:
                    prev = item_code
                    prev_key = item_key
            return prev

        def cleanup_unmatched_generated_leaves(items: List[SdsNodeForm]) -> List[SdsNodeForm]:
            active_titles = set()
            for trace, req in trace_rows:
                code = normalize_code(
                    getattr(trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS")
                )
                type_code = str(getattr(req, "type_code", "") or "").strip()
                is_change = self._is_change_requirement(code, type_code)
                for title in self._req_hierarchy_path(req, hierarchy_map, is_change, trace_rows):
                    norm = self._normalize_sds_node_title(title or "")
                    if norm:
                        active_titles.add(norm)

            parent_map = self._build_node_parent_map(items)
            design_roots = self._find_design_chapter_roots(items)

            def clean(nodes: List[SdsNodeForm]) -> List[SdsNodeForm]:
                kept = []
                for node in nodes or []:
                    node.children = clean(getattr(node, "children", None) or [])
                    codes = self._extract_node_sds_codes(node)
                    body_norm = self._normalize_sds_node_title(
                        self._strip_sds_heading_text(getattr(node, "title", "") or "")
                    )
                    has_image = bool(str(getattr(node, "img_url", "") or "").strip())
                    is_empty_leaf = not codes and not getattr(node, "children", None) and not has_image
                    if (
                        is_empty_leaf
                        and self._is_product_sync_area_node(items, node, parent_map, design_roots)
                        and body_norm
                        and body_norm not in active_titles
                    ):
                        continue
                    kept.append(node)
                return kept

            return clean(items or [])

        for _trace, req in trace_rows:
            desired_code = normalize_code(str(getattr(req, "code", "") or "").replace("SRS", "SDS"))
            old_codes = [
                normalize_code(token)
                for token in re.split(r"[\r\n,，;；]+", str(getattr(_trace, "sds_code", "") or ""))
                if normalize_code(token)
            ]
            candidate_codes = [desired_code, *[item for item in old_codes if item != desired_code]]
            for code in [desired_code] if desired_code else candidate_codes[:1]:
                if not code:
                    continue
                if code not in ordered_codes:
                    ordered_codes.append(code)
                fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
                if is_algorithm_requirement(req, fields):
                    continue
                raw_module = str(fields.get("module") or "").strip()
                module_name = self._sync_module_name_from_fields(fields)
                type_code = str(getattr(req, "type_code", "") or "").strip()
                series_num = self._rcn_series_num(code)
                is_change_req = self._is_change_requirement(code, type_code)
                if is_change_req and not module_name:
                    module_name = str(fields.get("function") or "").strip()
                if word_imported:
                    target_product = self._resolve_product_root_for_req(roots, code, module_name, type_code)
                    module_anchor = (
                        self._find_module_node(target_product, module_name)
                        if target_product is not None and module_name else None
                    )
                    if module_anchor is None and module_name:
                        module_anchor = self._find_module_node_for_req(roots, module_name, code, type_code)
                    if target_product is None and module_anchor is not None:
                        target_product = self._find_product_root_for_node(roots, module_anchor, parent_map, design_roots)
                else:
                    target_product = self._resolve_product_root_for_req(roots, code, module_name, type_code)
                child_titles = hierarchy_titles(req, module_name=module_name)
                raw_child_titles = self._raw_hierarchy_titles(req, hierarchy_map)
                hierarchy_path = self._req_hierarchy_path(req, hierarchy_map, is_change_req, trace_rows)
                display_title = hierarchy_path[-1] if hierarchy_path else self._effective_display_title(
                    req, hierarchy_map, raw_child_titles
                )
                sync_path_titles = hierarchy_path
                title_norm = self._normalize_sds_node_title(display_title)
                design_text = ""
                def ensure_design_text() -> str:
                    nonlocal design_text
                    if not design_text:
                        design_text = build_design_text(
                            getattr(req, "code", "") or "", getattr(req, "id", None)
                        )
                    return design_text
                location = location_map.get(code) or ""
                if location and not self._is_valid_sync_location_for_req(location, code, type_code):
                    location = ""
                if not location and is_change_req:
                    trace_loc = (getattr(_trace, "location", "") or "").strip().split("\n")[0].strip()
                    if trace_loc and self._is_valid_sync_location_for_req(trace_loc, code, type_code):
                        location = trace_loc

                saved_location = (getattr(_trace, "location", "") or "").strip().split("\n")[0].strip()
                if saved_location and not self._is_valid_sync_location_for_req(saved_location, code, type_code):
                    saved_location = ""
                req_bound = by_req_id.get(getattr(req, "id", None))
                existing = self._resolve_existing_node_for_trace(
                    _trace,
                    req,
                    code,
                    candidate_codes,
                    by_code,
                    by_req_id,
                    saved_location,
                    hierarchy_map,
                    module_name,
                    ensure_design_text(),
                    roots,
                    target_product,
                    word_imported,
                    trace_rows,
                )
                if (
                    existing is not None
                    and not is_change_req
                    and self._standard_leaf_after_container_strip(raw_child_titles, is_change_req, req, hierarchy_map)
                ):
                    prev_code = prev_existing_code_by_sds_sort(code, target_product)
                    prev_node = self._find_node_by_code_in_tree(roots, prev_code) if prev_code else None
                    if prev_node is not None:
                        prev_parent = parent_map.get(id(prev_node))
                        exist_parent = parent_map.get(id(existing))
                        if prev_parent is not None and exist_parent is not prev_parent:
                            self._detach_node(roots, existing)
                            by_code.pop(code, None)
                            existing = self._insert_leaf_sibling_after_anchor(
                                roots, prev_code, display_title, code, ensure_design_text()
                            )
                            if existing is not None:
                                by_req_id[req.id] = existing
                                register_code_node(code, existing)
                                parent_map = self._build_node_parent_map(roots)
                                continue
                            existing = None
                wrong_existing = None
                if existing is not None:
                    existing_heading = self._parse_sds_node_heading(getattr(existing, "title", "") or "")
                    if word_imported and not existing_heading:
                        existing_parent = parent_map.get(id(existing))
                        existing_parent_heading = self._parse_sds_node_heading(
                            getattr(existing_parent, "title", "") or ""
                        ) if existing_parent is not None else ""
                        if not existing_parent_heading:
                            by_code.pop(code, None)
                            existing = None
                if (
                    existing is not None
                    and target_product
                    and not self._node_in_product_root(roots, existing, target_product)
                ):
                    wrong_existing = existing
                    self._detach_node(roots, existing)
                    by_code.pop(code, None)
                    existing = None
                if existing is not None and module_name and not is_change_req and target_product is not None:
                    module_node_check = None
                    if hierarchy_path and len(hierarchy_path) > 1:
                        module_node_check = self._ensure_child_node_by_title(target_product, hierarchy_path[0])
                    if module_node_check is not None and not self._is_descendant_of(
                        module_node_check, existing, parent_map
                    ):
                        existing = self._ensure_existing_node_in_srs_hierarchy(
                                roots, existing, target_product, hierarchy_path
                        )
                        parent_map = self._build_node_parent_map(roots)
                if existing is not None and word_imported and code in fixed_rcn300_sds_codes():
                    if not self._parse_sds_node_heading(getattr(existing, "title", "") or ""):
                        self._detach_node(roots, existing)
                        by_code.pop(code, None)
                        existing = None
                if existing is None and title_norm and word_imported:
                    module_node = self._find_module_node_for_req(roots, module_name, code, type_code) if module_name else None
                    title_candidate = by_title.get(title_norm)
                    if title_candidate is not None and (
                        module_node is None
                        or self._is_descendant_of(module_node, title_candidate, parent_map)
                    ) and self._trace_can_reuse_node(
                        _trace, req, title_candidate, hierarchy_map, module_name,
                        ensure_design_text(), roots, target_product, req_bound, by_req_id, trace_rows,
                    ):
                        existing = title_candidate
                if existing is not None and self._is_product_chapter_root(roots, existing):
                    root_title = self._normalize_sds_node_title(
                        self._strip_sds_heading_text(getattr(existing, "title", "") or "")
                    )
                    if title_norm and title_norm != root_title:
                        existing = None
                if existing is not None and self._is_in_fixed_template_zone(roots, existing, parent_map, design_roots):
                    existing = None
                if existing is not None and self._rcn_series_num(code) == 307:
                    self._detach_node(roots, existing)
                    by_code.pop(code, None)
                    existing = None
                if existing is not None and location and is_change_req:
                    existing_heading = self._parse_sds_node_heading(getattr(existing, "title", "") or "")
                    if existing_heading != location:
                        self._detach_node(roots, existing)
                        existing = None
                if existing is not None and word_imported and len(child_titles) > 1:
                    expected_parent = self._normalize_sds_node_title(child_titles[-2])
                    existing_parent = parent_map.get(id(existing))
                    existing_parent_title = self._strip_sds_heading_text(
                        getattr(existing_parent, "title", "") or ""
                    ) if existing_parent is not None else ""
                    existing_parent_norm = self._normalize_sds_node_title(existing_parent_title)
                    if expected_parent and existing_parent_norm != expected_parent:
                        self._detach_node(roots, existing)
                        by_code.pop(code, None)
                        existing = None
                if existing is not None and not self._node_matches_req_hierarchy(
                    existing, req, hierarchy_map, module_name
                ):
                    self._try_rename_module_title_to_function(
                        existing, req, hierarchy_map, module_name, display_title
                    )
                if existing is not None:
                    promoted = self._promote_function_chapter_over_module_header(
                        roots, existing, module_name, display_title, code, ensure_design_text()
                    )
                    if promoted is not None and promoted is not existing:
                        by_code.pop(code, None)
                        existing = promoted
                        register_code_node(code, existing)
                        # 同步绑定到提升后的节点，使后续 can_reuse 命中 req_id 绑定、保留内容
                        _promoted_rid = getattr(req, "id", None)
                        if _promoted_rid is not None:
                            by_req_id[_promoted_rid] = existing
                        parent_map = self._build_node_parent_map(roots)
                skip_module_nest = len(hierarchy_path or []) == 1
                if existing is not None and not self._trace_can_reuse_node(
                    _trace,
                    req,
                    existing,
                    hierarchy_map,
                    module_name,
                    ensure_design_text(),
                    roots,
                    target_product,
                    req_bound,
                    by_req_id,
                    trace_rows,
                ):
                    self._release_node_sds_code(existing, code, by_code, candidate_codes)
                    _trace.location = None
                    existing = None
                prev_sds_code = prev_existing_code_by_sds_sort(code, target_product)
                if (
                    not word_imported
                    and existing is not None
                    and prev_sds_code
                    and self._is_misplaced_after_prev_sds(existing, code, prev_sds_code, by_code)
                ):
                    self._detach_node(roots, existing)
                    self._release_node_sds_code(existing, code, by_code, candidate_codes)
                    _trace.location = None
                    existing = None
                if (
                    existing is not None
                    and target_product is not None
                    and module_name
                    and child_titles
                    and not skip_module_nest
                ):
                    existing_parent = parent_map.get(id(existing))
                    if existing_parent is target_product:
                        self._release_node_sds_code(existing, code, by_code, candidate_codes)
                        existing = None
                if existing is not None and target_product is not None and hierarchy_path:
                    existing = self._ensure_existing_node_in_srs_hierarchy(
                        roots, existing, target_product, hierarchy_path
                    )
                    parent_map = self._build_node_parent_map(roots)
                    existing.sds_code = code
                    _trace.sds_code = code
                    self._ensure_leaf_title(existing, display_title)
                    body = self._strip_sds_heading_text(getattr(existing, "title", "") or "") or display_title
                    if display_title and self._normalize_sds_node_title(body) != self._normalize_sds_node_title(display_title):
                        heading = self._parse_sds_node_heading(getattr(existing, "title", "") or "")
                        existing.title = f"{heading} {display_title}".strip() if heading else display_title
                    existing_heading = self._parse_sds_node_heading(getattr(existing, "title", "") or "")
                    existing_code = re.sub(
                        r"\s+", "", str(getattr(existing, "sds_code", "") or "").strip().upper()
                    )
                    if existing_code == code and existing_heading and self._rcn_series_num(code) != 307:
                        self._sync_design_text_to_node(
                            existing, ensure_design_text(), req, hierarchy_map, module_name, by_req_id, trace_rows
                        )
                        by_req_id[req.id] = existing
                        register_code_node(code, existing)
                        continue
                if existing is not None:
                    self._ensure_leaf_title(existing, display_title)
                    self._sync_design_text_to_node(
                        existing, ensure_design_text(), req, hierarchy_map, module_name, by_req_id, trace_rows
                    )
                    if location and is_change_req and not self._parse_sds_node_heading(getattr(existing, "title", "") or ""):
                        body = self._strip_sds_heading_text(getattr(existing, "title", "") or "") or display_title
                        existing.title = f"{location} {body}".strip()
                    if wrong_existing is not None:
                        self._detach_node(roots, wrong_existing)
                    by_req_id[req.id] = existing
                    register_code_node(code, existing)
                    continue

                placed_node = None
                if not is_change_req:
                    placed_node = self._find_word_leaf_for_req(
                        roots, req, hierarchy_map, code, module_name=module_name
                    )
                    if placed_node is not None:
                        placed_node.sds_code = code
                        self._ensure_leaf_title(placed_node, display_title)
                        self._sync_design_text_to_node(
                            placed_node, ensure_design_text(), req, hierarchy_map, module_name, by_req_id, trace_rows
                        )
                if placed_node is None and target_product and hierarchy_path:
                    placed_node = self._place_leaf_at_hierarchy_path(
                        roots, target_product, hierarchy_path, code, ensure_design_text()
                    )
                    if placed_node is not None:
                        self._ensure_leaf_title(placed_node, display_title)
                        placed_node = self._ensure_existing_node_in_srs_hierarchy(
                            roots, placed_node, target_product, hierarchy_path
                        )
                if placed_node is None and is_change_req and target_product and hierarchy_path:
                    placed_node = self._place_leaf_at_hierarchy_path(
                        roots, target_product, hierarchy_path, code, ensure_design_text()
                    )
                    if placed_node is not None:
                        placed_node = self._ensure_existing_node_in_srs_hierarchy(
                            roots, placed_node, target_product, hierarchy_path
                    )
                if placed_node is not None:
                    if wrong_existing is not None:
                        self._detach_node(roots, wrong_existing)
                    by_req_id[req.id] = placed_node
                    register_code_node(code, placed_node)
                    continue

                if code in fixed_rcn300_sds_codes() and placed_node is None:
                    continue

                if word_imported:
                    continue

                if target_product and hierarchy_path:
                    leaf = self._place_leaf_at_hierarchy_path(
                        roots, target_product, hierarchy_path, code, ensure_design_text()
                    )
                    if leaf is not None:
                        leaf = self._ensure_existing_node_in_srs_hierarchy(
                            roots, leaf, target_product, hierarchy_path
                        )
                by_req_id[req.id] = leaf
                register_code_node(code, leaf)

        by_code, by_title = self._collect_design_req_index(roots)
        for _trace, req in trace_rows:
            raw_code = getattr(_trace, "sds_code", "") or str(getattr(req, "code", "") or "").replace("SRS", "SDS")
            for code_token in re.split(r"[\r\n,，;；]+", str(raw_code)):
                code = normalize_code(code_token)
                if not code or code in by_code or code in fixed_rcn300_sds_codes():
                    continue
                fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
                if is_algorithm_requirement(req, fields):
                    continue
                raw_module = str(fields.get("module") or "").strip()
                module_name = self._sync_module_name_from_fields(fields)
                if not module_name:
                    continue
                type_code = str(getattr(req, "type_code", "") or "").strip()
                series_num = self._rcn_series_num(code)
                is_change_req = self._is_change_requirement(code, type_code)
                if is_change_req and series_num not in (301, 307, 308):
                    continue
                target_product = self._resolve_product_root_for_req(roots, code, module_name, type_code)
                child_titles = hierarchy_titles(req, module_name=module_name)
                if not child_titles:
                    continue
                display_title = self._effective_display_title(req, hierarchy_map, child_titles)
                module_insert_titles = self._module_insert_titles(
                    is_change_req, child_titles, display_title, module_name
                )
                layout_titles = hierarchy_titles(
                    req, module_name=module_name, include_module=is_change_req and bool(module_name)
                )
                design_text = build_design_text(getattr(req, "code", "") or "", getattr(req, "id", None))
                product_anchor_code = prev_existing_code_by_sds_sort(code, target_product)
                placed_node = self._find_word_leaf_for_req(
                    roots, req, hierarchy_map, code, module_name=module_name
                )
                if placed_node is not None:
                    placed_node.sds_code = code
                    self._sync_design_text_to_node(
                        placed_node, design_text, req, hierarchy_map, module_name, by_req_id, trace_rows
                    )
                if placed_node is None and product_anchor_code and series_num == 301:
                    placed_node = self._insert_module_after_anchor(
                        roots,
                        module_name,
                        display_title,
                        code,
                        design_text,
                        product_anchor_code,
                        child_titles=module_insert_titles,
                    )
                if placed_node is None and not is_change_req:
                    placed_node = self._insert_leaf_in_module(
                        roots,
                        module_name,
                        display_title,
                        code,
                        design_text,
                        self._build_node_parent_map(roots),
                        target_product,
                        child_titles=module_insert_titles,
                    )
                if placed_node is None:
                    placed_node = self._insert_leaf_in_product_module_before_stopper(
                        target_product,
                        module_name,
                        display_title,
                        code,
                        design_text,
                        child_titles=module_insert_titles if is_change_req else None,
                    )
                if placed_node is not None:
                    register_code_node(code, placed_node)

        roots = self._remove_unheaded_nodes_by_code_title(
            roots, {"SDS-RCN300-007"}, {"图像显示"}
        )
        roots = self._remove_stray_image_display_modules(roots)
        roots = self._prune_sync_branches_without_active_trace(roots, trace_rows)
        roots = cleanup_unmatched_generated_leaves(roots)
        roots = self._dedupe_sync_area_siblings_by_title(roots)
        roots = self._dedupe_requirement_nodes(roots)
        self._reparent_misplaced_sync_leaves(roots, trace_rows, hierarchy_map, hierarchy_titles)
        roots = self._remove_empty_duplicate_sync_containers(roots)
        roots = self._collapse_same_title_module_function_shells(roots)
        roots = self._remove_sync_title_duplicates_without_code(roots, trace_rows)
        for product_root in self._find_design_chapter_roots(roots):
            self._sort_and_renumber_sync_area_by_sds_code(product_root)
        if word_imported:
            self._relocate_unheaded_rcn301_modules(roots)
            for product_root in self._find_design_chapter_roots(roots):
                self._sort_and_renumber_sync_area_by_sds_code(product_root)

        return roots

    def _extract_design_overview(self, node: SdsNodeForm) -> str:
        """提取 SDS 节点正文中的『总体描述』段，用于与 SRS 需求概述做内容匹配。"""
        text = str(getattr(node, "text", "") or "")
        if not text.strip():
            return ""
        matched = re.search(
            r"总体描述[）)\s]*\n?(.*?)(?:\n\s*[（(]\s*\d+\s*[)）]|\Z)",
            text,
            re.S,
        )
        body = matched.group(1) if matched else text
        return re.sub(r"\s+", "", body)

    @staticmethod
    def _content_match_ratio(a: str, b: str) -> float:
        """两段已归一化文本的相似度（0~1）：短串被长串包含按长度比，否则用序列相似度。"""
        if not a or not b:
            return 0.0
        if a == b:
            return 1.0
        shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
        if shorter in longer:
            # 概述（短串）整段出现在设计正文（长串）里即视为强匹配，
            # 不让正文长度把分数拖低，避免“详细设计 vs 简短概述”被误判为不匹配。
            if len(shorter) >= 6:
                return 0.9
            return len(shorter) / len(longer)
        return difflib.SequenceMatcher(None, a, b).ratio()

    def _name_match_ratio(self, node: SdsNodeForm, req: SrsReq, hierarchy_map: dict) -> float:
        """SDS 节点标题与 SRS 章节名的模糊相似度（0~1）：完全相等=1；
        互为子串（用户登录↔用户登录33）=0.9；否则按字符集 Jaccard，
        使『编辑目标物↔目标物编辑』算同一功能，而『添加目标物↔删除目标物』不会误配。"""
        fields = sdstrace_serv.hierarchy_for_req(req, hierarchy_map)
        chapter = sdstrace_serv.compose_srs_req_chapter(req, hierarchy_map=hierarchy_map, **fields)
        chapter_norm = self._normalize_sds_node_title(chapter or "")
        node_name = self._normalize_sds_node_title(
            self._strip_sds_heading_text(getattr(node, "title", "") or "")
        )
        if not chapter_norm or not node_name:
            return 0.0
        if chapter_norm == node_name:
            return 1.0
        if chapter_norm in node_name or node_name in chapter_norm:
            return 0.9
        sa, sb = set(chapter_norm), set(node_name)
        union = sa | sb
        return len(sa & sb) / len(union) if union else 0.0

    def _bootstrap_by_req_id_by_content(
        self,
        trace_rows,
        roots: List[SdsNodeForm],
        reqd_by_req_id: Dict[int, SrsReqd],
        hierarchy_map: dict,
        by_req_id: Dict[int, SdsNodeForm],
        content_threshold: float = 0.6,
    ) -> None:
        """以『功能设计内容(总体描述) ↔ SRS需求概述』相似度，建立 req_id→SDS节点 锚点。

        SDS 设计内容基本抄自 SRS 概述，且不随改名/编号偏移而变，故作为对应主依据：
        相似度足够高即认定为同一旧功能（保留内容）；相似度不足的留给后续
        功能名/saved_location 兜底，仍无人认领的 SRS 需求即视为新功能（取 SRS）。
        """
        design_roots = self._find_design_chapter_roots(roots)
        if not design_roots:
            return
        parent_map = self._build_node_parent_map(roots)
        design_root_ids = {id(root) for root in design_roots}
        containers = self._container_title_norms()
        design_nodes: List[SdsNodeForm] = []
        seen_ids = set()

        def walk(nodes):
            for node in nodes or []:
                if self._is_in_fixed_template_zone(roots, node, parent_map, design_roots):
                    walk(getattr(node, "children", None) or [])
                    continue
                raw_title = self._strip_sds_heading_text(getattr(node, "title", "") or "")
                title_norm = self._normalize_sds_node_title(raw_title)
                is_figure = bool(re.match(r"^图\s*\d", raw_title.strip()))
                has_code = bool(re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "")))
                ov = self._extract_design_overview(node)
                has_real_content = bool(ov) and ov not in ("无", "无。")
                # 不再要求已有编号（导入态可能未回填）；但排除产品根、图节点、
                # 纯模块容器，且至少要『有编号 或 有实质设计内容』，避免误纳空壳/标题节点。
                if (
                    title_norm
                    and id(node) not in design_root_ids
                    and not is_figure
                    and title_norm not in containers
                    and (has_code or has_real_content)
                    and id(node) not in seen_ids
                ):
                    seen_ids.add(id(node))
                    design_nodes.append(node)
                walk(getattr(node, "children", None) or [])

        for root in design_roots:
            walk([root])
        if not design_nodes:
            return

        node_overviews = [(node, self._extract_design_overview(node)) for node in design_nodes]
        pending = []
        for _trace, req in trace_rows:
            rid = getattr(req, "id", None)
            if rid is None or rid in by_req_id:
                continue
            if self._is_algorithm_requirement(req, hierarchy_map):
                continue
            reqd = reqd_by_req_id.get(rid)
            overview = re.sub(r"\s+", "", str(getattr(reqd, "overview", "") or "")) if reqd else ""
            # 概述为空也加入：可仅靠功能名模糊匹配兜底锚定旧功能
            pending.append((rid, overview, req))
        if not pending:
            return

        used_nodes = {id(n) for n in by_req_id.values()}
        pairs = []
        for rid, overview, req in pending:
            for node, node_ov in node_overviews:
                content_ratio = self._content_match_ratio(overview, node_ov) if node_ov else 0.0
                name_ratio = self._name_match_ratio(node, req, hierarchy_map)
                # 内容相似 或 功能名模糊一致，任一达标即视为候选（模糊匹配）
                score = max(content_ratio, name_ratio)
                if score >= content_threshold:
                    name_match = 1 if name_ratio >= 0.9 else 0
                    pairs.append((score, name_match, rid, node))
        # 相似度优先；相似度相同时，功能名与节点标题一致的需求优先占用该节点，
        # 避免 reqd 错位的新需求（如反转概述=操作指南）抢走旧功能（操作指南）的节点。
        pairs.sort(key=lambda item: (item[0], item[1]), reverse=True)
        bound_reqs = set()
        for _ratio, _name_match, rid, node in pairs:
            if rid in bound_reqs or id(node) in used_nodes:
                continue
            by_req_id[rid] = node
            bound_reqs.add(rid)
            used_nodes.add(id(node))

    def _collect_design_req_index(self, roots: List[SdsNodeForm]):
        """在全文档设计树中索引已有需求节点（按 SDS 编号 / 标题）。"""
        by_code: Dict[str, SdsNodeForm] = {}
        by_title: Dict[str, SdsNodeForm] = {}
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)
        design_root_ids = {id(root) for root in design_roots}
        product_cache: Dict[str, Optional[SdsNodeForm]] = {}
        node_product_cache: Dict[int, Optional[SdsNodeForm]] = {}

        def product_for_code(code: str) -> Optional[SdsNodeForm]:
            if code not in product_cache:
                product_cache[code] = self._resolve_product_root_for_req(roots, code)
            return product_cache[code]

        def node_product(node: SdsNodeForm) -> Optional[SdsNodeForm]:
            key = id(node)
            if key not in node_product_cache:
                found = None
                current = node
                while current is not None:
                    if id(current) in design_root_ids:
                        found = current
                        break
                    current = parent_map.get(id(current))
                node_product_cache[key] = found
            return node_product_cache[key]

        def prefer_code_node(current: Optional[SdsNodeForm], candidate: SdsNodeForm, code: str) -> SdsNodeForm:
            if current is None:
                return candidate
            target = product_for_code(code)
            if target is None:
                return current
            if node_product(candidate) is target and node_product(current) is not target:
                return candidate
            return current

        def walk(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                if self._is_in_fixed_template_zone(roots, node, parent_map, design_roots):
                    walk(getattr(node, "children", None) or [])
                    continue
                for code in self._extract_node_sds_codes(node):
                    by_code[code] = prefer_code_node(by_code.get(code), node, code)
                field_code = re.sub(r"\s+", "", str(getattr(node, "sds_code", "") or "").strip().upper())
                if field_code:
                    by_code[field_code] = prefer_code_node(by_code.get(field_code), node, field_code)
                title_norm = self._normalize_sds_node_title(getattr(node, "title", "") or "")
                if title_norm:
                    by_title.setdefault(title_norm, node)
                walk(getattr(node, "children", None) or [])

        for root in self._find_design_chapter_roots(roots):
            walk([root])
        if not by_code and not by_title:
            ch6 = self._find_chapter6_root(roots)
            if ch6:
                walk([ch6])
        return by_code, by_title

    def _prune_design_nodes_not_in_trace(self, roots: List[SdsNodeForm], active_codes: set) -> List[SdsNodeForm]:
        """获取 SRS 追溯时，移除已不在当前 SRS 追溯里的旧同步章节。"""
        active_codes = {self._normalize_code(code) for code in (active_codes or set()) if self._normalize_code(code)}
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        def node_trace_codes(node: SdsNodeForm) -> set:
            return {
                self._normalize_code(code)
                for code in self._extract_node_sds_codes(node)
                if self._normalize_code(code).startswith("SDS-")
            }

        def has_active_code(node: SdsNodeForm) -> bool:
            codes = node_trace_codes(node)
            if codes & active_codes:
                return True
            return any(has_active_code(child) for child in getattr(node, "children", None) or [])

        def prune_children(parent: Optional[SdsNodeForm], children: List[SdsNodeForm]) -> Tuple[List[SdsNodeForm], bool]:
            kept: List[SdsNodeForm] = []
            changed = False
            for child in children or []:
                if self._is_in_fixed_template_zone(roots, child, parent_map, design_roots):
                    next_children, child_changed = prune_children(child, getattr(child, "children", None) or [])
                    child.children = next_children
                    kept.append(child)
                    changed = changed or child_changed
                    continue
                next_children, child_changed = prune_children(child, getattr(child, "children", None) or [])
                child.children = next_children
                codes = node_trace_codes(child)
                if codes and codes.isdisjoint(active_codes) and not any(has_active_code(grand) for grand in next_children):
                    changed = True
                    continue
                if codes and codes.isdisjoint(active_codes):
                    field_code = self._normalize_code(getattr(child, "sds_code", "") or "")
                    if field_code in codes:
                        child.sds_code = None
                        changed = True
                kept.append(child)
                changed = changed or child_changed
            return kept, changed

        roots, _changed = prune_children(None, roots or [])
        return roots

    @staticmethod
    def _rcn_series_seq_sort_pair(code: str):
        """RCN301-001 → (1, 1)；代号首位 3 不参与排序，按 01-001 段依次排列。"""
        text = str(code or "").strip().upper()
        matched = re.search(r"RCN(\d+)-(\d+)", text)
        if not matched:
            return None
        series_raw = matched.group(1)
        seq = int(matched.group(2))
        if series_raw.startswith("3") and len(series_raw) > 1:
            series = int(series_raw[1:])
        else:
            series = int(series_raw)
        return (series, seq)

    @staticmethod
    def _sds_code_sort_key(code: str):
        pair = SdsSrsTraceSyncMixin._rcn_series_seq_sort_pair(code)
        if pair is not None:
            return pair
        nums = [int(x) for x in re.findall(r"\d+", str(code or ""))]
        return tuple(nums) if nums else (9999, 9999)

    def _replace_heading_prefix_in_descendants(self, node: SdsNodeForm, old_prefix: str, new_prefix: str):
        if not old_prefix or not new_prefix or old_prefix == new_prefix:
            return
        for child in getattr(node, "children", None) or []:
            heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
            if heading and (heading == old_prefix or heading.startswith(old_prefix + ".")):
                body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                new_heading = new_prefix + heading[len(old_prefix):]
                child.title = f"{new_heading} {body}".strip()
            self._replace_heading_prefix_in_descendants(child, old_prefix, new_prefix)

    def _sort_and_renumber_sync_area_by_sds_code(self, product_root: SdsNodeForm):
        """产品章节内：X.1~X.5 保持模板顺序，X.6 之后按 SDS 编号排序并同步章节号。"""
        root_heading = self._parse_sds_node_heading(getattr(product_root, "title", "") or "")
        if not root_heading:
            return
        major = self._product_chapter_major(product_root)
        if major is None:
            return

        def is_stopper(node: SdsNodeForm):
            return self._is_function_stopper_title(getattr(node, "title", "") or "")

        def sort_key(node: SdsNodeForm):
            return self._sds_code_sort_key(self._subtree_min_sds_code(node))

        def set_heading(node: SdsNodeForm, heading: str):
            body = self._strip_sds_heading_text(getattr(node, "title", "") or "") or getattr(node, "title", "") or ""
            node.title = f"{heading} {body}".strip() if body else heading

        def sort_and_renumber_children(parent: SdsNodeForm, parent_heading: str, fixed_product_level: bool = False):
            children = list(getattr(parent, "children", None) or [])
            if not children:
                return

            fixed_children: List[SdsNodeForm] = []
            sortable_children: List[SdsNodeForm] = []
            for child in children:
                minor = self._heading_section_minor(getattr(child, "title", "") or "", major) if fixed_product_level else None
                if fixed_product_level and minor is not None and minor <= self.FIXED_TEMPLATE_SECTION_MAX:
                    fixed_children.append(child)
                else:
                    sortable_children.append(child)

            regular = [child for child in sortable_children if not is_stopper(child)]
            stoppers = [child for child in sortable_children if is_stopper(child)]
            regular = [
                child for child in regular
                if self._subtree_min_sds_code(child)
                or (getattr(child, "children", None) or [])
                or self._node_subtree_has_image(child)
            ]
            regular.sort(key=sort_key)
            ordered = fixed_children + regular + stoppers
            parent.children = ordered

            seq = self.FIXED_TEMPLATE_SECTION_MAX if fixed_product_level else 0
            for child in ordered:
                if fixed_product_level and child in fixed_children:
                    child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "") or parent_heading
                    sort_and_renumber_children(child, child_heading, False)
                    continue
                if not self._is_numberable_design_child(child):
                    continue
                seq += 1
                new_heading = f"{parent_heading}.{seq}"
                old_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                set_heading(child, new_heading)
                if old_heading and old_heading != new_heading:
                    self._replace_heading_prefix_in_descendants(child, old_heading, new_heading)
                sort_and_renumber_children(child, new_heading, False)

        sort_and_renumber_children(product_root, root_heading, True)

    async def _ensure_trace_nodes_from_saved_locations(self, doc_id: int, roots: List[SdsNodeForm]):
        def normalize_code(value: str):
            return re.sub(r"\s+", "", str(value or "").strip().upper())

        def parse_heading(value: str):
            matched = re.match(r"^\s*(\d+(?:\.\d+)*)", str(value or "").strip())
            return matched.group(1) if matched else ""

        def strip_heading(value: str):
            return self._strip_sds_heading_text(value)

        def clean_name(value: str):
            text = strip_heading(value)
            return "" if text in ("/", "\\") else text

        def heading_sort_key(value: str):
            heading = parse_heading(value)
            if not heading:
                return (9999,)
            return tuple(int(part) for part in heading.split("."))

        def walk(nodes: List[SdsNodeForm]):
            for node in nodes or []:
                yield node
                yield from walk(getattr(node, "children", None) or [])

        def find_by_heading(nodes: List[SdsNodeForm], heading: str):
            for node in walk(nodes):
                if parse_heading(getattr(node, "title", "") or "") == heading:
                    return node
            return None

        existing_codes = {
            normalize_code(getattr(node, "sds_code", "") or "")
            for node in walk(roots or [])
            if normalize_code(getattr(node, "sds_code", "") or "")
        }
        nodes_by_code = {}
        parent_lists = {}

        def collect_parent_lists(nodes: List[SdsNodeForm], parent_list: List[SdsNodeForm]):
            for node in nodes or []:
                parent_lists[id(node)] = parent_list
                collect_parent_lists(getattr(node, "children", None) or [], getattr(node, "children", None) or [])

        collect_parent_lists(roots or [], roots or [])
        for node in walk(roots or []):
            code = normalize_code(getattr(node, "sds_code", "") or "")
            if code:
                nodes_by_code.setdefault(code, []).append(node)
        rows = db.session.execute(
            select(SdsTrace, SrsReq, SdsReqd, SrsReqd)
            .join(SrsReq, SrsReq.id == SdsTrace.req_id)
            .outerjoin(SdsReqd, (SdsReqd.req_id == SrsReq.id) & (SdsReqd.doc_id == SdsTrace.doc_id))
            .outerjoin(SrsReqd, SrsReqd.req_id == SrsReq.id)
            .where(SdsTrace.doc_id == doc_id, SdsTrace.location.isnot(None))
        ).all()

        changed = False
        for trace, req, sds_reqd, srs_reqd in rows:
            sds_code = normalize_code(getattr(trace, "sds_code", "") or "")
            location = str(getattr(trace, "location", "") or "").strip()
            if not sds_code or not re.match(r"^\d+(?:\.\d+)+$", location):
                continue
            matched_nodes = nodes_by_code.get(sds_code) or []
            if any(parse_heading(getattr(node, "title", "") or "") == location for node in matched_nodes):
                existing_codes.add(sds_code)
                continue
            for node in matched_nodes:
                node.sds_code = None
                changed = True
            existing_codes.discard(sds_code)
            parent_heading = ".".join(location.split(".")[:-1])
            parent_node = find_by_heading(roots, parent_heading)
            if parent_node is None:
                grand_heading = ".".join(parent_heading.split(".")[:-1])
                grand_node = find_by_heading(roots, grand_heading) if grand_heading else None
                parent_title = f"{parent_heading} {clean_name(getattr(req, 'module', '') or '') or clean_name(getattr(req, 'function', '') or '') or parent_heading}"
                parent_node = SdsNodeForm(title=parent_title, children=[])
                if grand_node is not None:
                    grand_node.children = list(getattr(grand_node, "children", None) or [])
                    grand_node.children.append(parent_node)
                    grand_node.children.sort(key=lambda item: heading_sort_key(getattr(item, "title", "") or ""))
                else:
                    roots.append(parent_node)
                    roots.sort(key=lambda item: heading_sort_key(getattr(item, "title", "") or ""))
                changed = True
            leaf_title_text = (
                clean_name(getattr(req, "sub_function", "") or "")
                or clean_name(getattr(req, "function", "") or "")
                or clean_name(getattr(req, "module", "") or "")
                or sds_code
            )
            parent_node.children = list(getattr(parent_node, "children", None) or [])
            move_node = matched_nodes[0] if matched_nodes else None
            if move_node:
                old_parent_list = parent_lists.get(id(move_node))
                if old_parent_list is not None and move_node in old_parent_list:
                    old_parent_list.remove(move_node)
                move_node.title = f"{location} {leaf_title_text}"
                move_node.sds_code = sds_code
                if move_node not in parent_node.children:
                    parent_node.children.append(move_node)
                parent_lists[id(move_node)] = parent_node.children
            else:
                parent_node.children.append(SdsNodeForm(
                    title=f"{location} {leaf_title_text}",
                    sds_code=sds_code,
                    text="",
                    children=[],
                ))
            parent_node.children.sort(key=lambda item: heading_sort_key(getattr(item, "title", "") or ""))
            existing_codes.add(sds_code)
            changed = True
        return roots if changed else roots

    def _clear_node_ids(self, nodes: List[SdsNodeForm]):
        for node in nodes or []:
            node.n_id = 0
            self._clear_node_ids(getattr(node, "children", None) or [])
        return nodes

    def _dedupe_requirement_nodes(self, nodes: List[SdsNodeForm]):
        def normalize_code(value: str):
            return re.sub(r"\s+", "", str(value or "").strip().upper())

        def parse_heading(value: str):
            matched = re.match(r"^\s*(\d+(?:\.\d+)*)", str(value or "").strip())
            return matched.group(1) if matched else ""

        def score(node: SdsNodeForm):
            text_len = len(str(getattr(node, "text", "") or ""))
            img_len = len(str(getattr(node, "img_url", "") or ""))
            children_len = len(getattr(node, "children", None) or [])
            table_score = 1 if getattr(node, "table", None) else 0
            return (text_len, img_len, children_len, table_score)

        def merge_node(keeper: SdsNodeForm, duplicate: SdsNodeForm):
            if not (getattr(keeper, "text", "") or "").strip() and (getattr(duplicate, "text", "") or "").strip():
                keeper.text = duplicate.text
            if not (getattr(keeper, "img_url", "") or "").strip() and (getattr(duplicate, "img_url", "") or "").strip():
                keeper.img_url = duplicate.img_url
            if not getattr(keeper, "table", None) and getattr(duplicate, "table", None):
                keeper.table = duplicate.table
            keeper.children = list(getattr(keeper, "children", None) or [])
            for child in getattr(duplicate, "children", None) or []:
                if child not in keeper.children:
                    keeper.children.append(child)

        def walk(items: List[SdsNodeForm]):
            grouped = {}
            result = []
            for node in items or []:
                node.children = walk(getattr(node, "children", None) or [])
                heading = parse_heading(getattr(node, "title", "") or "")
                code = normalize_code(getattr(node, "sds_code", "") or "")
                key = (heading, code) if heading and code else None
                if not key:
                    result.append(node)
                    continue
                keeper = grouped.get(key)
                if not keeper:
                    grouped[key] = node
                    result.append(node)
                    continue
                if score(node) > score(keeper):
                    merge_node(node, keeper)
                    idx = result.index(keeper)
                    result[idx] = node
                    grouped[key] = node
                else:
                    merge_node(keeper, node)
            return result

        return walk(nodes or [])

    def _insert_module_after_anchor(
        self,
        roots: List[SdsNodeForm],
        module_name: str,
        display_title: str,
        code: str,
        design_text: str,
        anchor_code: str,
        child_titles: Optional[List[str]] = None,
    ) -> Optional[SdsNodeForm]:
        anchor = self._find_node_by_code_in_tree(roots, anchor_code)
        if anchor is None:
            return None
        parent_map = self._build_node_parent_map(roots)
        parent = parent_map.get(id(anchor))
        if parent is None or self._is_in_fixed_template_zone(roots, parent):
            return None
        children = list(getattr(parent, "children", None) or [])
        try:
            anchor_idx = children.index(anchor)
        except ValueError:
            return None

        module_node = self._find_module_node_global(roots, module_name) if module_name else None
        if module_node is not None:
            if self._is_descendant_of(module_node, anchor, parent_map):
                titles = child_titles if child_titles else [self._strip_sds_heading_text(display_title) or display_title]
                return self._append_numbered_hierarchy(module_node, titles, code, design_text)
            self._detach_node(roots, module_node)
        else:
            module_node = SdsNodeForm(title=str(module_name or "").strip() or "未命名模块", children=[])
        if module_node.children is None:
            module_node.children = []
        children = list(getattr(parent, "children", None) or [])
        try:
            anchor_idx = children.index(anchor)
        except ValueError:
            return None
        children.insert(anchor_idx + 1, module_node)

        parent_heading = self._parse_sds_node_heading(getattr(parent, "title", "") or "")
        if parent_heading:
            parent_depth = len(parent_heading.split("."))
            seq = 0
            for child in children:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                is_direct = child is module_node
                if child_heading and child_heading.startswith(parent_heading + "."):
                    is_direct = len(child_heading.split(".")) == parent_depth + 1
                if not is_direct:
                    continue
                seq += 1
                child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                child.title = f"{parent_heading}.{seq} {child_body}".strip()

        module_heading = self._parse_sds_node_heading(getattr(module_node, "title", "") or "")
        if child_titles:
            leaf = self._append_numbered_hierarchy(module_node, child_titles, code, design_text)
            parent.children = children
            return leaf
        leaf = self._find_node_by_code_in_tree([module_node], code)
        if leaf is None:
            leaf = SdsNodeForm(sds_code=code, text=design_text, children=[])
            module_node.children.append(leaf)
        leaf_body = self._strip_sds_heading_text(getattr(leaf, "title", "") or "") or self._strip_sds_heading_text(display_title) or display_title
        if module_heading:
            leaf.title = f"{module_heading}.1 {leaf_body}".strip()
        else:
            leaf.title = leaf_body
        leaf.sds_code = code
        if not (getattr(leaf, "text", "") or "").strip():
            leaf.text = design_text
        parent.children = children
        return leaf
    def _is_numberable_design_child(self, node: SdsNodeForm) -> bool:
        title = self._strip_sds_heading_text(getattr(node, "title", "") or "") or getattr(node, "title", "") or ""
        title = str(title or "").strip()
        if not title:
            return False
        if title.startswith("图 ") or title.startswith("图\t") or title.startswith("导入"):
            return False
        return bool(getattr(node, "sds_code", None) or getattr(node, "children", None))
    def _renumber_design_children(self, parent: SdsNodeForm):
        parent_heading = self._parse_sds_node_heading(getattr(parent, "title", "") or "")
        if not parent_heading:
            return
        parent_depth = len(parent_heading.split("."))
        seq = 0
        for child in getattr(parent, "children", None) or []:
            if not self._is_numberable_design_child(child):
                continue
            child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
            if child_heading and child_heading.startswith(parent_heading + "."):
                parts = child_heading.split(".")
                if len(parts) != parent_depth + 1:
                    continue
            seq += 1
            child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
            child.title = f"{parent_heading}.{seq} {child_body}".strip()
            self._renumber_design_children(child)
    def _append_numbered_hierarchy(
        self,
        parent: SdsNodeForm,
        titles: List[str],
        code: str,
        design_text: str,
    ) -> Optional[SdsNodeForm]:
        if parent is None or not titles:
            return None
        if parent.children is None:
            parent.children = []
        level_nodes = parent.children
        leaf = None
        for idx, title in enumerate(titles):
            title = str(title or "").strip()
            if not title or title in ("/", "-", "\\"):
                continue
            is_leaf = idx == len(titles) - 1
            norm = self._normalize_sds_node_title(title)
            target = None
            for candidate in level_nodes:
                candidate_norm = self._normalize_sds_node_title(
                    self._strip_sds_heading_text(getattr(candidate, "title", "") or "")
                    or getattr(candidate, "title", "") or ""
                )
                if candidate_norm != norm:
                    continue
                if is_leaf:
                    existing_code = self._normalize_code(getattr(candidate, "sds_code", "") or "")
                    if existing_code and existing_code != code:
                        continue
                target = candidate
                break
            if target is None:
                target = SdsNodeForm(
                    title=title,
                    sds_code=code if is_leaf else None,
                    text=design_text if is_leaf else "",
                    children=[],
                )
                level_nodes.append(target)
            elif is_leaf:
                target.sds_code = code
                if not (getattr(target, "text", "") or "").strip():
                    target.text = design_text
            if target.children is None:
                target.children = []
            if is_leaf:
                leaf = target
            level_nodes = target.children
        self._renumber_design_children(parent)
        return leaf
    def _insert_leaf_before_product_stopper(
        self,
        product_root: Optional[SdsNodeForm],
        display_title: str,
        code: str,
        design_text: str,
    ) -> Optional[SdsNodeForm]:
        """将新增功能作为产品章直属功能章节，插在限制条件/尚未解决的问题前。"""
        if product_root is None:
            return None
        if product_root.children is None:
            product_root.children = []
        children = list(product_root.children)
        insert_idx = len(children)
        for idx, child in enumerate(children):
            if self._is_function_stopper_title(getattr(child, "title", "") or ""):
                insert_idx = idx
                break
        body = self._strip_sds_heading_text(display_title) or display_title
        new_node = SdsNodeForm(title=body, sds_code=code, text=design_text, children=[])
        children.insert(insert_idx, new_node)
        product_root.children = children
        root_heading = self._parse_sds_node_heading(getattr(product_root, "title", "") or "")
        if root_heading:
            root_depth = len(root_heading.split("."))
            prev_seq = 0
            for child in children[:insert_idx]:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                if not child_heading or not child_heading.startswith(root_heading + "."):
                    continue
                parts = child_heading.split(".")
                if len(parts) != root_depth + 1:
                    continue
                try:
                    prev_seq = max(prev_seq, int(parts[-1]))
                except Exception:
                    continue
            seq = prev_seq
            for child in children[insert_idx:]:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                is_direct = child is new_node
                if child_heading and child_heading.startswith(root_heading + "."):
                    is_direct = len(child_heading.split(".")) == root_depth + 1
                if not is_direct:
                    continue
                seq += 1
                child_body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                child.title = f"{root_heading}.{seq} {child_body}".strip()
        return new_node
    def _sort_direct_function_siblings_by_sds_code(self, roots: List[SdsNodeForm]):
        """Word 同步后：仅排序同一父级下带 SDS 编号的直接功能节点，避免 304-022 排在 304-021 前。"""
        parent_map = self._build_node_parent_map(roots)
        design_roots = self._find_design_chapter_roots(roots)

        def normalize_code(value: str) -> str:
            return re.sub(r"\s+", "", str(value or "").strip().upper())

        def direct_coded_child(parent_heading: str, child: SdsNodeForm) -> bool:
            if not parent_heading:
                return False
            code = normalize_code(getattr(child, "sds_code", "") or "")
            if not code or self._rcn_series_num(code) is None:
                return False
            child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
            if not child_heading or not child_heading.startswith(parent_heading + "."):
                return False
            return len(child_heading.split(".")) == len(parent_heading.split(".")) + 1

        def renumber_direct_children(parent: SdsNodeForm):
            parent_heading = self._parse_sds_node_heading(getattr(parent, "title", "") or "")
            if not parent_heading:
                return
            seq = 0
            parent_depth = len(parent_heading.split("."))
            for child in getattr(parent, "children", None) or []:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                if not child_heading or not child_heading.startswith(parent_heading + "."):
                    continue
                if len(child_heading.split(".")) != parent_depth + 1:
                    continue
                seq += 1
                new_heading = f"{parent_heading}.{seq}"
                if child_heading == new_heading:
                    continue
                body = self._strip_sds_heading_text(getattr(child, "title", "") or "") or getattr(child, "title", "") or ""
                child.title = f"{new_heading} {body}".strip()
                self._replace_heading_prefix_in_descendants(child, child_heading, new_heading)

        def walk(parent: SdsNodeForm):
            if self._is_in_fixed_template_zone(roots, parent, parent_map, design_roots):
                return
            children = list(getattr(parent, "children", None) or [])
            parent_heading = self._parse_sds_node_heading(getattr(parent, "title", "") or "")
            changed = False
            idx = 0
            while idx < len(children):
                if not direct_coded_child(parent_heading, children[idx]):
                    idx += 1
                    continue
                start = idx
                while idx < len(children) and direct_coded_child(parent_heading, children[idx]):
                    idx += 1
                run = children[start:idx]
                sorted_run = sorted(run, key=lambda item: self._sds_code_sort_key(getattr(item, "sds_code", "") or ""))
                if run != sorted_run:
                    children[start:idx] = sorted_run
                    changed = True
            if changed:
                parent.children = children
                renumber_direct_children(parent)
            for child in getattr(parent, "children", None) or []:
                walk(child)

        for root in roots or []:
            walk(root)
    @staticmethod
    def _subtree_min_sds_code(node: SdsNodeForm) -> str:
        code = re.sub(r"\s+", "", (getattr(node, "sds_code", "") or "").strip().upper())
        best = code
        for child in getattr(node, "children", None) or []:
            child_code = SdsSrsTraceSyncMixin._subtree_min_sds_code(child)
            if child_code and (not best or SdsSrsTraceSyncMixin._sds_code_sort_key(child_code) < SdsSrsTraceSyncMixin._sds_code_sort_key(best)):
                best = child_code
        return best
    def _sort_subtree_siblings_by_sds_code(self, node: SdsNodeForm):
        children = list(getattr(node, "children", None) or [])
        if not children:
            return

        def is_stopper(title: str):
            txt = re.sub(r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))?", "", str(title or "")).strip()
            txt = re.sub(r"\s+", "", txt).lower()
            return "限制条件" in txt or "尚未解决的问题" in txt

        stoppers = [child for child in children if is_stopper(getattr(child, "title", "") or "")]
        regular = [child for child in children if not is_stopper(getattr(child, "title", "") or "")]
        for child in regular:
            self._sort_subtree_siblings_by_sds_code(child)
        regular.sort(key=lambda item: self._sds_code_sort_key(self._subtree_min_sds_code(item)))
        node.children = regular + stoppers
    def _assign_headings_to_unnumbered_nodes(self, node: SdsNodeForm):
        """Word 导入：仅给无章节号的新节点补号，不重排已有章节。"""
        prefix = self._parse_sds_node_heading(getattr(node, "title", "") or "")
        children = list(getattr(node, "children", None) or [])
        if prefix:
            max_idx = 0
            for child in children:
                child_heading = self._parse_sds_node_heading(getattr(child, "title", "") or "")
                if child_heading and child_heading.startswith(f"{prefix}."):
                    try:
                        max_idx = max(max_idx, int(child_heading.rsplit(".", 1)[-1]))
                    except Exception:
                        pass
            for child in children:
                title = str(getattr(child, "title", "") or "")
                txt = re.sub(r"\s+", "", self._strip_sds_heading_text(title).lower())
                if "限制条件" in txt or "尚未解决的问题" in txt:
                    continue
                if self._parse_sds_node_heading(title):
                    continue
                max_idx += 1
                body = self._strip_sds_heading_text(title) or title.strip()
                child.title = f"{prefix}.{max_idx} {body}".strip() if body else f"{prefix}.{max_idx}"
        for child in children:
            self._assign_headings_to_unnumbered_nodes(child)
    def _renumber_sync_subtree(self, node: SdsNodeForm):
        matched = re.match(
            r"^\s*(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))",
            str(getattr(node, "title", "") or "").strip(),
        )
        if not matched:
            return
        prefix = matched.group(1)
        children = list(getattr(node, "children", None) or [])
        stoppers = [child for child in children if self._is_function_stopper_title(getattr(child, "title", "") or "")]
        regular = [child for child in children if not self._is_function_stopper_title(getattr(child, "title", "") or "")]
        node.children = regular + stoppers

        idx = 0
        for child in regular:
            idx += 1
            body = re.sub(
                r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))?",
                "",
                str(getattr(child, "title", "") or "").strip(),
            ).strip()
            child.title = f"{prefix}.{idx} {body}".strip() if body else f"{prefix}.{idx}"
            self._renumber_sync_subtree(child)
    @staticmethod
    def _assign_sync_child_headings(node: SdsNodeForm):
        matched = re.match(r"^\s*(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))", str(getattr(node, "title", "") or "").strip())
        if not matched:
            return
        prefix = matched.group(1)
        for idx, child in enumerate(getattr(node, "children", None) or [], start=1):
            body = re.sub(r"^\s*\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))?", "", str(getattr(child, "title", "") or "").strip()).strip()
            child.title = f"{prefix}.{idx} {body}".strip()
            SdsSrsTraceSyncMixin._assign_sync_child_headings(child)
