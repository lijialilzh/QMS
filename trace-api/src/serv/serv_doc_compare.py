#!/usr/bin/env python
# encoding: utf-8

# 通用文档内容比对服务层。支持所有 content(JSON) 存储的文档类型。

import copy
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import select, func
from sqlalchemy.sql import text

from ..model.product import Product
from ..obj import Resp
from ..obj.vobj_sds_doc import CompareObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db

logger = logging.getLogger(__name__)

# 所有支持比对的文档类型配置
# doc_type: (表名, 显示名称, 模型类路径)
DOC_TYPES = {
    # ===== 产品文件 =====
    "pir": {"table": "pir_doc", "name": "产品立项报告", "group": "产品文件"},
    "pdp": {"table": "pdp_doc", "name": "产品开发计划", "group": "产品文件"},
    "ptr": {"table": "ptr_doc", "name": "产品技术要求", "group": "产品文件"},
    "label": {"table": "label_doc", "name": "产品标签样稿", "group": "产品文件"},
    "vuh": {"table": "vuh_doc", "name": "版本更新历史", "group": "产品文件"},
    "release_note": {"table": "release_note", "name": "产品发布说明", "group": "产品文件"},
    "acc": {"table": "acc_doc", "name": "产品验收记录", "group": "产品文件"},
    # ===== 需求与设计 =====
    "srs": {"table": "srs_doc", "name": "需求规格说明", "group": "需求与设计"},
    "sds": {"table": "sds_doc", "name": "软件详细设计", "group": "需求与设计"},
    # ===== 开发文件 =====
    "sd": {"table": "sd_doc", "name": "软件开发计划", "group": "开发文件"},
    "scm": {"table": "scm_doc", "name": "软件配置管理计划", "group": "开发文件"},
    "scs": {"table": "scs_doc", "name": "软件配置状态报告", "group": "开发文件"},
    "imm": {"table": "imm_doc", "name": "安装维护手册", "group": "开发文件"},
    "crr": {"table": "crr_doc", "name": "代码审查记录", "group": "开发文件"},
    "dem": {"table": "dem_doc", "name": "开发环境维护说明", "group": "开发文件"},
    "deq": {"table": "deq_doc", "name": "开发设备清单", "group": "开发文件"},
    "dat": {"table": "dat_doc", "name": "数据申请单", "group": "开发文件"},
    # ===== 测试文件 =====
    "stp": {"table": "stp_doc", "name": "软件测试计划", "group": "测试文件"},
    "utp": {"table": "utp_doc", "name": "用户测试计划", "group": "测试文件"},
    "str": {"table": "str_doc", "name": "软件测试报告", "group": "测试文件"},
    "utr": {"table": "utr_doc", "name": "用户测试报告", "group": "测试文件"},
    "ftr": {"table": "ftr_doc", "name": "现场测试规程", "group": "测试文件"},
    "ftr_record": {"table": "ftr_record_doc", "name": "现场测试记录", "group": "测试文件"},
    "train_record": {"table": "train_record_doc", "name": "培训记录表", "group": "测试文件"},
    "teq": {"table": "teq_doc", "name": "测试设备清单", "group": "测试文件"},
    "tem": {"table": "tem_doc", "name": "测试环境维护说明", "group": "测试文件"},
    # ===== 风险管理 =====
    "rmp": {"table": "rmp_doc", "name": "风险管理计划", "group": "风险管理"},
    "pha": {"table": "pha_doc", "name": "初步危害分析清单", "group": "风险管理"},
    "cyber_cap": {"table": "cyber_cap_doc", "name": "网络安全能力分析", "group": "风险管理"},
    "nsmp": {"table": "nsmp_doc", "name": "网络安全维护计划", "group": "风险管理"},
    "nsr": {"table": "nsr_doc", "name": "自研软件网络安全研究报告", "group": "风险管理"},
    "research": {"table": "research_doc", "name": "自研软件研究报告", "group": "风险管理"},
    "risk_mgmt": {"table": "risk_mgmt_doc", "name": "风险管理报告", "group": "风险管理"},
    "cybersec": {"table": "cybersec_doc", "name": "网络安全管理", "group": "风险管理"},
}


