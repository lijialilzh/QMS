import logging
import sys
import re
from typing import Any, Dict, List, Tuple
from sqlalchemy import select, delete, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import desc
from ..obj.vobj_user import UserObj
from ..model.srs_type import SrsType
from ..model.srs_reqd import SrsReqd
from ..model.sds_doc import SdsDoc, SdsNode
from ..model.srs_doc import SrsDoc
from ..model.product import Product, UserProd
from ..model.srs_req import SrsReq
from ..model.sds_reqd import SdsReqd, Logic
from ..model.sds_trace import SdsTrace
from ..obj.tobj_sds_reqd import SdsReqdForm, LogicForm
from ..obj.vobj_sds_reqd import SdsReqdObj
from ..obj.tobj_sds_doc import SdsNodeForm
from ..utils.sql_ctx import db
from ..utils import get_uuid
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db, save_file
from .serv_srs_reqd import Server as ServSrsReqd

logger = logging.getLogger(__name__)
srsreqd_serv = ServSrsReqd()


class Server(object):
    SECTION_PREFIX_RE = r"(?:[（(]\d+[）)]|\d+[).、．]?)?\s*"

    @staticmethod
    def __is_placeholder(value: str):
        txt = (value or "").strip()
        return txt in ["", "-", "--", "—", "/", "\\", "暂无", "无", "N/A", "n/a"]

    @staticmethod
    def __normalize_name_part(value: str):
        txt = str(value or "").strip()
        if not txt:
            return ""
        if txt in {"/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"}:
            return ""
        return txt

    def __pick_req_name(self, req_row: SrsReq, *fallbacks):
        for val in [req_row.sub_function, req_row.function, req_row.module, *fallbacks]:
            txt = self.__normalize_name_part(val)
            if txt:
                return txt
        return ""

    @staticmethod
    def __pick_srs_flow_text(row_srsreqd: SrsReqd):
        if not row_srsreqd:
            return ""
        work_flow = (getattr(row_srsreqd, "work_flow", None) or "").strip()
        trigger = (getattr(row_srsreqd, "trigger", None) or "").strip()
        if work_flow:
            return work_flow
        # 兼容SRS里把“事件流”写在触发器/触发条件字段中的情况
        return trigger

    @staticmethod
    def __compose_srs_func_detail(row_srsreqd: SrsReqd):
        if not row_srsreqd:
            return ""
        trigger = (getattr(row_srsreqd, "trigger", None) or "").strip()
        work_flow = (getattr(row_srsreqd, "work_flow", None) or "").strip()
        if trigger and work_flow:
            if trigger == work_flow:
                return trigger
            return f"{trigger}\n{work_flow}"
        return trigger or work_flow

    @staticmethod
    def __has_srs_detail_content(row_srsreqd: SrsReqd):
        if not row_srsreqd:
            return False
        for field in ["overview", "trigger", "work_flow", "pre_condition", "post_condition", "exception", "constraint"]:
            if (getattr(row_srsreqd, field, None) or "").strip():
                return True
        return False

    @staticmethod
    def __extract_io_sections_from_text(text: str):
        raw = (text or "").strip()
        if not raw:
            return {}
        # 兼容 "(4) 输入项" / "4. 输入项" / "输入项：" 等写法
        marker_re = re.compile(r"(?:\(\d+\)|\d+[).、．]?)?\s*(输入项|输出项|接口)(?:描述)?\s*[：:]?")
        hits = list(marker_re.finditer(raw))
        if not hits:
            return {}
        result = {}
        field_map = {"输入项": "intput", "输出项": "output", "接口": "interface"}
        for idx, hit in enumerate(hits):
            marker = hit.group(1)
            field = field_map.get(marker)
            if not field:
                continue
            start = hit.end()
            end = hits[idx + 1].start() if idx + 1 < len(hits) else len(raw)
            seg = raw[start:end].strip(" \t\r\n:：;；，,。")
            if not seg:
                continue
            old = (result.get(field) or "").strip()
            if (not old) or len(seg) > len(old):
                result[field] = seg
        return result

    @staticmethod
    def __normalize_code(code: str):
        txt = (code or "").strip().upper()
        txt = re.sub(r"\s+", "", txt)
        txt = re.sub(r"[，。；;、,.]+$", "", txt)
        return txt

    @staticmethod
    def __to_sds_code(srs_code: str):
        txt = Server.__normalize_code(srs_code)
        if txt.startswith("SRS-"):
            return "SDS-" + txt[4:]
        return txt

    @staticmethod
    def __normalize_name(value: str):
        txt = (value or "").strip()
        txt = re.sub(r"^[\d一二三四五六七八九十零]+([.\-、）)\s]+[\d一二三四五六七八九十零]*)*", "", txt)
        txt = re.sub(r"[\s:：\-_，。；;、,.()（）]+", "", txt)
        return txt.lower()

    @staticmethod
    def __normalize_section_name(value: str):
        txt = (value or "").strip()
        txt = re.sub(r"^[（(]?[一二三四五六七八九十0-9]+[)）.\s、]*", "", txt)
        txt = re.sub(r"[\s:：\-_，。；;、]+", "", txt)
        return txt

    def __detect_field(self, node: SdsNodeForm):
        merged = self.__normalize_section_name(f"{getattr(node, 'label', '')}{getattr(node, 'title', '')}")
        if not merged:
            return None
        if any(k in merged for k in ["总体描述", "需求概述", "概述"]):
            return "overview"
        if "程序逻辑" in merged or "逻辑" in merged:
            return "logic_txt"
        if "输入项" in merged or merged == "输入":
            return "intput"
        if "输出项" in merged or merged == "输出":
            return "output"
        if "接口" in merged:
            return "interface"
        if "功能" in merged:
            return "func_detail"
        return None

    def __query_doc_tree(self, doc_ids: List[int]):
        doc_trees = dict()
        if not doc_ids:
            return doc_trees
        sql = select(SdsNode).where(SdsNode.doc_id.in_(doc_ids)).order_by(SdsNode.priority)
        nodes: List[SdsNode] = db.session.execute(sql).scalars().all()
        doc_nodes = dict()
        for node in nodes:
            doc_nodes.setdefault(node.doc_id, []).append(node)

        for doc_id, rows in doc_nodes.items():
            tree = []
            obj_dict = dict()
            objs = []
            for node in rows:
                obj = SdsNodeForm(
                    children=[],
                    doc_id=node.doc_id,
                    n_id=node.n_id,
                    p_id=node.p_id,
                    title=node.title,
                    label=node.label,
                    img_url=node.img_url,
                    text=node.text,
                    ref_type=node.ref_type,
                    sds_code=node.sds_code,
                )
                obj_dict[obj.n_id] = obj
                objs.append(obj)
            for obj in objs:
                if obj.p_id == 0:
                    tree.append(obj)
                else:
                    parent = obj_dict.get(obj.p_id)
                    if parent:
                        parent.children.append(obj)
            doc_trees[doc_id] = tree
        return doc_trees

    def __extract_payload_under_node(self, node: SdsNodeForm):
        payload = dict()

        def walk(nodes):
            for n in nodes or []:
                field = self.__detect_field(n)
                text = (getattr(n, "text", "") or "").strip()
                tagged = self.__extract_tagged_sections_from_text(text) if text else {}
                payload.update(self.__merge_values(payload, tagged))
                if field and text:
                    value = text
                    if field == "logic_txt":
                        value = self.__extract_logic_text(text)
                    old = payload.get(field, "")
                    if value and (not old or len(value) > len(old)):
                        payload[field] = value
                walk(getattr(n, "children", None) or [])

        walk([node])
        return payload

    @staticmethod
    def __merge_values(base: dict, extra: dict):
        result = dict(base or {})
        for key, value in (extra or {}).items():
            old = (result.get(key) or "").strip()
            new = (value or "").strip()
            if new and (not old or len(new) > len(old)):
                result[key] = new
        return result

    def __extract_tagged_sections_from_text(self, text: str):
        raw = (text or "").strip()
        if not raw:
            return {}
        marker_map = {
            "总体描述": "overview",
            "需求概述": "overview",
            "概述": "overview",
            "功能": "func_detail",
            "程序逻辑": "logic_txt",
            "逻辑描述": "logic_txt",
            "逻辑": "logic_txt",
            "输入项": "intput",
            "输出项": "output",
            "接口": "interface",
        }
        marker_re = re.compile(rf"{self.SECTION_PREFIX_RE}(总体描述|需求概述|概述|功能|程序逻辑|逻辑描述|逻辑|输入项|输出项|接口)(?:描述)?\s*[：:]?")
        hits = list(marker_re.finditer(raw))
        if not hits:
            return {}
        result = {}
        for idx, hit in enumerate(hits):
            marker = hit.group(1)
            field = marker_map.get(marker)
            if not field:
                continue
            start = hit.end()
            end = hits[idx + 1].start() if idx + 1 < len(hits) else len(raw)
            seg = raw[start:end].strip(" \t\r\n:：;；，,。")
            if not seg:
                continue
            old = (result.get(field) or "").strip()
            if (not old) or len(seg) > len(old):
                result[field] = seg
        return result

    def __extract_logic_text(self, text: str):
        raw = (text or "").strip()
        if not raw:
            return ""
        # 优先提取显式“逻辑/逻辑描述/程序逻辑”段
        logic_re = re.compile(rf"{self.SECTION_PREFIX_RE}(程序逻辑|逻辑描述|逻辑)(?:描述)?\s*[：:]?")
        logic_hit = logic_re.search(raw)
        # 输入/输出/接口段起点（用于截断逻辑段）
        io_re = re.compile(rf"{self.SECTION_PREFIX_RE}(输入项|输出项|接口)(?:描述)?\s*[：:]?")
        io_hit = io_re.search(raw)

        if logic_hit:
            start = logic_hit.end()
            end = io_hit.start() if io_hit and io_hit.start() > start else len(raw)
            logic_txt = raw[start:end].strip(" \t\r\n:：;；，,。")
        else:
            # 没有显式逻辑标签时，取输入/输出/接口标签之前的前置文本
            end = io_hit.start() if io_hit else len(raw)
            logic_txt = raw[:end].strip(" \t\r\n:：;；，,。")

        # 清理常见编号前缀残留，如 "(4)"、"4."，并过滤占位值
        logic_txt = re.sub(rf"^{self.SECTION_PREFIX_RE}", "", logic_txt).strip()
        logic_txt = re.sub(rf"\s*{self.SECTION_PREFIX_RE}$", "", logic_txt).strip()
        # 图题/占位值不作为逻辑描述
        if re.match(r"^\s*(?:图|figure)\s*\d+[\s、.．:：-]*", logic_txt, re.I):
            return ""
        if self.__is_placeholder(logic_txt):
            return ""
        return logic_txt

    def __extract_tagged_sections_under_node(self, node: SdsNodeForm):
        payload = {}

        def walk(nodes):
            nonlocal payload
            for n in nodes or []:
                text = (getattr(n, "text", "") or "").strip()
                if text:
                    payload = self.__merge_values(payload, self.__extract_tagged_sections_from_text(text))
                walk(getattr(n, "children", None) or [])

        walk([node])
        return payload

    @staticmethod
    def __extract_image_url_from_text(text: str):
        raw = (text or "").strip()
        if not raw:
            return ""
        md_img_re = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
        html_img_re = re.compile(r"<img[^>]+src=['\"]([^'\"]+)['\"]", re.I)
        data_url_re = re.compile(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)")
        path_re = re.compile(r"((?:https?://\S+|(?:/)?data\.trace/\S+))", re.I)
        for regex in [md_img_re, html_img_re, data_url_re, path_re]:
            matched = regex.search(raw)
            if matched:
                return (matched.group(1) or "").strip()
        return ""

    @staticmethod
    def __normalize_img_url(url: str):
        txt = (url or "").strip()
        if not txt:
            return ""
        if txt.startswith("http://") or txt.startswith("https://") or txt.startswith("data:"):
            return txt
        if txt.startswith("/data.trace/"):
            return txt
        if txt.startswith("data.trace/"):
            return "/" + txt
        return txt

    def __extract_first_image_under_node(self, node: SdsNodeForm):
        image_url = ""

        def walk(nodes):
            nonlocal image_url
            if image_url:
                return
            for n in nodes or []:
                img_url = (getattr(n, "img_url", None) or "").strip()
                if img_url and img_url not in ["-", "/"]:
                    image_url = img_url
                    return
                text = (getattr(n, "text", None) or "").strip()
                if text:
                    text_img = self.__extract_image_url_from_text(text)
                    if text_img:
                        image_url = text_img
                        return
                table = getattr(n, "table", None)
                if table:
                    for row in getattr(table, "rows", None) or []:
                        for val in (row or {}).values():
                            text_img = self.__extract_image_url_from_text(str(val or ""))
                            if text_img:
                                image_url = text_img
                                return
                    for row_cells in getattr(table, "cells", None) or []:
                        for cell in row_cells or []:
                            text_img = self.__extract_image_url_from_text(getattr(cell, "value", "") or "")
                            if text_img:
                                image_url = text_img
                                return
                walk(getattr(n, "children", None) or [])
                if image_url:
                    return

        walk([node])
        return image_url

    def __extract_logic_image_under_node(self, node: SdsNodeForm):
        logic_nodes = []

        def collect(nodes):
            for n in nodes or []:
                if self.__detect_field(n) == "logic_txt":
                    logic_nodes.append(n)
                collect(getattr(n, "children", None) or [])

        collect([node])
        for logic_node in logic_nodes:
            logic_img = self.__extract_first_image_under_node(logic_node)
            if logic_img:
                return logic_img
        return self.__extract_first_image_under_node(node)

    def __pick_named_logic_image(self, nodes: List[SdsNodeForm], req: SrsReq, row_srsreqd: SrsReqd, target_code: str):
        # 通过“需求/代码名称 + SDS编号”在命中节点范围内找图，优先命中“程序逻辑”相关图片
        names = []
        for txt in [getattr(row_srsreqd, "name", None), req.sub_function, req.function, req.module]:
            n = self.__normalize_name(txt)
            if n and n not in names:
                names.append(n)
        code_norm = self.__normalize_name(target_code)
        require_name_match = len(names) > 0

        best_logic = ""
        best_name = ""
        best_code = ""

        def walk(node_list: List[SdsNodeForm]):
            nonlocal best_logic, best_name, best_code
            for node in node_list or []:
                img = self.__extract_first_image_under_node(node)
                if not img:
                    walk(getattr(node, "children", None) or [])
                    continue
                merged = self.__normalize_name(
                    f"{getattr(node, 'title', '')}{getattr(node, 'label', '')}{getattr(node, 'text', '')}"
                )
                if merged:
                    has_logic = ("程序逻辑" in merged) or ("逻辑" in merged)
                    has_name = any(name and name in merged for name in names)
                    has_code = bool(code_norm and code_norm in merged)
                    # 有需求名称时，必须按名称命中，避免同 SDS 编码下串到其他需求图片
                    if require_name_match:
                        if (has_logic and has_name) and not best_logic:
                            best_logic = img
                        elif has_name and not best_name:
                            best_name = img
                        # 名称命中模式下不接受仅 code 命中
                    elif (has_logic and (has_name or has_code)) and not best_logic:
                        best_logic = img
                    elif (has_name or has_code) and not best_name:
                        best_name = img
                    elif has_code and not best_code:
                        best_code = img
                walk(getattr(node, "children", None) or [])

        walk(nodes or [])
        return best_logic or best_name or best_code

    def __find_best_req_node(self, tree: List[SdsNodeForm], req: SrsReq, row_srsreqd: SrsReqd):
        # 优先用“需求名称/子功能/功能”精确匹配，模块名仅作为最后兜底，避免串到相邻功能点
        primary_names = []
        for txt in [getattr(row_srsreqd, "name", None), req.sub_function, req.function]:
            n = self.__normalize_name(txt)
            if n and n not in primary_names:
                primary_names.append(n)
        fallback_names = []
        for txt in [req.module]:
            n = self.__normalize_name(txt)
            if n and n not in fallback_names:
                fallback_names.append(n)
        if not primary_names and not fallback_names:
            return None
        best_node = None
        best_score = -1

        def score_node(node: SdsNodeForm, merged: str, exact: bool):
            score = 0
            # exact 远高于 fuzzy，避免“安装包”这类通用词把节点串走
            score += 2000 if exact else 100
            title_label = f"{getattr(node, 'title', '')}{getattr(node, 'label', '')}"
            if "接口" not in title_label:
                score += 20
            # 同名候选中优先选“自身/子树有图”的节点（如 7.6.1 用户登录），避免命中无图的接口节点
            if self.__extract_logic_image_under_node(node):
                score += 50
            return score

        def walk(nodes):
            nonlocal best_node, best_score
            for node in nodes or []:
                merged = self.__normalize_name(f"{getattr(node, 'title', '')}{getattr(node, 'label', '')}")
                if merged:
                    is_exact_primary = any(merged == name for name in primary_names)
                    is_fuzzy_primary = any(len(name) >= 2 and name in merged for name in primary_names)
                    is_exact_fallback = any(merged == name for name in fallback_names)
                    is_fuzzy_fallback = any(len(name) >= 2 and name in merged for name in fallback_names)
                    if is_exact_primary or is_fuzzy_primary:
                        cur_score = score_node(node, merged, is_exact_primary) + 500
                        if cur_score > best_score:
                            best_score = cur_score
                            best_node = node
                    elif is_exact_fallback or is_fuzzy_fallback:
                        cur_score = score_node(node, merged, is_exact_fallback)
                        if cur_score > best_score:
                            best_score = cur_score
                            best_node = node
                walk(getattr(node, "children", None) or [])

        walk(tree or [])
        return best_node

    def __extract_imported_fields(self, tree: List[SdsNodeForm], req: SrsReq, row_srsreqd: SrsReqd):
        if not tree:
            return {}

        target_code = self.__to_sds_code(req.code)
        by_code = {}
        code_nodes = []

        def walk_by_code(nodes, current_code=""):
            for node in nodes or []:
                node_code = self.__normalize_code(getattr(node, "sds_code", "") or "")
                active_code = node_code or current_code
                if active_code == target_code:
                    code_nodes.append(node)
                field = self.__detect_field(node)
                text = (getattr(node, "text", "") or "").strip()
                if active_code == target_code and field and text:
                    value = self.__extract_logic_text(text) if field == "logic_txt" else text
                    old = by_code.get(field, "")
                    if value and (not old or len(value) > len(old)):
                        by_code[field] = value
                walk_by_code(getattr(node, "children", None) or [], active_code)

        walk_by_code(tree)
        for node in code_nodes:
            by_code = self.__merge_values(by_code, self.__extract_tagged_sections_under_node(node))
        by_code_img = ""
        for node in code_nodes:
            by_code_img = self.__extract_logic_image_under_node(node)
            if by_code_img:
                break

        # 优先在 SDS 编码命中的节点范围内按需求/代码名称定位，避免串到其他模块
        req_node = self.__find_best_req_node(code_nodes or tree, req, row_srsreqd)
        named_img = ""
        if req_node:
            # 严格限定到当前需求节点子树，避免“关于”兜到其他需求图片
            named_img = self.__pick_named_logic_image([req_node], req, row_srsreqd, target_code)
        elif code_nodes:
            named_img = self.__pick_named_logic_image(code_nodes, req, row_srsreqd, target_code)
        if not req_node:
            if named_img:
                by_code["logic_img"] = named_img
            if by_code_img:
                by_code["logic_img"] = by_code_img
            return by_code

        by_name = self.__extract_payload_under_node(req_node)
        by_name = self.__merge_values(by_name, self.__extract_tagged_sections_under_node(req_node))
        by_name_img = self.__extract_logic_image_under_node(req_node)
        if by_name_img:
            by_name["logic_img"] = by_name_img
        # 以 SDS 编码命中的内容为主，名称命中作为补充
        merged = self.__merge_values(by_code, by_name)
        # 已命中当前需求节点时，仅使用该节点内命中的图，避免串到同章节其他需求的图
        if by_name_img:
            merged["logic_img"] = by_name_img
        elif named_img:
            merged["logic_img"] = named_img
        return merged

    @staticmethod
    def __has_effective_sds_content(tree: List[SdsNodeForm]):
        # 仅有模板节点（标题为空内容）不应视为“已导入详细设计”
        stack = list(tree or [])
        while stack:
            node = stack.pop()
            text = (getattr(node, "text", "") or "").strip()
            sds_code = (getattr(node, "sds_code", "") or "").strip()
            img_url = (getattr(node, "img_url", "") or "").strip()
            if text or sds_code or img_url:
                return True
            stack.extend(getattr(node, "children", None) or [])
        return False

    def __split_mixed_io_interface(self, values: dict):
        result = dict(values or {})
        fields = ["intput", "output", "interface"]
        marker_map = {"输入项": "intput", "输出项": "output", "接口": "interface"}
        expected_marker = {"intput": "输入项", "output": "输出项", "interface": "接口"}
        marker_re = re.compile(r"(输入项|输出项|接口)(?:描述)?\s*[：:]?")

        for src_field in fields:
            raw = (result.get(src_field) or "").strip()
            if not raw:
                continue
            hits = list(marker_re.finditer(raw))
            if not hits:
                continue

            # 单标签且标签和当前字段一致：视为正常文案，不做迁移
            if len(hits) == 1 and hits[0].group(1) == expected_marker.get(src_field):
                continue

            # 触发拆分：先清空来源字段，再按标签回填
            result[src_field] = ""
            for idx, hit in enumerate(hits):
                marker = hit.group(1)
                target = marker_map.get(marker)
                if not target:
                    continue
                start = hit.end()
                end = hits[idx + 1].start() if idx + 1 < len(hits) else len(raw)
                seg = raw[start:end].strip(" \t\r\n:：;；，,。")
                if not seg:
                    continue
                old = (result.get(target) or "").strip()
                if (not old) or len(seg) > len(old):
                    result[target] = seg
        return result

    
    async def update_sds_reqd(self, form: SdsReqdForm, new_imgs: List[Any] = None, new_logics: List[LogicForm] = None, alt_logics: List[LogicForm] = None):
        try:
            row_reqd = db.session.execute(select(SdsReqd).where(SdsReqd.id == form.id)).scalars().first()
            if not row_reqd:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            
            for idx, alt_logic in enumerate(alt_logics or []):
                row = db.session.execute(select(Logic).where(Logic.id == alt_logic.id)).scalars().first()
                if not row:
                    continue
                row.txt = alt_logic.txt
            
            for idx, new_img in enumerate(new_imgs or []):
                new_logic = new_logics[idx] if idx < len(new_logics or []) else LogicForm()
                row = Logic(**new_logic.dict())
                row.reqd_id = row_reqd.id
                row.filename = new_img.filename
                db.session.add(row)
                db.session.flush()
                _, img_url = await save_file("sds_reqd_logic", row.id, new_img)
                row.img_url = img_url

            for key, value in form.dict().items():
                if key == "id":
                    continue
                setattr(row_reqd, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_sds_logic(self, logic_id: int):
        sql = delete(Logic).where(Logic.id == logic_id)
        db.session.execute(sql)
        db.session.commit()
        return Resp.resp_ok()
    
    def __resort_rows(self, rows: List[Tuple[SdsReqd, SrsReq, SrsReqd, SrsType, SdsDoc, SrsDoc, Product]]):
        def parse_heading(value: str):
            matched = re.match(r"^\s*(\d+(?:\.\d+)*)", str(value or "").strip())
            return matched.group(1) if matched else ""

        def heading_sort_key(value: str):
            heading = parse_heading(value)
            if not heading:
                return (sys.maxsize,)
            return tuple(int(part) for part in heading.split("."))

        doc_ids = list({row_sdsdoc.id for _, _, _, _, row_sdsdoc, _, _ in rows if row_sdsdoc})
        req_ids = list({row_req.id for _, row_req, _, _, _, _, _ in rows if row_req})
        position_by_sds_code: Dict[Tuple[int, str], Tuple[int, ...]] = {}
        if doc_ids:
            node_rows = db.session.execute(
                select(SdsNode.doc_id, SdsNode.sds_code, SdsNode.title)
                .where(SdsNode.doc_id.in_(doc_ids), SdsNode.sds_code.isnot(None))
            ).all()
            for node_doc_id, sds_code, title in node_rows:
                code = self.__normalize_code(sds_code)
                pos_key = heading_sort_key(title)
                if not code or pos_key == (sys.maxsize,):
                    continue
                key = (node_doc_id, code)
                if key not in position_by_sds_code or pos_key < position_by_sds_code[key]:
                    position_by_sds_code[key] = pos_key

        position_by_req: Dict[Tuple[int, int], Tuple[int, ...]] = {}
        if doc_ids and req_ids:
            trace_rows = db.session.execute(
                select(SdsTrace.doc_id, SdsTrace.req_id, SdsTrace.location, SdsTrace.sds_code)
                .where(SdsTrace.doc_id.in_(doc_ids), SdsTrace.req_id.in_(req_ids))
            ).all()
            for trace_doc_id, trace_req_id, location, sds_code in trace_rows:
                pos_key = heading_sort_key(location)
                if pos_key == (sys.maxsize,):
                    for code in str(sds_code or "").replace("\r", "").split("\n"):
                        pos_key = position_by_sds_code.get((trace_doc_id, self.__normalize_code(code))) or (sys.maxsize,)
                        if pos_key != (sys.maxsize,):
                            break
                if pos_key == (sys.maxsize,):
                    continue
                key = (trace_doc_id, trace_req_id)
                if key not in position_by_req or pos_key < position_by_req[key]:
                    position_by_req[key] = pos_key

        sorted_rows = []
        for row_reqd, row_req, row_srsreqd, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            type_id = row_type.id if row_type else sys.maxsize
            type_id = 0 if row_req.type_code == "1" else type_id
            position_key = (
                position_by_req.get((row_sdsdoc.id, row_req.id))
                or position_by_sds_code.get((row_sdsdoc.id, self.__to_sds_code(row_req.code)))
                or (sys.maxsize,)
            )
            key = (-row_sdsdoc.id, position_key, type_id, row_req.code)
            sorted_rows.append((key, (row_reqd, row_req, row_srsreqd, row_type, row_sdsdoc, row_srsdoc, row_product)))
        sorted_rows.sort(key=lambda x: x[0])

        exist_codes = set()
        filtered_rows = []
        for row in sorted_rows:
            row_reqd, row_req, *_ = row[1]
            ucode = f"{getattr(row_reqd, 'doc_id', '')}_{getattr(row_req, 'id', '')}"
            if ucode not in exist_codes:
                exist_codes.add(ucode)
                filtered_rows.append(row[1])

        return filtered_rows

    def __ensure_sds_reqd_rows(self, prod_id: int = None, doc_id: int = None):
        if not prod_id and not doc_id:
            return
        try:
            sql_docs = select(SdsDoc.id, SdsDoc.srsdoc_id).join(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id)
            if doc_id:
                sql_docs = sql_docs.where(SdsDoc.id == doc_id)
            if prod_id:
                sql_docs = sql_docs.where(SrsDoc.product_id == prod_id)
            docs = db.session.execute(sql_docs).all()
            for sds_doc_id, srs_doc_id in docs:
                reqs = db.session.execute(
                    select(SrsReq.id).where(SrsReq.doc_id == srs_doc_id, SrsReq.type_code != "reqd")
                ).all()
                if not reqs:
                    continue
                values = [dict(doc_id=sds_doc_id, req_id=req_id) for (req_id,) in reqs]
                db.session.execute(pg_insert(SdsReqd).values(values).on_conflict_do_nothing())
            db.session.commit()
        except Exception:
            logger.exception("ensure_sds_reqd_rows_failed")
            db.session.rollback()


    async def list_sds_reqd(self, op_user: UserObj, prod_id: int = None, doc_id: int = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 
        self.__ensure_sds_reqd_rows(prod_id=prod_id, doc_id=doc_id)

        sql = select(SdsReqd, SrsReq, SrsReqd, SrsType, SdsDoc, SrsDoc, Product)
        sql = sql.join(SrsReq, SdsReqd.req_id == SrsReq.id)
        sql = sql.outerjoin(SrsReqd,  SrsReq.id == SrsReqd.req_id)
        sql = sql.outerjoin(SrsType, SrsReq.type_code == SrsType.type_code)
        sql = sql.outerjoin(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.outerjoin(Product, SrsDoc.product_id == Product.id)
        sql = sql.where(SdsReqd.doc_id == SdsDoc.id).where(SdsDoc.srsdoc_id == SrsDoc.id)
        sql = sql.where(or_(SrsType.doc_id == SrsReq.doc_id, SrsReq.type_code.in_(["1", "2"])))
        if prod_id:
            sql = sql.where(Product.id == prod_id)
        if doc_id:
            sql = sql.where(SdsDoc.id == doc_id)
        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))

        sql = sql.order_by(desc(SdsDoc.id), SrsReq.code)
        rows: List[Tuple[SdsReqd, SrsReq, SrsReqd, SrsType, SdsDoc, SrsDoc, Product]] = db.session.execute(sql).all()
        rows = self.__resort_rows(rows)
        total = len(rows)
        rows = rows[page_size * page_index: page_size * (page_index + 1)]
        doc_ids = list(set([row_sdsdoc.id for _, _, _, _, row_sdsdoc, _, _ in rows]))
        req_ids = list(set([row_req.id for _, row_req, _, _, _, _, _ in rows if row_req]))
        doc_trees = self.__query_doc_tree(doc_ids)
        doc_has_effective_content = {doc_id: self.__has_effective_sds_content(tree) for doc_id, tree in doc_trees.items()}
        srs_doc_ids = list(set([row_srsdoc.id for _, _, _, _, _, row_srsdoc, _ in rows if row_srsdoc]))
        srs_reqd_fallback = {}
        for srs_doc_id in srs_doc_ids:
            try:
                resp = await srsreqd_serv.list_srs_reqd(doc_id=srs_doc_id, page_size=5000)
                for item in (resp.data.rows or []):
                    req_id = getattr(item, "req_id", None)
                    if req_id:
                        srs_reqd_fallback[req_id] = item
            except Exception:
                logger.exception("query_srs_reqd_fallback_failed: %s", srs_doc_id)
        reqd_ids = list(set([row_reqd.id for row_reqd, *_ in rows if getattr(row_reqd, "id", None)]))
        logic_img_by_reqd_id = {}
        if reqd_ids:
            logic_rows: List[Logic] = db.session.execute(
                select(Logic).where(Logic.reqd_id.in_(reqd_ids)).order_by(desc(Logic.id))
            ).scalars().all()
            for logic_row in logic_rows:
                reqd_id = getattr(logic_row, "reqd_id", None)
                if not reqd_id or reqd_id in logic_img_by_reqd_id:
                    continue
                logic_img = self.__normalize_img_url(getattr(logic_row, "img_url", "") or "")
                if logic_img:
                    logic_img_by_reqd_id[reqd_id] = logic_img
        sds_code_by_req: Dict[Tuple[int, int], str] = {}
        if doc_ids and req_ids:
            trace_rows = db.session.execute(
                select(SdsTrace.doc_id, SdsTrace.req_id, SdsTrace.sds_code)
                .where(SdsTrace.doc_id.in_(doc_ids), SdsTrace.req_id.in_(req_ids))
            ).all()
            for trace_doc_id, trace_req_id, trace_sds_code in trace_rows:
                code = self.__normalize_code(trace_sds_code or "")
                if code:
                    sds_code_by_req[(trace_doc_id, trace_req_id)] = code
        objs = []
        for row_reqd, row_req, row_srsreqd, row_type, row_sdsdoc, row_srsdoc, row_product in rows:
            doc_tree = doc_trees.get(row_sdsdoc.id)
            has_imported_design = doc_has_effective_content.get(row_sdsdoc.id, False)
            values = self.__extract_imported_fields(doc_tree, row_req, row_srsreqd) if has_imported_design else {}
            fallback_srsreqd = srs_reqd_fallback.get(getattr(row_req, "id", None))
            row_srsreqd_source = row_srsreqd
            if fallback_srsreqd and not self.__has_srs_detail_content(row_srsreqd_source):
                row_srsreqd_source = fallback_srsreqd
            # 未导入详细设计时，才允许使用历史/手工值兜底
            if not has_imported_design:
                for field in ["overview", "func_detail", "logic_txt", "intput", "output", "interface"]:
                    cur_val = (getattr(row_reqd, field, None) or "").strip()
                    if cur_val and not values.get(field):
                        values[field] = cur_val
            values = self.__split_mixed_io_interface(values)

            obj = SdsReqdObj(**row_reqd.dict())
            obj.srs_code = row_req.code
            obj.sds_code = sds_code_by_req.get((row_sdsdoc.id, row_req.id)) or self.__to_sds_code(row_req.code)
            srs_flow_text = self.__compose_srs_func_detail(row_srsreqd_source)
            srs_overview = (getattr(row_srsreqd_source, "overview", None) or "").strip() if row_srsreqd_source else ""
            obj.name = self.__pick_req_name(row_req, getattr(row_srsreqd_source, "name", None))
            if row_srsreqd_source:
                if has_imported_design:
                    # 已导入详细设计：优先展示详细设计解析结果，解析不到时回退到需求列表内容
                    obj.overview = values.get("overview") or srs_overview
                    obj.func_detail = values.get("func_detail") or srs_flow_text
                    obj.logic_txt = values.get("logic_txt") or ""
                    obj.intput = values.get("intput") or ""
                    obj.output = values.get("output") or ""
                    obj.interface = values.get("interface") or ""
                else:
                    # 未导入详细设计：内容按SRS来源展示
                    obj.overview = (getattr(row_srsreqd_source, "overview", None) or "").strip()
                    obj.func_detail = srs_flow_text
                    obj.logic_txt = row_reqd.logic_txt
                    obj.intput = row_reqd.intput
                    obj.output = row_reqd.output
                    obj.interface = row_reqd.interface
            else:
                if has_imported_design:
                    obj.overview = values.get("overview") or ""
                    obj.func_detail = values.get("func_detail") or ""
                    obj.logic_txt = values.get("logic_txt") or ""
                    obj.intput = values.get("intput") or ""
                    obj.output = values.get("output") or ""
                    obj.interface = values.get("interface") or ""
                else:
                    # 未导入详细设计：优先使用SRS需求详细（需求概述/触发器/工作流），无数据时保留手工值
                    obj.overview = values.get("overview") or row_reqd.overview or ""
                    obj.func_detail = values.get("func_detail") or row_reqd.func_detail or ""
                    obj.logic_txt = values.get("logic_txt") or row_reqd.logic_txt
                    obj.intput = values.get("intput") or row_reqd.intput
                    obj.output = values.get("output") or row_reqd.output
                    obj.interface = values.get("interface") or row_reqd.interface
            obj.module = row_req.module
            obj.function = row_req.function
            obj.sub_function = row_req.sub_function
            obj.type_code = row_req.type_code
            if row_srsdoc:
                obj.srsdoc_version = row_srsdoc.version
            if row_sdsdoc:
                obj.sdsdoc_version = row_sdsdoc.version
            if row_product:
                obj.product_name = row_product.name
                obj.product_version = row_product.full_version
            imported_logic_img = self.__normalize_img_url(values.get("logic_img") or "")
            fallback_logic_img = logic_img_by_reqd_id.get(getattr(row_reqd, "id", None), "")
            # 需求编辑页手动上传的逻辑图优先级更高，应覆盖自动抽取的图
            obj.logic_img = fallback_logic_img or imported_logic_img or "/"
            # 若仅识别到图题文字（如“图23 退出登录”），不作为逻辑文本展示
            if re.match(r"^\s*(?:图|figure)\s*\d+[\s、.．:：-]*", (obj.logic_txt or "").strip(), re.I):
                obj.logic_txt = ""
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
        
    async def get_sds_reqd(self, id: int):
        sql = select(SdsReqd, SrsReq, SrsReqd)
        sql = sql.join(SrsReq, SdsReqd.req_id == SrsReq.id)
        sql = sql.outerjoin(SrsReqd, SrsReq.id == SrsReqd.req_id)
        sql = sql.where(SdsReqd.id == id)
        row_reqd, row_req, row_srsreqd = db.session.execute(sql).first() or (None, None, None)
        if not row_reqd:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        
        sql = select(Logic).where(Logic.reqd_id == id).order_by(Logic.id)
        rows: List[Logic] = db.session.execute(sql).scalars().all()
        logics = [LogicForm(**row.dict()) for row in rows]

        # 与列表页保持一致：详情也使用“导入SDS优先，否则SRS回填”的同一套取值逻辑
        row_sdsdoc, row_srsdoc = db.session.execute(
            select(SdsDoc, SrsDoc).outerjoin(SrsDoc, SdsDoc.srsdoc_id == SrsDoc.id).where(SdsDoc.id == row_reqd.doc_id)
        ).first() or (None, None)
        doc_tree = []
        if row_sdsdoc:
            doc_tree = self.__query_doc_tree([row_sdsdoc.id]).get(row_sdsdoc.id) or []
        has_imported_design = self.__has_effective_sds_content(doc_tree)

        row_srsreqd_source = row_srsreqd
        if row_srsdoc:
            try:
                resp = await srsreqd_serv.list_srs_reqd(doc_id=row_srsdoc.id, page_size=5000)
                for item in (resp.data.rows or []):
                    if getattr(item, "req_id", None) == getattr(row_req, "id", None):
                        if not self.__has_srs_detail_content(row_srsreqd_source):
                            row_srsreqd_source = item
                        break
            except Exception:
                logger.exception("get_sds_reqd_query_srs_reqd_fallback_failed: %s", row_srsdoc.id)

        values = self.__extract_imported_fields(doc_tree, row_req, row_srsreqd_source) if has_imported_design else {}
        if not has_imported_design:
            for field in ["overview", "func_detail", "logic_txt", "intput", "output", "interface"]:
                cur_val = (getattr(row_reqd, field, None) or "").strip()
                if cur_val and not values.get(field):
                    values[field] = cur_val
        values = self.__split_mixed_io_interface(values)

        obj = SdsReqdObj(**row_reqd.dict(), srs_code=row_req.code)
        obj.logics = logics
        obj.name = self.__pick_req_name(row_req, getattr(row_srsreqd_source, "name", None))
        fallback_logic_img = ""
        for logic in reversed(logics or []):
            img = self.__normalize_img_url(getattr(logic, "img_url", "") or "")
            if img:
                fallback_logic_img = img
                break
        srs_overview = (getattr(row_srsreqd_source, "overview", None) or "").strip() if row_srsreqd_source else ""
        srs_flow_text = self.__compose_srs_func_detail(row_srsreqd_source)
        if has_imported_design:
            obj.overview = values.get("overview") or srs_overview
            obj.func_detail = values.get("func_detail") or srs_flow_text
            obj.logic_txt = values.get("logic_txt") or ""
            obj.intput = values.get("intput") or ""
            obj.output = values.get("output") or ""
            obj.interface = values.get("interface") or ""
            obj.logic_img = fallback_logic_img or self.__normalize_img_url(values.get("logic_img") or "")
        else:
            obj.overview = srs_overview or row_reqd.overview or ""
            obj.func_detail = srs_flow_text or row_reqd.func_detail or ""
            obj.logic_txt = values.get("logic_txt") or row_reqd.logic_txt or ""
            obj.intput = values.get("intput") or row_reqd.intput or ""
            obj.output = values.get("output") or row_reqd.output or ""
            obj.interface = values.get("interface") or row_reqd.interface or ""
            obj.logic_img = fallback_logic_img or self.__normalize_img_url(values.get("logic_img") or row_reqd.logic_img or "")
        obj.module = row_req.module
        obj.function = row_req.function
        obj.sub_function = row_req.sub_function
        obj.type_code = row_req.type_code
        return Resp.resp_ok(data=obj)
    