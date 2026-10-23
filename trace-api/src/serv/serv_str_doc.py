#!/usr/bin/env python
# encoding: utf-8

# 软件测试报告服务层（开发文件，PDP 风格章节树）。默认内容取自 src-res/str_default_content.json。

import base64
import copy
import json
import logging
import os
import re
from io import BytesIO
from typing import List

from sqlalchemy import delete, func, select
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.product import Product
from ..model.str_doc import StrDoc
from ..model.doc_file import DocFile
from ..model.prod_dhf import ProdDhf
from ..model.project_member import ProjectMember
from ..model.test_set import TestSet
from ..model.test_case import TestCase
from ..model.srs_doc import SrsDoc
from ..model.srs_req import SrsReq
from ..model.sds_doc import SdsDoc
from ..model.sds_trace import SdsTrace
from ..obj import Page, Resp
from ..obj.tobj_role import Roles
from ..obj.vobj_user import UserObj
from ..obj.tobj_str_doc import StrDocForm
from ..obj.vobj_str_doc import StrDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from . import serv_review_util
from .serv_utils import new_version, sync_file_no_version
from .serv_utils import docx_util
from .serv_utils.doc_blocks import emit_free_body, has_free_body_markers, write_body_image
from .serv_product import product_scope_filter

logger = logging.getLogger(__name__)

_DEFAULT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "src-res", "str_default_content.json")
try:
    with open(_DEFAULT_FILE, encoding="utf-8") as _f:
        DEFAULT_STR_CONTENT = json.load(_f)
except Exception:
    DEFAULT_STR_CONTENT = {"sections": []}

# 模板基准产品名（用于全文替换为当前产品名）。
BASE_NAME = "InferOperate Suite"
DOC_NAME = "软件测试报告"
DOC_KEY = "str"