class Server(object):

    async def list_compare_doc_types(self):
        """返回所有可比对的文档类型列表（按分组排序）。"""
        groups = {}
        for key, cfg in DOC_TYPES.items():
            group = cfg["group"]
            if group not in groups:
                groups[group] = []
            groups[group].append({"doc_type": key, "name": cfg["name"]})
        result = []
        for gname in ["产品文件", "需求与设计", "开发文件", "测试文件", "风险管理"]:
            if gname in groups:
                result.append({"group": gname, "types": groups[gname]})
        return Resp.resp_ok(data=result)

    async def list_compare_doc_versions(self, doc_type: str, product_id: int):
        """查询某产品下某文档类型的所有版本列表。"""
        cfg = DOC_TYPES.get(doc_type)
        if not cfg:
            return Resp.resp_err(msg=ts("msg_err_param"))
        table = cfg["table"]
        sql = text(f"SELECT id, version, file_no, change_log, create_time FROM {table} WHERE product_id = :pid ORDER BY id DESC")
        rows = db.session.execute(sql, {"pid": product_id}).fetchall()
        result = []
        for row in rows:
            result.append({
                "id": row[0],
                "version": row[1],
                "file_no": row[2],
                "change_log": row[3],
                "create_time": str(row[4]) if row[4] else "",
            })
        return Resp.resp_ok(data=result)

    def __normalize_text(self, text: str) -> str:
        """规范化文本用于比对：去除空白、换行、标点差异。"""
        if not text:
            return ""
        import re
        # 去除所有空白字符
        text = re.sub(r"\s+", "", text)
        # 去除常见标点差异
        text = text.replace("，", ",").replace("。", ".").replace("；", ";").replace("：", ":").replace("（", "(").replace("）", ")").replace("“", "\"").replace("”", "\"")
        return text.strip()

    def __extract_section_texts(self, content: Any) -> List[Dict]:
        """从 content(JSON) 中提取所有章节的标题和正文文本。"""
        if not isinstance(content, dict):
            return []
        sections = content.get("sections") or []
        result = []
        self.__walk_sections(sections, result, "")
        return result

    def __walk_sections(self, sections: List, result: List, parent_title: str):
        """递归遍历章节树，提取标题和正文。"""
        for s in sections:
            if not isinstance(s, dict):
                continue
            title = str(s.get("title") or "").strip()
            body = str(s.get("body") or "").strip()
            full_title = f"{parent_title}/{title}" if parent_title and title else title

            # 提取表格文本
            table_texts = []
            for tbl in (s.get("tables") or []):
                if isinstance(tbl, list):
                    for row in tbl:
                        if isinstance(row, list):
                            for cell in row:
                                if cell and str(cell).strip():
                                    table_texts.append(str(cell).strip())

            result.append({
                "title": full_title,
                "body": body,
                "table_texts": table_texts,
            })

            # 递归子章节
            children = s.get("children") or []
            if children:
                self.__walk_sections(children, result, full_title)

    def __compare_sections(self, sections_a: List[Dict], sections_b: List[Dict]) -> List[CompareObj]:
        """比对两个文档的章节内容。"""
        results = []

        # 比对章节数量
        count_a = len(sections_a)
        count_b = len(sections_b)
        results.append(CompareObj(
            column_code="section_count",
            column_name="章节数量",
            same_flag=1 if count_a == count_b else 0,
            values=[str(count_a), str(count_b)],
        ))

        # 比对每个章节的标题和正文
        max_len = max(count_a, count_b)
        for i in range(max_len):
            sa = sections_a[i] if i < count_a else None
            sb = sections_b[i] if i < count_b else None

            title_a = sa["title"] if sa else "(无)"
            title_b = sb["title"] if sb else "(无)"
            title_same = 1 if self.__normalize_text(title_a) == self.__normalize_text(title_b) else 0
            results.append(CompareObj(
                column_code=f"section_{i}_title",
                column_name=f"章节{i+1}标题",
                same_flag=title_same,
                values=[title_a, title_b],
            ))

            body_a = sa["body"] if sa else ""
            body_b = sb["body"] if sb else ""
            body_same = 1 if self.__normalize_text(body_a) == self.__normalize_text(body_b) else 0
            results.append(CompareObj(
                column_code=f"section_{i}_body",
                column_name=f"章节{i+1}正文",
                same_flag=body_same,
                values=[body_a[:200] + ("..." if len(body_a) > 200 else ""),
                        body_b[:200] + ("..." if len(body_b) > 200 else "")],
            ))

            # 比对表格
            tables_a = sa["table_texts"] if sa else []
            tables_b = sb["table_texts"] if sb else []
            table_count_same = 1 if len(tables_a) == len(tables_b) else 0
            results.append(CompareObj(
                column_code=f"section_{i}_table_count",
                column_name=f"章节{i+1}表格项数",
                same_flag=table_count_same,
                values=[str(len(tables_a)), str(len(tables_b))],
            ))

        return results

    async def compare_doc(self, doc_type: str, id0: int, id1: int):
        """通用文档内容比对。"""
        cfg = DOC_TYPES.get(doc_type)
        if not cfg:
            return Resp.resp_err(msg=ts("msg_err_param"))
        table = cfg["table"]

        # SRS/SDS 没有 content 字段，需要从节点表查询
        is_node_doc = doc_type in ("srs", "sds")
        node_table = "srs_node" if doc_type == "srs" else "sds_node"

        if is_node_doc:
            sql = text(f"SELECT t.id, t.product_id, t.version, t.file_no, t.change_log, p.name as product_name, p.full_version as product_version, p.type_code as product_type_code FROM {table} t JOIN product p ON t.product_id = p.id WHERE t.id IN (:id0, :id1)")
        else:
            sql = text(f"SELECT t.id, t.product_id, t.version, t.file_no, t.change_log, t.content, p.name as product_name, p.full_version as product_version, p.type_code as product_type_code FROM {table} t JOIN product p ON t.product_id = p.id WHERE t.id IN (:id0, :id1)")
        rows = db.session.execute(sql, {"id0": id0, "id1": id1}).fetchall()
        if len(rows) != 2:
            return Resp.resp_err(msg=ts("msg_obj_null"))

        doc_map = {}
        for row in rows:
            doc_map[row[0]] = row

        doc0 = doc_map.get(id0)
        doc1 = doc_map.get(id1)
        if not doc0 or not doc1:
            return Resp.resp_err(msg=ts("msg_obj_null"))

        results = []

        # 1. 比对基本信息
        base_fields = [
            ("product_name", "产品名称"),
            ("product_type_code", "产品型号"),
            ("product_version", "产品版本"),
            ("version", "文档版本"),
            ("file_no", "文件编号"),
            ("change_log", "变更说明"),
        ]
        for idx, (field, label) in enumerate(base_fields):
            v0 = str(getattr(doc0, field) or "")
            v1 = str(getattr(doc1, field) or "")
            results.append(CompareObj(
                column_code=f"base_{field}",
                column_name=label,
                same_flag=1 if v0 == v1 else 0,
                values=[v0, v1],
            ))

        # 2. 比对章节内容
        if is_node_doc:
            # SRS/SDS：从节点表提取章节标题
            node_sql = text(f"SELECT n_id, p_id, title, priority FROM {node_table} WHERE doc_id = :doc_id ORDER BY priority, n_id")
            nodes0 = db.session.execute(node_sql, {"doc_id": id0}).fetchall()
            nodes1 = db.session.execute(node_sql, {"doc_id": id1}).fetchall()

            def extract_titles(nodes):
                titles = []
                for n in nodes:
                    t = str(n[2] or "").strip()
                    if t:
                        titles.append(t)
                return titles

            titles0 = extract_titles(nodes0)
            titles1 = extract_titles(nodes1)

            results.append(CompareObj(
                column_code="section_count",
                column_name="章节数量",
                same_flag=1 if len(titles0) == len(titles1) else 0,
                values=[str(len(titles0)), str(len(titles1))],
            ))

            max_len = max(len(titles0), len(titles1))
            for i in range(max_len):
                ta = titles0[i] if i < len(titles0) else "(无)"
                tb = titles1[i] if i < len(titles1) else "(无)"
                results.append(CompareObj(
                    column_code=f"section_{i}_title",
                    column_name=f"章节{i+1}",
                    same_flag=1 if self.__normalize_text(ta) == self.__normalize_text(tb) else 0,
                    values=[ta, tb],
                ))
        else:
            # content(JSON) 文档
            try:
                content0 = json.loads(doc0[5]) if isinstance(doc0[5], str) else (doc0[5] or {})
                content1 = json.loads(doc1[5]) if isinstance(doc1[5], str) else (doc1[5] or {})
            except Exception:
                content0 = doc0[5] or {}
                content1 = doc1[5] or {}

            sections_a = self.__extract_section_texts(content0)
            sections_b = self.__extract_section_texts(content1)
            section_results = self.__compare_sections(sections_a, sections_b)
            results.extend(section_results)

        return Resp.resp_ok(data=results)