class Server(object):

    def __normalize_node(self, node):
        if not isinstance(node, dict):
            return {"title": str(node or ""), "body": "", "tables": [], "children": []}
        result = dict(node)
        result["title"] = str(result.get("title") or "")
        result["body"] = str(result.get("body") or "")
        tables = result.get("tables")
        if not isinstance(tables, list):
            tables = []
        norm_tables = []
        for table in tables:
            if isinstance(table, list):
                norm_tables.append([[str(c) if c is not None else "" for c in (row or [])] for row in table if isinstance(row, list)])
        result["tables"] = norm_tables
        # 兼容旧数据：如果有 blocks（之前改造残留），把 blocks 中的 table/text 提取回 tables/body
        blocks = result.get("blocks")
        if isinstance(blocks, list) and blocks and not result["body"] and not norm_tables:
            parts = []
            tbls = []
            for blk in blocks:
                if not isinstance(blk, dict):
                    continue
                btype = blk.get("type")
                if btype == "text" and blk.get("text"):
                    parts.append(str(blk["text"]))
                elif btype == "table" and blk.get("table"):
                    tbl = blk["table"]
                    tbls.append([[str(c) if c is not None else "" for c in (row or [])] for row in tbl if isinstance(row, list)])
                    parts.append("见下表")
            if parts:
                result["body"] = "\n".join(parts)
            if tbls:
                result["tables"] = tbls
            result.pop("blocks", None)
        elif "blocks" in result:
            result.pop("blocks", None)
        children = result.get("children")
        result["children"] = [self.__normalize_node(c) for c in children] if isinstance(children, list) else []
        # 测试项列表：stages 与当前子章同步，删除子章保存后不再按旧 stages 补回
        if result.get("ref_type") == "test_items":
            result["stages"] = [
                str(ch.get("title") or "").strip()
                for ch in (result.get("children") or [])
                if isinstance(ch, dict) and str(ch.get("title") or "").strip()
            ]
        return result

    def __normalize_content(self, content):
        if not isinstance(content, dict) or not isinstance(content.get("sections"), list):
            return copy.deepcopy(DEFAULT_STR_CONTENT)
        return {"sections": [self.__normalize_node(s) for s in content["sections"]]}

    def __replace_name(self, node, base, name, skip_titles=None):
        if not name or base == name:
            return
        if skip_titles and str(node.get("title") or "").strip() in skip_titles:
            return
        if node.get("body"):
            node["body"] = node["body"].replace(base, name)
        for tbl in (node.get("tables") or []):
            for row in tbl:
                for i in range(len(row)):
                    if isinstance(row[i], str) and base in row[i]:
                        row[i] = row[i].replace(base, name)
        for c in (node.get("children") or []):
            self.__replace_name(c, base, name, skip_titles=skip_titles)

    def __dhf_file_no(self, prod_id):
        if not prod_id:
            return ""
        row = db.session.execute(
            select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.name == DOC_NAME).order_by(ProdDhf.id.asc())
        ).scalars().first()
        if not row:
            row = db.session.execute(
                select(ProdDhf).where(ProdDhf.prod_id == prod_id, ProdDhf.name.like(f"%{DOC_NAME}%")).order_by(ProdDhf.id.asc())
            ).scalars().first()
        return (row.code or "").strip() if row and row.code else ""

    def __fill_revision(self, content, prod_id, version, force=False):
        """文件修订记录首行：修改日期←时间线「软件测试报告」；修订人=测试人员（日期规则）；批准人=研发负责人。
        修订人/批准人打开即覆盖；有时间线日期则覆盖修改日期。"""
        rev_date = serv_review_util.cover_date(prod_id, DOC_KEY) if prod_id else ""
        reviser = "宋月" if serv_review_util._before_202509(rev_date) else "孙家旭"
        approver = ""
        if prod_id:
            members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == prod_id)).scalars().all()
            approver = next((m.name for m in members if "研发负责人" in str(m.role or "")), "")
        for s in (content.get("sections") or []):
            if s.get("ref_type") != "revision":
                continue
            tables = s.get("tables") or []
            if tables and isinstance(tables[0], list) and tables[0]:
                t = tables[0]
                cols = len(t[0]) if isinstance(t[0], list) and t[0] else 5
                while len(t) < 6:
                    t.append([""] * cols)
                if len(t) >= 2 and isinstance(t[1], list) and len(t[1]) >= 3:
                    row = t[1]
                    if force or rev_date:
                        row[0] = rev_date or ""
                    elif not str(row[0] or "").strip():
                        row[0] = rev_date
                    if force:
                        if len(row) >= 2: row[1] = str(version or "")
                        if len(row) >= 3: row[2] = "首次发布"
                    else:
                        if version and len(row) >= 2 and not str(row[1] or "").strip(): row[1] = str(version)
                        if len(row) >= 3 and not str(row[2] or "").strip(): row[2] = "首次发布"
                    if len(row) >= 4:
                        row[3] = reviser
                    if len(row) >= 5:
                        row[4] = approver
            break
        return content

    TESTITEM_HEADER = ["需求编号", "Case编号", "功能点概述", "用例个数", "是否通过", "备注"]
    TESTITEM_HEADER_UNIT = ["需求编号", "设计编号", "Case编号", "功能点概述", "用例个数", "是否通过", "备注"]

    def __srs_sds_maps(self, prod_id):
        """产品下 SRS→SDS、SDS→SRS 映射（来自 sds_trace），及本产品已有 SRS 编号集合。"""
        srs_to_sds, sds_to_srs, known_srs = {}, {}, set()
        if not prod_id:
            return srs_to_sds, sds_to_srs, known_srs
        known_rows = db.session.execute(
            select(SrsReq.code).join(SrsDoc, SrsReq.doc_id == SrsDoc.id).where(SrsDoc.product_id == prod_id)
        ).scalars().all()
        for code in known_rows:
            c = (code or "").strip()
            if c:
                known_srs.add(c)
                known_srs.add(c.upper())
        rows = db.session.execute(
            select(SrsReq.code, SdsTrace.sds_code)
            .join(SdsTrace, SdsTrace.req_id == SrsReq.id)
            .join(SdsDoc, SdsDoc.id == SdsTrace.doc_id)
            .where(SdsDoc.product_id == prod_id)
        ).all()
        for code, sds in rows:
            srs = (code or "").strip()
            raw = (sds or "").strip()
            if not srs or not raw:
                continue
            parts = [p.strip() for p in re.split(r"[\r\n]+", raw) if p and p.strip()]
            if not parts:
                continue
            if srs not in srs_to_sds:
                srs_to_sds[srs] = "\n".join(parts)
            for p in parts:
                sds_to_srs.setdefault(re.sub(r"\s+", "", p).upper(), srs)
        return srs_to_sds, sds_to_srs, known_srs

    def __if_to_srs_candidates(self, raw):
        """接口编号 SDS-IF… → SRS 候选（与需求追溯互转规则一致）。"""
        code = re.sub(r"\s+", "", str(raw or "")).upper()
        if not code.startswith("SDS-IF"):
            return []
        candidates = []
        matched = re.match(r"SDS-IF(\d+)-RUS(\d+)-\d+", code)
        if matched:
            candidates.append(f"SRS-RUS{matched.group(1)}-{matched.group(2)}")
        matched2 = re.match(r"SDS-IF\d+-([A-Z0-9]+-\d+)$", code)
        if matched2:
            candidates.append(f"SRS-{matched2.group(1)}")
            seg = matched2.group(1)
            seg_parts = seg.split("-")
            if len(seg_parts) == 2:
                left, _right = seg_parts
                m3 = re.match(r"^([A-Z]+)(\d{3,})(\d)$", left)
                if m3:
                    req_group = str(m3.group(3) or "").zfill(3)
                    candidates.append(f"SRS-{m3.group(1)}{m3.group(2)}-{req_group}")
        # 数值压缩还原：body = 主号*10+次号，且主号末两位等于 IF 号。
        # SDS-IF00-RCN3010-001 -> SRS-RCN300-010；SDS-IF00-RCH2010-001 -> SRS-RCH200-010。
        matched_num = re.match(r"^SDS-IF(\d+)-([A-Z]+)(\d+)-\d+$", code)
        if matched_num:
            if_int = int(matched_num.group(1))
            pref = matched_num.group(2)
            compressed = int(matched_num.group(3))
            for minor in range(1, 1000):
                if compressed < minor:
                    break
                if (compressed - minor) % 10 != 0:
                    continue
                major = (compressed - minor) // 10
                if major % 100 != if_int:
                    continue
                candidates.append(f"SRS-{pref}{major}-{str(minor).zfill(3)}")
                break
        seen, uniq = set(), []
        for item in candidates:
            if item and item not in seen:
                seen.add(item)
                uniq.append(item)
        return uniq

    def __pick_srs_from_if(self, raw, known_srs):
        """从接口编号解析 SRS：本产品已有编号里，优先数值还原（候选末尾），否则取最后一条。"""
        cands = self.__if_to_srs_candidates(raw)
        if not cands:
            return ""
        known = known_srs or set()
        chosen = ""
        for c in cands:
            hit = ""
            for k in known:
                if str(k).upper() == c.upper() and str(k).upper().startswith("SRS"):
                    hit = k if str(k).startswith("SRS") else c
                    break
            if not hit and (c in known or c.upper() in known):
                hit = c
            if hit:
                chosen = hit
        if chosen:
            return chosen
        return cands[-1]

    def __split_req_design(self, raw, srs_to_sds, sds_to_srs, known_srs=None):
        """拆分需求编号与设计编号；单元测试表专用。"""
        raw = (raw or "").strip()
        if not raw:
            return "", ""
        key = re.sub(r"\s+", "", raw).upper()
        if key.startswith("SDS-IF"):
            srs = sds_to_srs.get(key, "") or self.__pick_srs_from_if(raw, known_srs)
            return srs, raw
        if key.startswith("SDS"):
            return sds_to_srs.get(key, ""), raw
        if key.startswith("SRS"):
            sds = srs_to_sds.get(raw, "") or srs_to_sds.get(key, "")
            if not sds and raw.upper().startswith("SRS"):
                sds = "SDS" + raw[3:]
            return raw, sds
        return raw, srs_to_sds.get(raw, "") or srs_to_sds.get(key, "")

    def __stage_rows(self, prod_id, stage, prev, with_design=False, srs_to_sds=None, sds_to_srs=None, known_srs=None):
        """按阶段(测试集)取用例，按功能点分组：需求编号[/设计编号]/Case编号取段/功能点/用例个数/是否通过/备注。"""
        # 同阶段多合集时仅取 create_time 最新一份，避免 A1/A2 用例重复汇总
        latest = db.session.execute(
            select(TestSet.id)
            .where(TestSet.product_id == prod_id, TestSet.stage == stage)
            .order_by(TestSet.create_time.desc(), TestSet.id.desc())
            .limit(1)
        ).scalars().first()
        if not latest:
            return []
        cases = db.session.execute(
            select(TestCase).where(TestCase.set_id == latest).order_by(TestCase.id)
        ).scalars().all()
        order, gmap = [], {}
        for c in cases:
            func = (c.function or "").strip()
            key = func or (c.code or "").strip()
            if key not in gmap:
                gmap[key] = {"func": func, "codes": [], "srs": (c.srs_code or "").strip()}
                order.append(key)
            code = (c.code or "").strip()
            if code:
                gmap[key]["codes"].append(code)
            if not gmap[key]["srs"]:
                gmap[key]["srs"] = (c.srs_code or "").strip()
        rows = []
        srs_to_sds = srs_to_sds or {}
        sds_to_srs = sds_to_srs or {}
        for key in order:
            g = gmap[key]
            cs = sorted(g["codes"])
            case_no = "" if not cs else (cs[0] if len(cs) == 1 else f"{cs[0]} 至 {cs[-1]}")
            p = prev.get(g["func"], {})
            if with_design:
                srs, sds = self.__split_req_design(g["srs"], srs_to_sds, sds_to_srs, known_srs=known_srs)
                rows.append([srs, sds, case_no, g["func"], str(len(g["codes"])), p.get("pass", "是"), p.get("note", "")])
            else:
                rows.append([g["srs"], case_no, g["func"], str(len(g["codes"])), p.get("pass", "是"), p.get("note", "")])
        return rows

    def __fill_test_items(self, content, prod_id):
        if not prod_id or not isinstance(content, dict):
            return content
        srs_to_sds, sds_to_srs, known_srs = self.__srs_sds_maps(prod_id)

        def _build_stage_child(stage, prev, old=None):
            stage = str(stage or "").strip()
            with_design = stage == "单元测试"
            header = self.TESTITEM_HEADER_UNIT if with_design else self.TESTITEM_HEADER
            grid = [list(header)] + self.__stage_rows(
                prod_id, stage, prev, with_design=with_design,
                srs_to_sds=srs_to_sds, sds_to_srs=sds_to_srs, known_srs=known_srs,
            )
            if isinstance(old, dict):
                ch = dict(old)
                ch["title"] = stage or ch.get("title") or ""
                ch["tables"] = [grid]
                ch.setdefault("children", [])
                return ch
            return {"title": stage, "body": "", "tables": [grid], "children": []}

        def walk(node):
            if node.get("ref_type") == "test_items":
                prev = {}
                for ch in (node.get("children") or []):
                    for tbl in (ch.get("tables") or []):
                        if not tbl or not isinstance(tbl[0], list):
                            continue
                        header = [str(c or "") for c in tbl[0]]
                        fi = next((i for i, h in enumerate(header) if "功能点" in h), 2)
                        pi = next((i for i, h in enumerate(header) if "是否通过" in h), -1)
                        ni = next((i for i, h in enumerate(header) if h.strip() == "备注" or "备注" in h), -1)
                        for r in (tbl or [])[1:]:
                            if not isinstance(r, list) or fi >= len(r):
                                continue
                            func = str(r[fi] or "").strip()
                            if not func:
                                continue
                            prev[func] = {
                                "pass": (str(r[pi] or "").strip() if 0 <= pi < len(r) else "") or "是",
                                "note": str(r[ni] or "").strip() if 0 <= ni < len(r) else "",
                            }
                existing = [ch for ch in (node.get("children") or []) if isinstance(ch, dict)]
                if existing:
                    # 尊重用户删除：只刷新现有子章，并把 stages 同步为当前子章标题
                    children = []
                    stages = []
                    for ch in existing:
                        stage = str(ch.get("title") or "").strip()
                        if stage:
                            stages.append(stage)
                        children.append(_build_stage_child(stage, prev, old=ch))
                    node["stages"] = stages
                    node["children"] = children
                else:
                    children = []
                    for stage in (node.get("stages") or []):
                        children.append(_build_stage_child(stage, prev))
                    node["children"] = children
                node["tables"] = []
            for ch in (node.get("children") or []):
                walk(ch)

        for s in (content.get("sections") or []):
            walk(s)
        return content

    def __fill_workload(self, content, prod_id):
        """「测试工作量」表：按任务(测试计划/测试用例设计/测试执行/测试总结)从时间线取日期，填开始/结束时间。"""
        if not prod_id or not isinstance(content, dict):
            return content
        doc_date = serv_review_util.cover_date(prod_id, DOC_KEY) or ""
        is_user = DOC_KEY == "utr"
        if is_user:
            range_kw = {"计划": ["用户测试计划"], "用例": ["用户测试用例"],
                        "执行": ["用户测试记录"], "报告": ["用户测试报告"]}
        else:
            range_kw = {"计划": ["软件测试计划", "软开测试计划"],
                        "用例": ["单元测试用例", "集成测试用例", "系统测试用例"],
                        "执行": ["单元测试记录", "集成测试记录", "系统测试记录"],
                        "报告": ["软件测试报告"]}

        def kind_of(task):
            a = str(task or "")
            if "总结" in a or "报告" in a:
                return "报告"
            if "用例" in a or "设计" in a:
                return "用例"
            if "执行" in a:
                return "执行"
            if "计划" in a:
                return "计划"
            return ""

        def _range_days(a, b):
            m1 = re.match(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", str(a or ""))
            m2 = re.match(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", str(b or ""))
            if not (m1 and m2):
                return 0
            from datetime import date as _d
            try:
                return (_d(int(m2.group(1)), int(m2.group(2)), int(m2.group(3)))
                        - _d(int(m1.group(1)), int(m1.group(2)), int(m1.group(3)))).days + 1
            except Exception:
                return 0

        def walk(node):
            for tbl in (node.get("tables") or []):
                if not tbl or not isinstance(tbl[0], list):
                    continue
                header = [str(c or "") for c in tbl[0]]
                hj = " ".join(header)
                if "开始时间" in hj and "结束时间" in hj:
                    ci_s = next((i for i, h in enumerate(header) if "开始时间" in h), 2)
                    ci_e = next((i for i, h in enumerate(header) if "结束时间" in h), 3)
                    ci_days = next((i for i, h in enumerate(header) if "天数" in h), -1)
                    for r in tbl[1:]:
                        if not isinstance(r, list):
                            continue
                        task = ""
                        for i in range(min(ci_s, len(r))):
                            v = str(r[i] or "").strip()
                            if v and v != "实际":
                                task = v
                        kind = kind_of(task)
                        start, end = ("", "")
                        if kind and kind in range_kw:
                            start, end = serv_review_util.date_range(prod_id, range_kw[kind])
                        start = start or doc_date
                        end = end or start
                        if ci_s < len(r):
                            r[ci_s] = start
                        if ci_e < len(r):
                            r[ci_e] = end
                        if 0 <= ci_days < len(r) and kind and kind in range_kw:
                            _days = serv_review_util.date_count(prod_id, range_kw[kind])
                            if _days:
                                r[ci_days] = "%d天" % _days
            for ch in (node.get("children") or []):
                walk(ch)

        for s in (content.get("sections") or []):
            walk(s)
        return content

    # Win10/Win11：每模块统一测试点；用户端：每模块单点
    COMPAT_WIN_TEST_POINTS = [
        "页面格式，字体，输入框，按钮字图片是否正常显示",
        "排版是否统一",
        "提示信息是否正常完整",
        "功能是否正常使用",
    ]
    COMPAT_CLIENT_TEST_POINTS = ["功能是否正常"]

    def __compat_kind_of_title(self, title):
        t = re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()
        if t == "用户端测试" or (t.startswith("用户端") and "测试" in t and "服务端" not in t):
            return "client"
        if "Win10" in t and "测试项" in t:
            return "win"
        if "Win11" in t and "测试项" in t:
            return "win"
        return ""

    def __compat_hdr_rows(self, tbl):
        hdr = []
        for r in (tbl or []):
            if isinstance(r, list) and r and str(r[0] or "").strip() == "测试模块":
                hdr.append(r)
            else:
                break
        return hdr

    def __rebuild_compat_module_table(self, tbl, leaves, points):
        """保留表头行，按 SRS 叶子 × 测试点模板重建数据行；结果列默认「通过」。"""
        if not isinstance(tbl, list) or not leaves or not points:
            return False
        hdr = self.__compat_hdr_rows(tbl)
        if not hdr:
            return False
        cols = max((len(r) for r in hdr if isinstance(r, list)), default=2)
        pass_tail = ["通过"] * max(0, cols - 2)
        data = []
        for leaf in leaves:
            for pt in points:
                row = [leaf, pt] + list(pass_tail)
                while len(row) < cols:
                    row.append("通过" if len(row) >= 2 else "")
                data.append(row[:cols])
        tbl[:] = [list(r) for r in hdr] + data
        return True

    def __fill_compat(self, content, prod_id, product=None):
        """兼容性测试报告附件：产品名称/版本、测试执行人(宋月/孙家旭)、测试时间自动获取；正文产品名替换。
        Win10/Win11/用户端测试表：按 SRS 叶子 + 测试点模板重建数据行。"""
        if not isinstance(content, dict):
            return content
        name = (getattr(product, "name", "") or "").strip()
        ver = (getattr(product, "full_version", "") or "").strip()
        rev = ""
        if prod_id:
            rev = serv_review_util.review_date(prod_id, ["兼容性测试", "兼容性"]) or serv_review_util.cover_date(prod_id, DOC_KEY)
        engineer = "宋月" if serv_review_util._before_202509(rev) else "孙家旭"
        pv = (name + "/" + ver) if (name and ver) else name
        srs_leaves = self.__srs_leaves(prod_id)

        def repl(s):
            s = str(s or "")
            return s.replace("InferCare RECIST", name) if name else s

        def proc(node):
            node["body"] = repl(node.get("body"))
            if node.get("body_tail"):
                node["body_tail"] = repl(node.get("body_tail"))
            title = str(node.get("title") or "")
            kind = self.__compat_kind_of_title(title)
            points = self.COMPAT_CLIENT_TEST_POINTS if kind == "client" else (
                self.COMPAT_WIN_TEST_POINTS if kind == "win" else None
            )
            for tbl in (node.get("tables") or []):
                for row in tbl:
                    if not isinstance(row, list):
                        continue
                    for i in range(len(row)):
                        row[i] = repl(row[i])
                    lab = str(row[0] or "").strip()
                    if lab in ("产品名称/版本", "产品名称", "产品名称/型号") and len(row) >= 2 and pv:
                        row[1] = pv
                    elif lab == "测试执行人" and len(row) >= 2:
                        row[1] = engineer
                    elif lab == "测试时间" and len(row) >= 2 and rev:
                        row[1] = rev
                if kind and points and srs_leaves:
                    self.__rebuild_compat_module_table(tbl, srs_leaves, points)
            for ch in (node.get("children") or []):
                proc(ch)

        for s in (content.get("sections") or []):
            if s.get("ref_type") == "attachment":
                proc(s)
        self.__sync_compat_versions(content)
        return content

    def __plain_title(self, node):
        return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str((node or {}).get("title") or "")).strip()

    def __split_version_list(self, text):
        return [p.strip() for p in re.split(r"[、,，;；\n]+", str(text or "")) if p and p.strip()]

    def __browser_header_versions(self, tbl):
        if not isinstance(tbl, list) or len(tbl) < 2 or not isinstance(tbl[1], list):
            return []
        row = tbl[1]
        if str(row[0] or "").strip() != "测试模块":
            return []
        out = []
        for cell in row[2:]:
            text = str(cell or "").strip()
            if text and text not in ("测试点", "测试模块"):
                out.append(text)
        return out

    def __paint_version_cols(self, tbl, versions, label):
        """表头两行：第 3 列起换成给定版本，列数随之增减；数据行结果列不足时补「通过」。"""
        if not versions or not isinstance(tbl, list) or len(tbl) < 2:
            return
        name_row = tbl[0] if isinstance(tbl[0], list) else []
        ver_row = tbl[1] if isinstance(tbl[1], list) else []
        if str(ver_row[0] or "").strip() != "测试模块":
            return
        head_a = list(name_row[:2])
        head_b = list(ver_row[:2])
        while len(head_a) < 2:
            head_a.append("测试模块" if not head_a else "测试点")
        while len(head_b) < 2:
            head_b.append(head_a[len(head_b)])
        tbl[0] = head_a + [label] * len(versions)
        tbl[1] = head_b + list(versions)
        for i in range(2, len(tbl)):
            row = list(tbl[i]) if isinstance(tbl[i], list) else []
            base = (row + ["", ""])[:2]
            tail = row[2:]
            pad = tail[-1] if tail else "通过"
            if len(tail) < len(versions):
                tail = tail + [pad] * (len(versions) - len(tail))
            else:
                tail = tail[:len(versions)]
            tbl[i] = base + tail

    def __sync_compat_versions(self, content):
        """测试概述的杀毒软件名称/版本写入 4.4 表头；Win10/Win11 表头浏览器版本写入测试设备详情。"""
        if not isinstance(content, dict):
            return content
        nodes = []

        def walk(node):
            if not isinstance(node, dict):
                return
            nodes.append(node)
            for child in (node.get("children") or []):
                walk(child)

        for section in (content.get("sections") or []):
            walk(section)

        overview = {}
        for node in nodes:
            if self.__plain_title(node) != "测试概述":
                continue
            for tbl in (node.get("tables") or []):
                for row in tbl:
                    if isinstance(row, list) and len(row) >= 2:
                        lab = str(row[0] or "").strip()
                        if lab in ("客户端杀毒软件名称", "客户端杀毒软件版本", "服务端杀毒软件名称", "服务端杀毒软件版本"):
                            overview[lab] = str(row[1] or "").strip()

        client_vers = self.__split_version_list(overview.get("客户端杀毒软件版本", ""))
        client_name = overview.get("客户端杀毒软件名称", "")
        server_vers = self.__split_version_list(overview.get("服务端杀毒软件版本", ""))
        server_name = overview.get("服务端杀毒软件名称", "")
        win_vers = {"win10": [], "win11": []}
        for node in nodes:
            title = self.__plain_title(node)
            tables = node.get("tables") or []
            if not tables or not isinstance(tables[0], list):
                continue
            header = tables[0][0] if tables[0] else []
            has_av = isinstance(header, list) and any("杀毒" in str(cell) for cell in header)
            if title == "用户端测试" and has_av and client_name and client_vers:
                old = str(header[2] or "") if len(header) > 2 else ""
                if "、Windows" in old or "、windows" in old.lower():
                    label = f"杀毒及设备信息({client_name}、Windows)"
                else:
                    label = f"杀毒及设备信息({client_name})"
                self.__paint_version_cols(tables[0], client_vers, label)
            elif ("服务端" in title and "测试" in title and has_av and server_name and server_vers):
                self.__paint_version_cols(tables[0], server_vers, f"杀毒信息({server_name})")
            elif "Win10" in title and "测试项" in title:
                win_vers["win10"] = self.__browser_header_versions(tables[0])
            elif "Win11" in title and "测试项" in title:
                win_vers["win11"] = self.__browser_header_versions(tables[0])

        def patch_browser(text, versions):
            if not versions or "浏览器版本" not in str(text or ""):
                return text
            line = "浏览器版本：Chrome " + "、".join(versions)
            return re.sub(r"浏览器版本：[^\n]*", line, str(text))

        for node in nodes:
            if self.__plain_title(node) != "测试设备详情":
                continue
            for tbl in (node.get("tables") or []):
                for row in tbl:
                    if not isinstance(row, list) or len(row) < 2 or str(row[0] or "").strip() != "用户端":
                        continue
                    info = str(row[1] or "")
                    if "Win11" in info or "Windows 11" in info:
                        versions = win_vers["win11"] or win_vers["win10"]
                    else:
                        versions = win_vers["win10"] or win_vers["win11"]
                    row[1] = patch_browser(info, versions)
        return content

    def __srs_leaves(self, prod_id):
        """该产品 SRS 标准需求(type_code=1)的叶子名(子功能优先，其次功能、模块)，按需求顺序。"""
        if not prod_id:
            return []
        rows = db.session.execute(
            select(SrsReq).join(SrsDoc, SrsReq.doc_id == SrsDoc.id)
            .where(SrsDoc.product_id == prod_id, SrsReq.type_code == "1").order_by(SrsReq.id)
        ).scalars().all()
        placeholders = {"", "/", "\\", "-", "--", "—", "N/A", "n/a", "无", "暂无"}
        leaves = []
        for r in rows:
            leaf = ""
            for val in (getattr(r, "sub_function", ""), getattr(r, "function", ""), getattr(r, "module", "")):
                t = str(val or "").strip()
                if t and t not in placeholders:
                    leaf = t
                    break
            if leaf:
                leaves.append(leaf)
        return leaves

    async def refill_str_compat_items(self, product_id: int, kind: str = "win"):
        """按产品 SRS 叶子 + 测试点模板生成兼容性模块表（供空章节「自动获取」）。kind=win|client。"""
        kind = str(kind or "win").strip().lower()
        if kind not in ("win", "client"):
            return Resp.resp_err(msg="kind 须为 win 或 client")
        if not product_id:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        leaves = self.__srs_leaves(product_id)
        if not leaves:
            return Resp.resp_err(msg="该产品暂无 SRS 标准需求，无法获取测试模块")
        points = self.COMPAT_CLIENT_TEST_POINTS if kind == "client" else self.COMPAT_WIN_TEST_POINTS
        # 默认列：测试模块/测试点 + 两列结果（前端会按原表列数截断或补齐）
        cols = 4 if kind == "win" else 5
        hdr = [
            ["测试模块", "测试点"] + ["结果"] * (cols - 2),
        ]
        # 与模板一致：两行表头（第二行常放版本号，此处留空由原表头保留时由前端合并）
        # API 只返回数据行；前端用原表头 + 本数据行拼接
        data = []
        pass_tail = ["通过"] * (cols - 2)
        for leaf in leaves:
            for pt in points:
                data.append([leaf, pt] + list(pass_tail))
        return Resp.resp_ok(data={
            "kind": kind,
            "leaves": leaves,
            "points": list(points),
            "rows": data,
            "row_count": len(data),
        })

    def __total_cases(self, content):
        total = 0

        def collect(node):
            nonlocal total
            if node.get("ref_type") == "test_items":
                for ch in (node.get("children") or []):
                    for tbl in (ch.get("tables") or []):
                        if not tbl or not isinstance(tbl[0], list):
                            continue
                        header = [str(c or "") for c in tbl[0]]
                        ci_n = next((i for i, h in enumerate(header) if "用例个数" in h), -1)
                        for r in tbl[1:]:
                            if isinstance(r, list) and 0 <= ci_n < len(r):
                                digits = re.sub(r"[^\d]", "", str(r[ci_n]))
                                total += int(digits) if digits else 0
            for ch in (node.get("children") or []):
                collect(ch)

        for s in (content.get("sections") or []):
            collect(s)
        return total

    def __fill_defects(self, content, prod_id):
        """缺陷统计分析表：从「Bug管理及回归测试」文档的缺陷统计自动回填（Bug总数/已解决/遗留/各级别 + 用例总数）。"""
        if not prod_id or not isinstance(content, dict):
            return content
        from .serv_bug_doc import Server as BugServer
        stats = BugServer().stats_for_product(prod_id)
        total_cases = self.__total_cases(content)
        levels = ["一级", "二级", "三级", "四级", "五级"]
        chars = "一二三四五"

        def walk(node):
            for tbl in (node.get("tables") or []):
                if not tbl or not isinstance(tbl[0], list):
                    continue
                header = [str(c or "") for c in tbl[0]]
                labels = [str((r[0] if isinstance(r, list) and r else "") or "") for r in tbl]
                is_defect = ("Bug级别" in " ".join(header)) or any(lb.startswith("Bug总数") for lb in labels)
                if not is_defect:
                    continue
                lvl_col = {}
                for ci in range(2, len(header)):
                    for lv, ch in zip(levels, chars):
                        if ch in header[ci]:
                            lvl_col[lv] = ci
                for r in tbl[1:]:
                    if not isinstance(r, list) or not r:
                        continue
                    lab = str(r[0] or "").strip()

                    def fill_row(by_level, tot):
                        if len(r) > 1:
                            r[1] = str(tot)
                        for lv, ci in lvl_col.items():
                            if ci < len(r):
                                r[ci] = str(by_level.get(lv, 0))

                    if not stats and not lab.startswith("用例总数"):
                        # 无 bug 管理数据：清空 Bug 总数/已解决/遗留行的数值
                        if len(r) > 1:
                            r[1] = ""
                        for lv, ci in lvl_col.items():
                            if ci < len(r):
                                r[ci] = ""
                        continue
                    if lab.startswith("Bug总数"):
                        fill_row(stats.get("by_level", {}), stats.get("total", 0))
                    elif lab.startswith("已解决"):
                        fill_row(stats.get("resolved_by_level", {}), stats.get("resolved", 0))
                    elif lab.startswith("遗留"):
                        fill_row(stats.get("remaining_by_level", {}), stats.get("remaining", 0))
                    elif lab.startswith("用例总数"):
                        if len(r) > 1 and total_cases:
                            r[1] = str(total_cases)
            for ch in (node.get("children") or []):
                walk(ch)

        for s in (content.get("sections") or []):
            walk(s)
        return content

    def __fill_conclusion(self, content, prod_id):
        """测试结论正文：填「在总共N项用例中，通过M项，占P%」，数据来自测试项列表(用例个数/是否通过)。"""
        if not isinstance(content, dict):
            return content
        total = passed = 0

        def collect(node):
            nonlocal total, passed
            if node.get("ref_type") == "test_items":
                for ch in (node.get("children") or []):
                    for tbl in (ch.get("tables") or []):
                        if not tbl or not isinstance(tbl[0], list):
                            continue
                        header = [str(c or "") for c in tbl[0]]
                        ci_n = next((i for i, h in enumerate(header) if "用例个数" in h), -1)
                        ci_p = next((i for i, h in enumerate(header) if "是否通过" in h), -1)
                        for r in tbl[1:]:
                            if not isinstance(r, list):
                                continue
                            digits = re.sub(r"[^\d]", "", str(r[ci_n])) if 0 <= ci_n < len(r) else ""
                            n = int(digits) if digits else 0
                            total += n
                            pv = str(r[ci_p]) if 0 <= ci_p < len(r) else ""
                            if ("通过" in pv) or ("是" == pv.strip()) or (pv.strip() == ""):
                                passed += n
            for ch in (node.get("children") or []):
                collect(ch)

        for s in (content.get("sections") or []):
            collect(s)
        if total <= 0:
            return content
        pct = round(passed * 100 / total)

        def fill(node):
            if "结论" in str(node.get("title", "")) and (node.get("body") or ""):
                node["body"] = re.sub(
                    r"在总共\d*项用例中，通过\d*项，占\d*%",
                    "在总共%d项用例中，通过%d项，占%d%%" % (total, passed, pct),
                    node["body"],
                )
            for ch in (node.get("children") or []):
                fill(ch)

        for s in (content.get("sections") or []):
            fill(s)
        return content

    def __strip_caption_code(self, cap):
        """表题去掉产品代号前缀，如「XUS缺陷统计分析：」→「缺陷统计分析：」。"""
        s = str(cap or "")
        return re.sub(
            r"^[A-Za-z][A-Za-z0-9_-]*(?=缺陷统计分析|参与此项目)",
            "",
            s,
        )

    def __strip_caption_codes(self, content):
        if not isinstance(content, dict):
            return content

        def walk(node):
            caps = node.get("table_captions")
            if isinstance(caps, list) and caps:
                node["table_captions"] = [self.__strip_caption_code(c) for c in caps]
            for ch in (node.get("children") or []):
                walk(ch)

        for s in (content.get("sections") or []):
            walk(s)
        return content

    def __fill_hr(self, content, prod_id, force=False):
        """人力资源表：填「资源数量/具体人员」(N人/姓名)。
        测试角色与测试计划负责人一致：计划/用例类→主测(宋月/孙家旭)；执行/记录/回归→全部测试人员。
        测试角色打开即覆盖；其它角色 force=False 仅填空。"""
        if not isinstance(content, dict):
            return content
        doc_date = serv_review_util.cover_date(prod_id, DOC_KEY) if prod_id else ""
        members = db.session.execute(
            select(ProjectMember).where(ProjectMember.prod_id == prod_id)
        ).scalars().all() if prod_id else []
        primary = "宋月" if serv_review_util._before_202509(doc_date) else "孙家旭"

        def by_kw(pred):
            out = []
            for m in members:
                if pred(str(m.role or "")):
                    nm = (m.name or "").strip()
                    if nm and nm not in out:
                        out.append(nm)
            return out

        def names_for(label, duty):
            lab, d = str(label or ""), str(duty or "")
            if "用户" in lab and "测试" in lab:
                return by_kw(lambda r: "用户测试" in r)
            if "测试" in lab and "用户" not in lab:
                testers = by_kw(lambda r: ("测试" in r) and ("用户" not in r))
                # 执行/记录/回归 → 全部测试人员；计划/用例/报告类 → 仅主测
                if any(k in d for k in ("执行", "记录", "回归", "首轮")):
                    return testers if testers else [primary]
                return [primary]
            if "产品经理" in lab:
                return by_kw(lambda r: "产品经理" in r)
            if "开发" in lab and "负责" not in lab:
                return by_kw(lambda r: "开发人员" in r or "开发工程师" in r)
            if "QA" in lab:
                return by_kw(lambda r: "QA" in r or "质量" in r)
            if "RA" in lab:
                return by_kw(lambda r: "RA" in r or "法规" in r)
            if "临床" in lab:
                return by_kw(lambda r: "临床" in r)
            return by_kw(lambda r: bool(lab) and (lab in r or r in lab))

        def walk(node):
            for tbl in (node.get("tables") or []):
                if not tbl or not isinstance(tbl[0], list):
                    continue
                header = [str(c or "") for c in tbl[0]]
                if not (header and "角色" in header[0] and any(("具体人员" in h or "资源数量" in h) for h in header)):
                    continue
                ci_p = next((i for i, h in enumerate(header) if ("具体人员" in h or "资源数量" in h)), 1)
                ci_d = next((i for i, h in enumerate(header) if "职责" in h), 2)
                for r in tbl[1:]:
                    if not isinstance(r, list) or not r:
                        continue
                    role_label = r[0]
                    nm = names_for(role_label, r[ci_d] if ci_d < len(r) else "")
                    if not (ci_p < len(r)):
                        continue
                    is_tester = ("测试" in str(role_label or "")) and ("用户" not in str(role_label or ""))
                    cell = ("%d人/%s" % (len(nm), "、".join(nm))) if nm else ""
                    if force or is_tester:
                        r[ci_p] = cell
                    elif nm and not str(r[ci_p] or "").strip():
                        r[ci_p] = cell
            for ch in (node.get("children") or []):
                walk(ch)

        for s in (content.get("sections") or []):
            walk(s)
        return content

    def __fill_refs(self, content, prod_id):
        """引用文档/参考文件表：「作者或来源」列若为已知模板姓名，按角色替换为当前产品对应成员。"""
        if not prod_id or not isinstance(content, dict):
            return content
        doc_date = serv_review_util.cover_date(prod_id, DOC_KEY) or ""
        members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == prod_id)).scalars().all()
        primary = "宋月" if serv_review_util._before_202509(doc_date) else "孙家旭"
        name2role = {"吴福乐": "pm", "余航": "pm", "杨静": "pm", "沈宏": "devlead", "宁随军": "tpm",
                     "林金贵": "qa", "夏晨": "pdir", "张淑芳": "ra", "宋月": "test", "王小敏": "test",
                     "孙家旭": "test", "徐冕": "utest", "罗鹏宇": "utest", "刘锦龙": "utest",
                     "徐学强": "utest", "刘娜": "utest"}

        def first(pred):
            for m in members:
                if pred(str(m.role or "")):
                    nm = (m.name or "").strip()
                    if nm:
                        return nm
            return ""

        def resolve(role):
            return {
                "test": primary,
                "utest": first(lambda r: "用户测试" in r),
                "pm": first(lambda r: "产品经理" in r),
                "devlead": first(lambda r: "研发负责人" in r),
                "tpm": first(lambda r: "TPM" in r),
                "qa": first(lambda r: "QA" in r or "质量" in r),
                "pdir": first(lambda r: "产品负责人" in r or "产品总监" in r),
                "ra": first(lambda r: "RA" in r or "法规" in r),
            }.get(role, "")

        def walk(node):
            for tbl in (node.get("tables") or []):
                if not tbl or not isinstance(tbl[0], list):
                    continue
                header = [str(c or "") for c in tbl[0]]
                if not (any("文档名称" in h for h in header) and any(("作者" in h or "来源" in h) for h in header)):
                    continue
                ci_a = next((i for i, h in enumerate(header) if ("作者" in h or "来源" in h)), 1)
                for r in tbl[1:]:
                    if not isinstance(r, list) or ci_a >= len(r):
                        continue
                    cur = str(r[ci_a] or "").strip()
                    role = name2role.get(cur)
                    if role:
                        nm = resolve(role)
                        if nm:
                            r[ci_a] = nm
            for ch in (node.get("children") or []):
                walk(ch)

        for s in (content.get("sections") or []):
            walk(s)
        return content

    def __autofill(self, content, prod_id, product=None, version="", force=False):
        if not isinstance(content, dict):
            return content
        if product and product.name:
            for s in (content.get("sections") or []):
                self.__replace_name(s, BASE_NAME, product.name)
                # 兼容性测试报告相关章节用 InferCare RECIST 作为产品名占位，也替换为当前产品名
                self.__replace_name(s, "InferCare RECIST", product.name)
            # 更新完整版本号
            new_full_version = (product.full_version or "").strip()
            if new_full_version:
                def _update_version(node):
                    if node.get("body") and "完整版本" in str(node.get("body")):
                        node["body"] = re.sub(r"完整版本：[^\n]*", f"完整版本：{new_full_version}", str(node["body"]))
                    # 只改产品版本行和安装包路径。杀毒软件版本、浏览器版本留给同步，不改成产品版本。
                    for tbl in (node.get("tables") or []):
                        for row in tbl:
                            if not isinstance(row, list) or not row:
                                continue
                            lab = str(row[0] or "").strip()
                            if lab not in ("测试版本", "产品名称/版本", "产品名称/型号") and "安装包路径" not in lab:
                                continue
                            for i in range(1, len(row)):
                                if isinstance(row[i], str) and re.search(r"\d+\.\d+\.\d+\.\d+", row[i]):
                                    row[i] = re.sub(r"\d+\.\d+\.\d+\.\d+", new_full_version, row[i])
                    for c in (node.get("children") or []):
                        _update_version(c)
                for s in (content.get("sections") or []):
                    _update_version(s)
        self.__fill_test_items(content, prod_id)
        self.__fill_hr(content, prod_id, force=force)
        self.__fill_refs(content, prod_id)
        self.__fill_conclusion(content, prod_id)
        self.__fill_defects(content, prod_id)
        self.__fill_workload(content, prod_id)
        self.__fill_compat(content, prod_id, product)
        self.__strip_caption_codes(content)
        self.__fill_revision(content, prod_id, version, force=force)
        # 编审批/生效/评审记录日期←时间线「软件测试报告」；有日期则覆盖模板错误旧值
        rev_date = serv_review_util.cover_date(prod_id, DOC_KEY) if prod_id else ""
        secs = content.get("sections") or []
        has_review = any(
            isinstance(s, dict) and (
                s.get("ref_type") == "review"
                or str(s.get("title") or "").strip() == "评审记录"
            )
            for s in secs
        )
        # 已删评审记录：普通打开不自动再建；force（新建/换产品）仍生成
        if has_review or force:
            serv_review_util.ensure_review(
                content, DOC_KEY, rev_date, prod_id,
                force=force, force_date=bool(rev_date) or force,
            )
        serv_review_util.fill_cover_dates(content, rev_date, force=bool(rev_date) or force)
        serv_review_util.fill_cover_signers(content, serv_review_util.cover_signers(prod_id, DOC_KEY, rev_date) if prod_id else {}, force=force)
        # 附件(兼容性测试报告)排到评审记录之后
        secs = content.get("sections") or []
        atts = [s for s in secs if s.get("ref_type") == "attachment"]
        if atts:
            content["sections"] = [s for s in secs if s.get("ref_type") != "attachment"] + atts
        return content

    def __to_obj(self, row: StrDoc, product: Product = None):
        obj = StrDocObj(**row.dict())
        obj.content = self.__autofill(self.__normalize_content(obj.content), row.product_id, product, row.version)
        if not (obj.file_no or "").strip():
            obj.file_no = self.__dhf_file_no(row.product_id)
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
        obj.file_no = sync_file_no_version(obj.file_no or "", getattr(row, "version", None) or "") or obj.file_no
        return obj

    async def add_str_doc(self, form: StrDocForm):
        try:
            sql = select(func.count(StrDoc.id)).where(StrDoc.product_id == form.product_id, StrDoc.version == form.version)
            if db.session.execute(sql).scalar() > 0:
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            row = StrDoc(**form.dict(exclude_none=True))
            row.id = None
            product = db.session.execute(select(Product).where(Product.id == form.product_id)).scalars().first()
            content = self.__normalize_content(row.content)
            # 新建时 force 补评审记录等自动章（之后用户删除并保存则不再自动补回）
            row.content = self.__autofill(content, form.product_id, product, form.version or "", force=True)
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=StrDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_str_doc(self, id: int, product_id: int = None):
        try:
            fromdoc: StrDoc = db.session.execute(select(StrDoc).where(StrDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            target_pid = product_id or fromdoc.product_id
            all_versions = db.session.execute(select(StrDoc.version).where(StrDoc.product_id == target_pid)).scalars().all()
            existing_set = {v for v in all_versions if v}
            if target_pid == fromdoc.product_id:
                version = new_version(fromdoc.version)
            else:
                def _seq(v):
                    m = re.search(r"(\d+)(?!.*\d)", v or "")
                    return int(m.group(1)) if m else -1
                valid = [v for v in all_versions if v]
                version = new_version(max(valid, key=_seq)) if valid else fromdoc.version
            while version in existing_set:
                version = new_version(version)
            newdoc = StrDoc(
                product_id=target_pid, version=version,
                file_no=sync_file_no_version((fromdoc.file_no or "").strip() or self.__dhf_file_no(target_pid), version) or None,
                change_log=fromdoc.change_log,
                content=copy.deepcopy(self.__normalize_content(fromdoc.content)),
            )
            db.session.add(newdoc)
            db.session.commit()
            if target_pid != fromdoc.product_id:
                await self.rebind_product(newdoc.id, target_pid)
            return Resp.resp_ok(data=StrDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_str_doc(self, form: StrDocForm):
        try:
            row: StrDoc = db.session.execute(select(StrDoc).where(StrDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            for key, value in form.dict(exclude_none=True).items():
                if key == "id":
                    continue
                if key == "content":
                    value = self.__normalize_content(value)
                setattr(row, key, value)
            if getattr(form, "version", None) and hasattr(row, "file_no"):
                row.file_no = sync_file_no_version(row.file_no or "", form.version or row.version) or row.file_no
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def rebind_product(self, id: int, product_id: int):
        """切换产品：更新 product_id 并强制用新产品信息重新获取封面/修订/产品名后保存，返回新 obj。"""
        try:
            row: StrDoc = db.session.execute(select(StrDoc).where(StrDoc.id == id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            old_product: Product = db.session.execute(select(Product).where(Product.id == row.product_id)).scalars().first() if row.product_id else None
            product: Product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
            if not product:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            db.session.execute(delete(StrDoc).where(StrDoc.product_id == product_id, StrDoc.version == row.version, StrDoc.id != id))
            content = self.__normalize_content(row.content)
            # 重置含产品名/完整版本的固定章节为模板原值（恢复基准名+原版本号，避免被旧产品污染）
            tpl = copy.deepcopy(DEFAULT_STR_CONTENT) if isinstance(DEFAULT_STR_CONTENT, dict) else {"sections": []}
            tpl_map = {}
            fixed_titles = {"用户端测试"}
            def collect_tpl(node):
                key = str(node.get("title") or "").strip()
                body = str(node.get("body") or "")
                caps = node.get("table_captions") or []
                tables = node.get("tables") or []
                if BASE_NAME in body or "完整版本" in body or "InferCare RECIST" in body or key in fixed_titles or any(BASE_NAME in str(r) for tbl in tables for r in tbl) or any("1.1.0.1" in str(r) for tbl in tables for r in tbl) or any("1.1.0.1" in str(c) for c in caps):
                    tpl_map[key] = {"body": node.get("body", ""), "tables": copy.deepcopy(tables), "table_captions": copy.deepcopy(caps)}
                for c in (node.get("children") or []):
                    collect_tpl(c)
            for s in (tpl.get("sections") or []):
                collect_tpl(s)
            def reset_fixed(node):
                key = str(node.get("title") or "").strip()
                if key in tpl_map:
                    node["body"] = tpl_map[key]["body"]
                    node["tables"] = copy.deepcopy(tpl_map[key]["tables"])
                    if tpl_map[key].get("table_captions"):
                        node["table_captions"] = copy.deepcopy(tpl_map[key]["table_captions"])
                for c in (node.get("children") or []):
                    reset_fixed(c)
            for s in (content.get("sections") or []):
                reset_fixed(s)
            # 完整版本号更新为新产品版本（body + tables + table_captions）
            # 跳过：版本信息表的"最终安装包路径"行（保留模板包名）、用户端测试章节表头（浏览器版本号保留）
            new_full_version = (product.full_version or "").strip()
            def update_version(node):
                node_title = str(node.get("title") or "").strip()
                if node.get("body") and "完整版本" in str(node.get("body")):
                    node["body"] = re.sub(r"完整版本：[^\n]*", f"完整版本：{new_full_version}", str(node["body"]))
                # 用户端测试章节的表格不替换版本号（表头是浏览器版本号，保留模板）
                if "用户端测试" not in node_title:
                    for tbl in (node.get("tables") or []):
                        for r in tbl:
                            if not isinstance(r, list) or not r:
                                continue
                            # 版本信息表跳过"最终安装包路径"行（保留模板包名）
                            if "版本信息" in node_title and any("安装包路径" in str(c) for c in r):
                                continue
                            lab = str(r[0] or "").strip()
                            if lab not in ("测试版本", "产品名称/版本", "产品名称/型号") and "安装包路径" not in lab:
                                continue
                            for i in range(1, len(r)):
                                if isinstance(r[i], str) and re.search(r"\d+\.\d+\.\d+\.\d+", r[i]):
                                    r[i] = re.sub(r"\d+\.\d+\.\d+\.\d+", new_full_version, r[i])
                caps = node.get("table_captions") or []
                if caps:
                    node["table_captions"] = [re.sub(r"\d+\.\d+\.\d+\.\d+", new_full_version, str(c)) if re.search(r"\d+\.\d+\.\d+\.\d+", str(c)) else c for c in caps]
                for c in (node.get("children") or []):
                    update_version(c)
            for s in (content.get("sections") or []):
                update_version(s)
            row.product_id = product_id
            # 测试分布图：未获取时从该产品 doc_file（img_flow）获取，已获取的保留
            # 缺陷统计分析分布图：有 bug 管理数据才获取，没 bug 清空
            from .serv_bug_doc import Server as BugServer
            has_bug = bool(BugServer().stats_for_product(product_id))
            def fill_test_chart(nodes):
                for n in nodes:
                    title = str(n.get("title") or "").strip()
                    if title == "测试分布图":
                        imgs = n.get("images") or []
                        if not imgs:
                            row_df = db.session.execute(
                                select(DocFile).where(DocFile.product_id == product_id, DocFile.category == "img_flow").order_by(DocFile.id)
                            ).scalars().first()
                            if row_df and row_df.file_url:
                                url = str(row_df.file_url).strip()
                                if url.startswith("data.trace/"):
                                    url = "/" + url
                                n["images"] = [url]
                    elif title == "缺陷统计分析":
                        # 有 bug 管理数据才生成分布图，没 bug 提示"还未上传Bug管理及回归测试"
                        if has_bug:
                            row_df = db.session.execute(
                                select(DocFile).where(DocFile.product_id == product_id, DocFile.category == "img_flow").order_by(DocFile.id)
                            ).scalars().first()
                            if row_df and row_df.file_url:
                                url = str(row_df.file_url).strip()
                                if url.startswith("data.trace/"):
                                    url = "/" + url
                                n["images"] = [url]
                            n["body"] = ""
                        else:
                            n["images"] = []
                            n["body"] = "还未上传Bug管理及回归测试"
                    for c in (n.get("children") or []):
                        fill_test_chart([c])
            fill_test_chart(content.get("sections") or [])
            content = self.__autofill(content, product_id, product, row.version, force=True)
            row.content = content
            db.session.commit()
            return Resp.resp_ok(data=self.__to_obj(row, product))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_str_doc(self, id: int):
        db.session.execute(delete(StrDoc).where(StrDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def refill_str_test_items(self, product_id: int, stages: str = ""):
        """按产品 + 阶段名列表拉取测试项表格（供编辑页「自动获取」）。stages 逗号分隔。"""
        stage_list = [s.strip() for s in str(stages or "").split(",") if s and str(s).strip()]
        if not product_id:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        if not stage_list:
            return Resp.resp_err(msg="请指定测试阶段")
        srs_to_sds, sds_to_srs, known_srs = self.__srs_sds_maps(product_id)
        items = []
        for stage in stage_list:
            with_design = stage == "单元测试"
            header = self.TESTITEM_HEADER_UNIT if with_design else self.TESTITEM_HEADER
            rows = self.__stage_rows(
                product_id, stage, {}, with_design=with_design,
                srs_to_sds=srs_to_sds, sds_to_srs=sds_to_srs, known_srs=known_srs,
            )
            grid = [list(header)] + rows
            items.append({"title": stage, "tables": [grid], "row_count": len(rows)})
        if not any(it["row_count"] > 0 for it in items):
            return Resp.resp_err(msg="该产品暂无对应阶段测试用例")
        return Resp.resp_ok(data={"items": items})

    async def get_str_doc(self, id: int):
        sql = select(StrDoc, Product).join(Product, StrDoc.product_id == Product.id).where(StrDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        return Resp.resp_ok(data=self.__to_obj(doc, product))

    async def list_str_doc(self, op_user: UserObj = None, product_id: int = 0, version: str = None, page_index: int = 0, page_size: int = 10):
        wheres = []
        if product_id:
            wheres.append(StrDoc.product_id == product_id)
        if version:
            wheres.append(StrDoc.version.like(f"%{version}%"))
        scope = product_scope_filter(op_user)
        if scope is not None:
            wheres.append(scope)
        sql_total = select(func.count(StrDoc.id)).join(Product, StrDoc.product_id == Product.id).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (select(StrDoc, Product).join(Product, StrDoc.product_id == Product.id).where(*wheres)
               .order_by(StrDoc.id.desc()).offset(page_index * page_size).limit(page_size))
        rows: List[StrDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    # ---------------- 导出 Word（PDP 风格章节树） ----------------
    async def export_str_doc(self, output, id: int, mode: str = "full"):
        resp = await self.get_str_doc(id)
        obj = resp.data
        if obj is None:
            Document().save(output)
            output.seek(0)
            return
        c = self.__normalize_content(obj.content)
        sections = c.get("sections") or []
        document = Document()
        section = document.sections[0]
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)
        update_fields = OxmlElement("w:updateFields")
        update_fields.set(qn("w:val"), "true")
        document.settings.element.append(update_fields)
        header_para = section.header.add_paragraph()
        header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        docx_util.fonted_txt(header_para, obj.file_no or "")
        docx_util.add_page_number_footer(section, obj.file_no or "")

        def add_blank_lines(n):
            for _ in range(max(0, int(n or 0))):
                document.add_paragraph("")

        def write_center_title(text, size=22.0, bold=False):
            p = document.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            docx_util.fonted_txt(p, str(text or ""), font_size=size, bold=bold)

        def add_text(text):
            docx_util.save_txt2docx(str(text or ""), document)

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT):
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = align
                    para.add_run().add_picture(BytesIO(base64.b64decode(b64)), height=Pt(33))
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    return
                except Exception:
                    pass
            cell.text = ""
            for i, line in enumerate(s.split("\n")):
                para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
                para.alignment = align
                para.paragraph_format.line_spacing = 1.3
                docx_util.fonted_txt(para, line, font_size=10.5, bold=bold)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER if align == WD_ALIGN_PARAGRAPH.CENTER else WD_CELL_VERTICAL_ALIGNMENT.TOP

        def _set_fixed_widths(table, widths_dxa):
            table.autofit = False
            table.allow_autofit = False
            tbl_pr = table._tbl.tblPr
            layout = tbl_pr.find(qn("w:tblLayout"))
            if layout is None:
                layout = OxmlElement("w:tblLayout")
                tbl_pr.append(layout)
            layout.set(qn("w:type"), "fixed")
            grid_el = table._tbl.find(qn("w:tblGrid"))
            if grid_el is not None:
                for gc in list(grid_el):
                    grid_el.remove(gc)
                for w in widths_dxa:
                    gc = OxmlElement("w:gridCol")
                    gc.set(qn("w:w"), str(w))
                    grid_el.append(gc)
            # 逐格写 tcW，确保固定列宽生效
            for row in table.rows:
                for i, w in enumerate(widths_dxa):
                    if i < len(row.cells):
                        tcpr = row.cells[i]._tc.get_or_add_tcPr()
                        tcw = tcpr.find(qn("w:tcW"))
                        if tcw is None:
                            tcw = OxmlElement("w:tcW")
                            tcpr.append(tcw)
                        tcw.set(qn("w:w"), str(w))
                        tcw.set(qn("w:type"), "dxa")

        def add_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for r_idx, row in enumerate(grid):
                cells = table.add_row().cells
                for c_idx in range(cols):
                    set_cell(cells[c_idx], row[c_idx] if c_idx < len(row) else "", bold=(r_idx == 0))
            # SCI 清单表：固定列宽，SCI名字/类型不换行、存储地点较宽
            first = str(grid[0][0]).strip() if grid and grid[0] else ""
            if first == "SCI名字":
                if cols == 5:
                    _set_fixed_widths(table, [1700, 1100, 2000, 1500, 3000])
                elif cols == 4:
                    _set_fixed_widths(table, [1700, 2200, 1500, 3600])
            elif first == "类别" and cols >= 3:
                # 配置项存储地址表：类别列收窄、存储路径较宽；首列连续相同「类别」纵向合并；文字左对齐
                if cols == 3:
                    _set_fixed_widths(table, [1300, 1300, 5000])
                rows = table.rows
                n = len(rows)
                r = 1
                while r < n:
                    val = str((grid[r][0] if r < len(grid) and grid[r] else "") or "").strip()
                    if not val:
                        r += 1
                        continue
                    r2 = r
                    while r2 + 1 < n and str((grid[r2 + 1][0] if grid[r2 + 1] else "") or "").strip() == val:
                        r2 += 1
                    if r2 > r:
                        merged = rows[r].cells[0].merge(rows[r2].cells[0])
                        set_cell(merged, val, align=WD_ALIGN_PARAGRAPH.LEFT)
                        merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    r = r2 + 1
            elif first == "测试模块":
                # 兼容性测试项：表头合并 + 首列「测试模块」连续相同纵向合并
                rows = table.rows
                n = len(rows)
                hdr = 0
                for gr in grid:
                    if gr and str(gr[0] or "").strip() == "测试模块":
                        hdr += 1
                    else:
                        break
                # 表头：测试模块/测试点跨表头行；版本组横向合并
                if hdr >= 2:
                    for col in (0, 1):
                        try:
                            mh = rows[0].cells[col].merge(rows[hdr - 1].cells[col])
                            set_cell(mh, str(grid[0][col] if col < len(grid[0]) else ""), bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
                            mh.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                        except Exception:
                            pass
                if grid and len(grid[0]) > 2:
                    ncol = len(grid[0])
                    c = 2
                    while c < ncol:
                        v = str(grid[0][c] or "")
                        c2 = c
                        while c2 + 1 < ncol and str(grid[0][c2 + 1] or "") == v:
                            c2 += 1
                        if c2 > c:
                            try:
                                mh = rows[0].cells[c].merge(rows[0].cells[c2])
                                set_cell(mh, v, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
                                mh.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                            except Exception:
                                pass
                        c = c2 + 1
                r = hdr
                while r < n:
                    val = str((grid[r][0] if r < len(grid) and grid[r] else "") or "").strip()
                    if not val:
                        r += 1
                        continue
                    r2 = r
                    while r2 + 1 < n and str((grid[r2 + 1][0] if grid[r2 + 1] else "") or "").strip() == val:
                        r2 += 1
                    if r2 > r:
                        merged = rows[r].cells[0].merge(rows[r2].cells[0])
                        set_cell(merged, val, align=WD_ALIGN_PARAGRAPH.CENTER)
                        merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    r = r2 + 1
            elif first == "需求编号" and cols >= 2:
                # 单元测试项表：需求编号/设计编号 连续相同非空纵向合并
                headers = [str(c or "").strip() for c in (grid[0] or [])]
                if "设计编号" in headers:
                    merge_cis = [i for i, h in enumerate(headers) if h in ("需求编号", "设计编号")]
                    rows = table.rows
                    n = len(rows)
                    for ci in merge_cis:
                        r = 1
                        while r < n:
                            val = str((grid[r][ci] if r < len(grid) and ci < len(grid[r]) else "") or "").strip()
                            if not val:
                                r += 1
                                continue
                            r2 = r
                            while r2 + 1 < n and str(
                                (grid[r2 + 1][ci] if r2 + 1 < len(grid) and ci < len(grid[r2 + 1]) else "") or ""
                            ).strip() == val:
                                r2 += 1
                            if r2 > r:
                                try:
                                    merged = rows[r].cells[ci].merge(rows[r2].cells[ci])
                                    set_cell(merged, val, align=WD_ALIGN_PARAGRAPH.CENTER)
                                    merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                                except Exception:
                                    pass
                            r = r2 + 1
            elif first == "Bug级别" or (grid and "Bug级别" in " ".join(str(c or "") for c in (grid[0] or []))):
                # 缺陷统计：「用例总数」行从第 2 列起横向合并至行末
                rows = table.rows
                for r_idx, grow in enumerate(grid):
                    if r_idx == 0 or not isinstance(grow, list):
                        continue
                    if not str(grow[0] or "").strip().startswith("用例总数"):
                        continue
                    if cols <= 2:
                        break
                    try:
                        merged = rows[r_idx].cells[1].merge(rows[r_idx].cells[cols - 1])
                        set_cell(
                            merged,
                            grow[1] if len(grow) > 1 else "",
                            align=WD_ALIGN_PARAGRAPH.CENTER,
                        )
                        merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    except Exception:
                        pass
                    break
            elif first in ("测试目标", "测试方法和技术") and cols == 2:
                _set_fixed_widths(table, [2200, 7100])
            elif first == "配置":
                if cols == 2:
                    _set_fixed_widths(table, [1900, 7400])
                elif cols == 3:
                    _set_fixed_widths(table, [1900, 3700, 3700])
            document.add_paragraph()

        def add_cover_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for row in grid:
                cells = table.add_row().cells
                for c_idx in range(cols):
                    text = row[c_idx] if c_idx < len(row) else ""
                    set_cell(cells[c_idx], text, bold=(c_idx % 2 == 0), align=WD_ALIGN_PARAGRAPH.CENTER)
                if (str(row[0]).strip() if row else "") == "生效日期" and cols > 2:
                    merged = cells[1]
                    for c_idx in range(2, cols):
                        merged = merged.merge(cells[c_idx])
                    set_cell(merged, row[1] if len(row) > 1 else "", align=WD_ALIGN_PARAGRAPH.CENTER)
            document.add_paragraph()

        def strip_num(title):
            return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()

        def add_body_heading(title, level):
            size = {1: 16.0, 2: 14.0, 3: 12.0}.get(level, 11.0)
            p = document.add_heading("", level=max(1, min(level, 9)))
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.left_indent = Pt(0)
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            docx_util.fonted_txt(p, title, font_size=size, bold=True)

        def render_body_section(node, level, number=""):
            name = strip_num(node.get("title"))
            heading = f"{number} {name}".strip() if number else name
            add_body_heading(heading, level=max(1, min(level, 9)))
            if node.get("ref_type") == "review":
                for t_idx, table in enumerate(node.get("tables") or []):
                    serv_review_util.render_review_grid(document, table, set_cell, merge_col0=(t_idx == 0), merge_full=True)
            else:
                body_text = str(node.get("body") or "")
                tables = node.get("tables") or []
                images = [x for x in (node.get("images") or []) if isinstance(x, str) and str(x).strip()]
                caps = node.get("table_captions") or []
                def _emit_table(t_idx):
                    cap = caps[t_idx] if t_idx < len(caps) else ""
                    cap = self.__strip_caption_code(cap)
                    if str(cap or "").strip():
                        add_text(cap)
                    add_grid(tables[t_idx])
                if has_free_body_markers(body_text) or images:
                    state = {"i": 0}

                    def add_marked_table(_grid):
                        i = state["i"]
                        state["i"] += 1
                        _emit_table(i)

                    emit_free_body(
                        body_text, tables, images, add_text, add_marked_table,
                        lambda url, caption="": write_body_image(document, url, caption, add_text),
                    )
                # 按"见下表"/"表N"切分 body，交错输出正文段和表格
                elif (("见下表" in body_text) or re.search(r"(?m)^表\s*\d", body_text)) and tables:
                    lines = body_text.split("\n")
                    buf = []
                    tbl_idx = 0
                    def flush_text():
                        t = "\n".join(buf).strip()
                        if t:
                            add_text(t)
                        buf.clear()
                    for ln in lines:
                        if ("见下表" in ln.strip() or re.match(r"^表\s*\d", ln.strip())) and tbl_idx < len(tables):
                            buf.append(ln)  # 保留"见下表"/"表N"行作为正文
                            flush_text()
                            _emit_table(tbl_idx)
                            tbl_idx += 1
                        else:
                            buf.append(ln)
                    flush_text()
                    for i in range(tbl_idx, len(tables)):
                        _emit_table(i)
                else:
                    if body_text.strip():
                        add_text(body_text)
                    for t_idx in range(len(tables)):
                        _emit_table(t_idx)
                # 分布图等节点图片（data URL）内嵌，排在表格之后、表格后正文之前
                for _img in (node.get("charts") or []):
                    if isinstance(_img, str) and _img.startswith("data:image"):
                        try:
                            _p = document.add_paragraph()
                            _p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                            _p.add_run().add_picture(BytesIO(base64.b64decode(_img.split(",", 1)[1])), width=Inches(6.2))
                        except Exception:
                            pass
                if str(node.get("body_tail") or "").strip():
                    add_text(node.get("body_tail"))
            idx = 0
            for child in (node.get("children") or []):
                idx += 1
                child_num = f"{number}.{idx}" if number else f"{idx}"
                render_body_section(child, level + 1, child_num)

        cover = next((s for s in sections if s.get("ref_type") == "cover"), None)
        revision = next((s for s in sections if s.get("ref_type") == "revision"), None)
        all_body = [s for s in sections if s.get("ref_type") not in ("cover", "revision")]
        # mode: "full"=全部, "main"=仅主体(不含兼容性附件), "compat"=仅兼容性测试附件
        if mode == "compat":
            body = [s for s in all_body if s.get("ref_type") == "attachment"]
        elif mode == "main":
            body = [s for s in all_body if s.get("ref_type") != "attachment"]
        else:
            body = all_body

        add_blank_lines(6)
        cover_title = "兼容性测试报告" if mode == "compat" else ((strip_num(cover.get("title")) if cover else "") or DOC_NAME)
        write_center_title(cover_title, size=22.0, bold=True)
        add_blank_lines(4)
        if cover:
            for table in (cover.get("tables") or []):
                add_cover_grid(table)

        document.add_page_break()
        write_center_title("文件修订记录", size=14.0, bold=True)
        add_blank_lines(2)
        if revision:
            for table in (revision.get("tables") or []):
                add_grid(table)

        document.add_page_break()
        write_center_title("目录", size=16.0, bold=True)
        docx_util.insert_toc_field(document)

        document.add_page_break()
        seq = 0
        for node in body:
            if node.get("ref_type") in ("review", "attachment"):
                render_body_section(node, 1, "")
            else:
                seq += 1
                render_body_section(node, 1, str(seq))

        docx_util.fill_toc_cache(document)
        document.save(output)
        output.seek(0)
