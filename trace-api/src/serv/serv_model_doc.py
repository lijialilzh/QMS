#!/usr/bin/env python
# encoding: utf-8

# 模型文件服务层，详见 docs/function_docs/99_模型文件管理.md。
# 单表 model_doc + doc_type；导出结构与产品立项报告一致：封面→分页→修订记录→分页→目录→分页→正文。

import base64
import copy
import logging
import math
import os
import re
from datetime import date, datetime, timedelta
from io import BytesIO
from typing import List
from sqlalchemy import delete, func, select
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE

from ..model.product import Product
from ..model.model_doc import ModelDoc
from ..model.data_doc import DataDoc
from ..model.project_timeline import ProjectTimelineRow, ProjectTimelineCell
from ..model.project_member import ProjectMember
from ..model.srs_doc import SrsDoc
from ..model.srs_req import SrsReq
from ..model.prod_algo_chapter import ProdAlgoChapter
from ..model.prod_runtime_env import ProdRuntimeEnv
from ..obj import Page, Resp
from ..obj.tobj_role import Roles
from ..obj.vobj_user import UserObj
from ..obj.tobj_model_doc import ModelDocForm
from ..obj.vobj_model_doc import ModelDocObj
from ..utils.i18n import ts
from ..utils.sql_ctx import db
from . import msg_err_db
from . import serv_review_util
from .serv_prod_runtime_env import DEFAULT_RUNTIME_ENV
from .serv_utils import new_version, sync_file_no_version
from .serv_utils import docx_util
from .serv_utils.doc_blocks import fill_chapter_images, split_body_blocks
from .model_doc_templates import DOC_META as WORD_META, DEFAULT_CONTENTS as WORD_CONTENTS, REVIEW_TABLES as WORD_REVIEW_TABLES
from .model_doc_xlsx_templates import XLSX_META, XLSX_CONTENTS
from .model_doc_build_templates import BUILD_DOC_TYPES, BUILD_DEFAULTS
from .model_doc_train_templates import TRAIN_DOC_TYPES, TRAIN_DEFAULTS
from .model_doc_test_templates import TEST_DOC_TYPES, TEST_DEFAULTS
from .model_doc_pkg_templates import PKG_DOC_TYPES, PKG_REQ_TYPES, PKG_REC_TYPES, PKG_SUBMIT_TYPES, PKG_DEFAULTS

DOC_META = {**WORD_META, **XLSX_META}
DEFAULT_CONTENTS = {**WORD_CONTENTS, **XLSX_CONTENTS}
REVIEW_TABLES = WORD_REVIEW_TABLES
EQ_DOC_TYPES = ("md_deq", "md_teq", "md_eq")
CRR_DOC_TYPES = ("md_008_01", "md_008_02")
BUILD_DATASET_NAME = {
    "md_009_01": "肺栓塞分割训练集",
    "md_009_02": "肺叶分割训练集",
    "md_010_01": "肺栓塞分割调优集",
    "md_010_02": "肺叶分割调优集",
    "md_011_01": "肺栓塞分诊测试集",
    "md_011_02": "肺叶分割测试集",
}
BUILD_AUTHOR_ROLE = {
    "md_009_01": "algo",
    "md_009_02": "algo",
    "md_010_01": "algo",
    "md_010_02": "algo",
    "md_011_01": "modeler",
    "md_011_02": "modeler",
}
TRAIN_BUILD_TYPE = {"md_012_01": "md_009_01", "md_012_02": "md_009_02"}
_CRR_CATEGORIES = ("结构", "文档", "变量", "算法操作", "循环和分支")
_CRR_CONCLUSIONS = ("通过", "有条件通过", "不通过")
_MD008_URL = {
    "md_008_01": "http://172.16.6.3:8081/model/pe/pe-segmetation",
    "md_008_02": "http://172.16.6.3:8081/model/pe/lobe_segmentation",
}
_MD008_CHECKLIST = [
    ["编号", "问题", "是", "否", "不适用", "备注"],
    ["结构", "", "", "", "", ""],
    ["1", "代码是否符合相关的编码标准?", "√", "", "", ""],
    ["2", "代码结构是否适当，风格和格式是否保持一致?", "√", "", "", ""],
    ["3", "代码中是否有没有被调用的或无用的程序，或没有被执行的代码?", "", "√", "", ""],
    ["4", "是否有过于复杂的模块需要重新构造或拆分成多个程序?", "", "√", "", ""],
    ["文档", "", "", "", "", ""],
    ["1", "代码是否已被用易于维护的注释方式清晰充分的文档化?", "√", "", "", ""],
    ["2", "注释是否与代码协调一致?", "√", "", "", ""],
    ["变量", "", "", "", "", ""],
    ["1", "所有变量的命名是否清晰，一致并且有意义?", "√", "", "", ""],
    ["2", "是否有冗余或无用的变量?", "", "√", "", ""],
    ["算法操作", "", "", "", "", ""],
    ["1", "被除数是否做了零值测试?", "√", "", "", ""],
    ["循环和分支", "", "", "", "", ""],
    ["1", "所有的循环，分支和逻辑构造是否完整，正确并且嵌套适当?", "√", "", "", ""],
    ["2", "每种状况是否都有缺省值?", "√", "", "", ""],
]

logger = logging.getLogger(__name__)

COVER_DEPT = "模型部"
SKIP_ANNEX_NUM = {"md_001", "md_004"}
DELETED_SRS_VERSION_PREFIX = "__deleted_srs__"
MD022_ID_COLS = ("算法设计ID", "训练集构建", "调优集构建ID", "算法训练ID", "测试集构建ID", "算法测试ID")
MD022_MODULE_DOC_TYPES = {
    "肺栓塞分诊": {
        "算法设计ID": "md_004",
        "训练集构建": "md_009_01",
        "调优集构建ID": "md_010_01",
        "算法训练ID": "md_012_01",
        "测试集构建ID": "md_011_01",
        "算法测试ID": "md_013_01",
    },
    "肺叶分割": {
        "算法设计ID": "md_004",
        "训练集构建": "md_009_02",
        "调优集构建ID": "md_010_02",
        "算法训练ID": "md_012_02",
        "测试集构建ID": "md_011_02",
        "算法测试ID": "md_013_02",
    },
}
MD022_FILE_TYPES = sorted({dt for mapping in MD022_MODULE_DOC_TYPES.values() for dt in mapping.values()})
MD022_MODULES = ("肺栓塞分诊", "肺叶分割", "气管分割", "肺血管分割")
ENV_CHECK_GROUPS = {
    ("md_019", "server"): [
        ("日期", []),
        ("硬件环境", ["CPU", "GPU", "内存", "网卡"]),
        ("软件环境", ["操作系统\n运行是否正常", "数据库\n运行是否正常", "应用服务\n运行是否正常"]),
        ("开发环境\n是否更新升级", []),
        ("服务器\n是否杀毒", []),
        ("网络环境\n是否正常", []),
        ("开发工具", ["是否正常运行", "是否更新升级"]),
        ("服务器\n是否备份", []),
        ("服务器\n日志是否错误", []),
        ("出现的问题及处理方式", []),
        ("检查人", []),
    ],
    ("md_019", "dev"): [
        ("日期", []),
        ("硬件环境", ["CPU", "GPU", "内存", "网卡"]),
        ("软件环境", ["操作系统\n运行是否正常", "浏览器\n运行是否正常"]),
        ("开发环境\n是否更新升级", []),
        ("开发机\n是否杀毒", []),
        ("网络环境\n是否正常", []),
        ("开发工具", ["是否正常运行", "是否更新升级"]),
        ("出现的问题及处理方式", []),
        ("检查人", []),
    ],
    ("md_020", "server"): [
        ("日期", []),
        ("硬件环境", ["CPU", "GPU", "内存", "网卡"]),
        ("软件环境", ["操作系统\n运行是否正常", "数据库\n运行是否正常", "应用服务\n运行是否正常"]),
        ("测试环境\n是否更新升级", []),
        ("服务器\n是否杀毒", []),
        ("网络环境\n是否正常", []),
        ("测试工具", ["是否正常运行", "是否更新升级"]),
        ("服务器\n是否备份", []),
        ("服务器\n日志是否错误", []),
        ("出现的问题及处理方式", []),
        ("检查人", []),
    ],
    ("md_020", "dev"): [
        ("日期", []),
        ("硬件环境", ["CPU", "GPU", "内存", "网卡"]),
        ("软件环境", ["操作系统\n运行是否正常", "浏览器\n运行是否正常"]),
        ("测试环境\n是否更新升级", []),
        ("测试机\n是否杀毒", []),
        ("网络环境\n是否正常", []),
        ("测试工具", ["是否正常运行", "是否更新升级"]),
        ("出现的问题及处理方式", []),
        ("检查人", []),
    ],
}
_MD007_IMG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "src-res", "model_doc", "md_007"
)
_MD007_IMG_FILES = {
    "fig1": "fig1_overview.png",
    "pe_flow": "pe_flow.png",
    "fig2": "fig2_patch.png",
    "fig3": "fig3_unet.png",
    "fig4": "fig4_receptive.png",
    "lobe_flow": "lobe_flow.png",
    "recon_flow": "recon_flow.png",
    "cube": "cube.png",
}
_MD007_IMG_CACHE = {}


def doc_title(doc_type):
    return (DOC_META.get(doc_type) or {}).get("title") or "模型文件"


def doc_keywords(doc_type):
    return list((DOC_META.get(doc_type) or {}).get("keywords") or [])


def doc_format(doc_type):
    return (DOC_META.get(doc_type) or {}).get("format") or "docx"


def _empty_template(doc_type):
    title = doc_title(doc_type)
    return {
        "sections": [
            {
                "title": title, "ref_type": "cover", "body": "", "children": [],
                "tables": [[
                    ["编制部门", COVER_DEPT, "文件版本", "A0"],
                    ["编制人", "", "日期", ""],
                    ["审核人", "", "日期", ""],
                    ["批准人", "", "日期", ""],
                    ["生效日期", "", "", ""],
                ]],
            },
            {
                "title": "文件修订记录", "ref_type": "revision", "body": "", "children": [],
                "tables": [[
                    ["修改日期", "版本号", "修订说明", "修订人", "批准人"],
                    ["", "", "首次发布", "", ""],
                    ["", "", "", "", ""],
                    ["", "", "", "", ""],
                    ["", "", "", "", ""],
                    ["", "", "", "", ""],
                ]],
            },
        ]
    }


class Server(object):

    def __default_content(self, doc_type, product_id=None):
        if doc_type in EQ_DOC_TYPES:
            return {"rows": self.__eq_default_rows(doc_type)}
        if doc_type in CRR_DOC_TYPES:
            return self.__crr_default_content(doc_type)
        if doc_type in BUILD_DOC_TYPES:
            return self.__build_default_content(doc_type)
        if doc_type in TRAIN_DOC_TYPES:
            return self.__train_default_content(doc_type)
        if doc_type in TEST_DOC_TYPES:
            return self.__test_default_content(doc_type)
        if doc_type in PKG_DOC_TYPES:
            content = self.__pkg_default_content(doc_type)
            if doc_type in ("md_016", "md_018"):
                self.__fill_model_func_row(content, product_id, doc_type)
            return content
        raw = DEFAULT_CONTENTS.get(doc_type)
        content = copy.deepcopy(raw) if raw else _empty_template(doc_type)
        self.__drop_product_info(content)
        self.__ensure_review_annex(content, doc_type)
        if doc_type == "md_007":
            self.__fill_md007_algo_info(content)
        if doc_type in ("md_019", "md_020"):
            self.__complete_env_maint_chapter(content, doc_type)
        if doc_type == "pd_003":
            self.__fill_algo_chapters(content, product_id, "pd_003")
        if doc_type == "md_004":
            self.__fill_algo_chapters(content, product_id, "md_004")
        if doc_type in ("md_007", "md_014", "md_016", "md_018"):
            self.__fill_algo_chapters(content, product_id, doc_type)
        return content

    def __fill_algo_chapters(self, content, product_id=None, doc_type=None):
        """pd_003/md_004/md_007/md_014/md_016/md_018：模块/模型功能从章节模块管理获取。
        pd_003: 「算法描述及要求」下的二级章节
        md_004: 「各功能模块设计」下的二级章节
        md_007/md_014: 顶级模块章节（xxx模块/xxx测试）整章替换
        md_016/md_018: 表格中的「模型功能」/「功能」字段值自动填充
        """
        if not isinstance(content, dict):
            return
        if doc_type in ("md_007", "md_014"):
            self.__fill_md007_chapters(content, product_id, doc_type)
            return
        if doc_type in ("md_016", "md_018"):
            self.__fill_model_func_row(content, product_id, doc_type)
            return
        if not isinstance(content.get("sections"), list):
            return
        # 不同 doc_type 对应的目标章节名
        target_title = "算法描述及要求" if doc_type == "pd_003" else "各功能模块设计"
        # 找到目标章节
        algo_section = None
        for s in content["sections"]:
            if target_title in str(s.get("title") or ""):
                algo_section = s
                break
            for c in (s.get("children") or []):
                if target_title in str(c.get("title") or ""):
                    algo_section = c
                    break
            if algo_section:
                break
        if not algo_section:
            return
        # 从章节模块管理获取模块列表
        modules = []
        if product_id:
            rows = db.session.execute(
                select(ProdAlgoChapter)
                .where(ProdAlgoChapter.prod_id == product_id)
                .order_by(ProdAlgoChapter.sort_order.asc(), ProdAlgoChapter.id.asc())
            ).scalars().all()
            modules = [r.name for r in rows if r.name]
        if not modules:
            return  # 没有章节模块数据时保留模板默认
        # 保留原有模块的子章节内容（算法描述/算法要求），作为模板
        old_children = algo_section.get("children") or []
        default_template = old_children[0] if old_children else {
            "title": "", "body": "", "tables": [], "children": [
                {"title": "算法描述", "body": "", "tables": [], "children": []},
                {"title": "算法要求", "body": "", "tables": [], "children": []},
            ],
        }
        # 建立旧模块名 → 旧 child 的映射，用于按名匹配（保留用户编辑过的内容）
        # 先精确匹配完整名，再去掉"模块"后缀模糊匹配
        old_map_exact = {}
        old_map_fuzzy = {}
        for oc in old_children:
            old_name = str(oc.get("title") or "").strip()
            if old_name:
                old_map_exact[old_name] = oc
            old_key = old_name.replace("模块", "").strip()
            if old_key and old_key not in old_map_fuzzy:
                old_map_fuzzy[old_key] = oc
        # 用章节模块名重建二级章节，保留已有模块的内容
        new_children = []
        for name in modules:
            match_key = name.replace("模块", "").strip()
            if name in old_map_exact:
                # 精确匹配，保留原有完整内容，不改 title
                child = copy.deepcopy(old_map_exact[name])
            elif match_key in old_map_fuzzy:
                # 模糊匹配（去掉"模块"后缀相同），保留原有内容，只改 title
                child = copy.deepcopy(old_map_fuzzy[match_key])
                child["title"] = name
            else:
                # 相似度匹配：找最长公共子串≥3字的旧模块（如"肺栓塞分诊"~"肺栓塞分割"）
                best_oc = None
                best_len = 0
                for old_key, oc in old_map_fuzzy.items():
                    # 计算最长公共子串长度
                    m, n = len(match_key), len(old_key)
                    if m == 0 or n == 0:
                        continue
                    # DP求最长公共子串
                    prev = [0] * (n + 1)
                    cur = [0] * (n + 1)
                    common = 0
                    for i in range(1, m + 1):
                        cur = [0] * (n + 1)
                        for j in range(1, n + 1):
                            if match_key[i - 1] == old_key[j - 1]:
                                cur[j] = prev[j - 1] + 1
                                if cur[j] > common:
                                    common = cur[j]
                        prev = cur
                    if common >= 3 and common > best_len:
                        best_len = common
                        best_oc = oc
                if best_oc is not None:
                    # 相似匹配到旧模块，复用其内容，只改 title
                    child = copy.deepcopy(best_oc)
                    child["title"] = name
                else:
                    # 未匹配，用第一个旧 child 做模板，把旧关键词替换为新模块名
                    child = copy.deepcopy(default_template)
                    old_keyword = str(default_template.get("title") or "").replace("模块", "").strip()
                    child["title"] = name
                    # 替换三级目录 body 中的旧模块关键词为新模块名
                    for sub in (child.get("children") or []):
                        if sub.get("body"):
                            sub["body"] = sub["body"].replace(old_keyword, name)
                    # 替换本节点 body 中的旧关键词
                    if child.get("body"):
                        child["body"] = child["body"].replace(old_keyword, name)
            new_children.append(child)
        algo_section["children"] = new_children

    def __fill_model_func_row(self, content, product_id=None, doc_type=None):
        """md_016模型工程封装记录/md_018模型服务提交记录：「模型功能」从章节模块管理填充。
        md_016: 扁平表单结构，字段 model_func
        md_018: sections 结构，表格中「功能」行
        """
        # 从章节模块管理获取模块列表，逗号拼接
        modules = []
        if product_id:
            rows = db.session.execute(
                select(ProdAlgoChapter)
                .where(ProdAlgoChapter.prod_id == product_id)
                .order_by(ProdAlgoChapter.sort_order.asc(), ProdAlgoChapter.id.asc())
            ).scalars().all()
            modules = [r.name for r in rows if r.name]
        if not modules:
            return
        func_value = "，".join(modules)
        # 扁平表单结构（md_016）：model_func 字段
        if isinstance(content, dict) and isinstance(content.get("model_func"), str):
            content["model_func"] = func_value
            logger.info("md_016 model_func filled from prod_algo_chapter: %s", func_value)
            return
        # sections 表格结构（md_018）：表格中「模型功能」/「功能」行
        labels = ("模型功能", "功能")
        filled = False
        for s in (content.get("sections") or []):
            for tbl in (s.get("tables") or []):
                for r in tbl:
                    if not isinstance(r, list) or not r:
                        continue
                    key = str(r[0]).strip()
                    if key in labels and len(r) >= 2:
                        r[1] = func_value
                        filled = True
        if filled:
            logger.info("md_018 model func row filled from prod_algo_chapter: %s", func_value)

    def __fill_md007_chapters(self, content, product_id=None, doc_type=None):
        """md_007/md_014：顶级模块章节按章节模块管理重建，保留匹配模块的内容。
        md_007: xxx模块（算法介绍/模块设计描述）
        md_014: xxx测试/xxx模型测试（测试指标/测试数据/测试结果等）
        """
        sections = content.get("sections") or []
        # 固定章节名（两个文档共有的固定章节）
        fixed_titles = {
            "算法方案详细设计", "文件修订记录", "产品信息", "概述", "算法基本信息", "参考文献", "算法介绍",
            "模型测试报告", "参考文件", "引言", "测试环境", "硬件环境", "软件环境", "附件1 评审记录",
            "测试目的", "测试背景", "测试范围", "术语及缩略语",
        }
        # md_014 模块章节特征：子章节含"测试指标"，或标题以"测试"/"模型测试"结尾
        sub_markers = ["算法介绍", "测试指标"]
        module_indexes = []
        for i, s in enumerate(sections):
            title = str(s.get("title") or "").strip()
            if not title or title in fixed_titles:
                continue
            if s.get("ref_type") in ("cover", "revision", "basic_info"):
                continue
            # 顶级模块章节：子章节含特征标记，或标题以"模块"/"测试"结尾
            child_titles = [str(c.get("title") or "") for c in (s.get("children") or [])]
            has_marker = any(m in child_titles for m in sub_markers)
            if has_marker or title.endswith("模块") or title.endswith("测试"):
                module_indexes.append(i)
        if not module_indexes:
            return
        # 从章节模块管理获取模块列表
        modules = []
        if product_id:
            rows = db.session.execute(
                select(ProdAlgoChapter)
                .where(ProdAlgoChapter.prod_id == product_id)
                .order_by(ProdAlgoChapter.sort_order.asc(), ProdAlgoChapter.id.asc())
            ).scalars().all()
            modules = [r.name for r in rows if r.name]
        if not modules:
            return
        old_module_sections = [sections[i] for i in module_indexes]
        first_idx = module_indexes[0]
        default_template = old_module_sections[0]
        # 建立旧模块名映射（精确+去"模块"后缀模糊）
        old_map_exact = {}
        old_map_fuzzy = {}
        for oc in old_module_sections:
            old_name = str(oc.get("title") or "").strip()
            if old_name:
                old_map_exact[old_name] = oc
            old_key = old_name.replace("模块", "").strip()
            if old_key and old_key not in old_map_fuzzy:
                old_map_fuzzy[old_key] = oc

        def best_fuzzy(name):
            """相似度匹配：最长公共子串≥3字"""
            mk = name.replace("模块", "").strip()
            best_oc, best_len = None, 0
            for old_key, oc in old_map_fuzzy.items():
                m, n = len(mk), len(old_key)
                if m == 0 or n == 0:
                    continue
                prev = [0] * (n + 1)
                common = 0
                for i in range(1, m + 1):
                    cur = [0] * (n + 1)
                    for j in range(1, n + 1):
                        if mk[i - 1] == old_key[j - 1]:
                            cur[j] = prev[j - 1] + 1
                            if cur[j] > common:
                                common = cur[j]
                    prev = cur
                if common >= 3 and common > best_len:
                    best_len = common
                    best_oc = oc
            return best_oc

        # 按章节模块名重建顶级模块章节
        new_sections = []
        for name in modules:
            match_key = name.replace("模块", "").strip()
            if name in old_map_exact:
                sec = copy.deepcopy(old_map_exact[name])
            elif match_key in old_map_fuzzy:
                sec = copy.deepcopy(old_map_fuzzy[match_key])
                sec["title"] = name
            else:
                best_oc = best_fuzzy(name)
                if best_oc is not None:
                    sec = copy.deepcopy(best_oc)
                    sec["title"] = name
                else:
                    sec = copy.deepcopy(default_template)
                    sec["title"] = name
                    old_title = str(default_template.get("title") or "").strip()
                    old_keyword = old_title.replace("模块", "").strip()
                    # 替换各级内容中的旧关键词为新模块名（先替换带"模块"的全名，再替换短名）
                    def replace_kw(node):
                        if node.get("body"):
                            node["body"] = node["body"].replace(old_title, name).replace(old_keyword, name)
                        for tbl in (node.get("tables") or []):
                            for r in tbl:
                                for i in range(len(r)):
                                    if isinstance(r[i], str):
                                        r[i] = r[i].replace(old_title, name).replace(old_keyword, name)
                        for c in (node.get("children") or []):
                            replace_kw(c)
                    replace_kw(sec)
            new_sections.append(sec)
        # 替换原模块章节区间：删除旧的，在原第一个模块章节位置插入新的
        content["sections"] = sections[:first_idx] + new_sections + sections[module_indexes[-1] + 1:]

    def __to_obj(self, row: ModelDoc, product: Product = None):
        obj = ModelDocObj(**row.dict())
        obj.content = self.__normalize_content(obj.content, row.doc_type, product_id=row.product_id)
        key = row.doc_type or ""
        # pd_003/md_004/md_007/md_014/md_016/md_018：查看时从章节模块管理自动获取（不修改数据库，只影响返回内容）
        if key in ("pd_003", "md_004", "md_007", "md_014", "md_016", "md_018"):
            self.__fill_algo_chapters(obj.content, row.product_id, key)
        fill_chapter_images(obj.content, key)
        if key not in EQ_DOC_TYPES and key not in CRR_DOC_TYPES and key not in BUILD_DOC_TYPES and key not in TRAIN_DOC_TYPES and key not in TEST_DOC_TYPES and key not in PKG_DOC_TYPES:
            self.__fill_cover_meta(obj.content, obj.version)
            serv_review_util.fill_cover_dates(
                obj.content, serv_review_util.cover_date(row.product_id, key) if row.product_id else ""
            )
            serv_review_util.fill_cover_signers(
                obj.content, serv_review_util.cover_signers(row.product_id, key) if row.product_id else {}
            )
            serv_review_util.fill_annex_reviews(
                obj.content, row.product_id, key, getattr(product, "name", "") or ""
            )
        if product:
            obj.product_name = product.name
            obj.product_version = product.full_version
            obj.product_full_version = product.full_version
            obj.product_type_code = product.type_code
            if not (obj.file_no or "").strip():
                resolved = serv_review_util.resolve_doc_file_no(product.id, obj.file_no, obj.version, key)
                if resolved:
                    obj.file_no = resolved
        return obj

    @staticmethod
    def __migrate_cover_table(rows):
        """把旧版 2 列或「使用部门/版本号」封面迁移为 4 列：编制部门 / 模型部。"""
        rows = [r for r in (rows or []) if isinstance(r, list)]
        if rows and len(rows[0]) >= 4 and str(rows[0][0]).strip() == "编制部门":
            if not str(rows[0][1] if len(rows[0]) > 1 else "").strip():
                rows[0][1] = COVER_DEPT
            return rows
        items = [(str(r[0]).strip(), str(r[1]).strip() if len(r) > 1 else "") for r in rows if r]
        def val(*labels):
            for want in labels:
                for l, v in items:
                    if l == want:
                        return v
            return ""
        dates = [v for l, v in items if l == "日期"]
        d = lambda i: dates[i] if i < len(dates) else ""
        dept = val("编制部门", "使用部门", "编写部门") or COVER_DEPT
        ver = val("文件版本", "版本号") or "A0"
        return [
            ["编制部门", dept, "文件版本", ver],
            ["编制人", val("编制人"), "日期", d(0)],
            ["审核人", val("审核人"), "日期", d(1)],
            ["批准人", val("批准人"), "日期", d(2)],
            ["生效日期", val("生效日期"), "", ""],
        ]

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
        if result.get("ref_type") == "cover" and norm_tables:
            norm_tables = [self.__migrate_cover_table(norm_tables[0])] + norm_tables[1:]
        result["tables"] = norm_tables
        children = result.get("children")
        result["children"] = [self.__normalize_node(c) for c in children] if isinstance(children, list) else []
        return result

    def __eq_default_rows(self, doc_type):
        found = self.__extract_eq_rows(DEFAULT_CONTENTS.get(doc_type) or {})
        if found:
            return found
        return [["序号", "名称", "规格型号", "品牌", "资产编码/SN码", "类别", "用途", "地点", "使用人", "状态"]]

    def __extract_eq_rows(self, content):
        if not isinstance(content, dict):
            return None
        rows = content.get("rows")
        if isinstance(rows, list) and rows and isinstance(rows[0], list):
            hdr = [str(c or "") for c in rows[0]]
            if any("资产编码" in h for h in hdr) or (hdr and hdr[0].strip() == "序号"):
                return [[str(c or "") for c in r] for r in rows if isinstance(r, list)]

        def walk(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                for tb in n.get("tables") or []:
                    if not isinstance(tb, list):
                        continue
                    for i, row in enumerate(tb):
                        if not isinstance(row, list):
                            continue
                        cells = [str(c or "").strip() for c in row]
                        if cells and cells[0] == "序号" and any("资产编码" in c for c in cells):
                            return [[str(c or "") for c in r] for r in tb[i:] if isinstance(r, list)]
                hit = walk(n.get("children") or [])
                if hit:
                    return hit
            return None

        return walk(content.get("sections") or [])

    def __normalize_eq_content(self, content, doc_type):
        rows = self.__extract_eq_rows(content)
        return {"rows": rows or self.__eq_default_rows(doc_type)}

    def __crr_default_content(self, doc_type):
        return {
            "code_url": _MD008_URL.get(doc_type) or "",
            "check_date": "",
            "auditee": "",
            "auditor": "",
            "basis": "《代码管理制度》",
            "method": "代码审查",
            "checklist": copy.deepcopy(_MD008_CHECKLIST),
            "conclusion": "",
            "sign_img": "",
            "sign_date": "",
        }

    def __extract_crr_from_grid(self, tb):
        if not isinstance(tb, list):
            return None
        out = self.__crr_default_content("md_008_01")
        out["checklist"] = [["编号", "问题", "是", "否", "不适用", "备注"]]
        found = False
        for row in tb:
            if not isinstance(row, list):
                continue
            cells = [str(c or "").strip() for c in row]
            a = cells[0] if cells else ""
            if a == "代码地址":
                found = True
                out["code_url"] = cells[2] if len(cells) > 2 and cells[2] else (cells[1] if len(cells) > 1 else "")
                if len(cells) > 5 and cells[5]:
                    out["check_date"] = cells[5]
                elif len(cells) > 3 and cells[2] == "检查日期":
                    out["check_date"] = cells[3] if len(cells) > 3 else ""
            elif a == "被审核人":
                found = True
                out["auditee"] = cells[2] if len(cells) > 2 else (cells[1] if len(cells) > 1 else "")
                if len(cells) > 5:
                    out["auditor"] = cells[5]
            elif a == "审核依据":
                out["basis"] = cells[2] if len(cells) > 2 and cells[2] else (cells[1] if len(cells) > 1 else out["basis"])
            elif a == "审核方式":
                out["method"] = cells[2] if len(cells) > 2 and cells[2] else (cells[1] if len(cells) > 1 else out["method"])
            elif a in _CRR_CATEGORIES:
                out["checklist"].append([a, "", "", "", "", ""])
            elif a.startswith("结论"):
                joined = "".join(cells)
                for name in _CRR_CONCLUSIONS:
                    if name in joined:
                        out["conclusion"] = name
                        break
            elif "签字" in a:
                sign = cells[2] if len(cells) > 2 else ""
                if sign:
                    out["sign_img"] = sign
            elif a == "编号" or (a and "问题" in "".join(cells)):
                continue
            elif a.isdigit():
                if len(cells) >= 7:
                    out["checklist"].append([cells[0], cells[1], cells[3], cells[4], cells[5], cells[6]])
                elif len(cells) >= 6:
                    out["checklist"].append(cells[:6])
        if found:
            out["checklist"] = self.__complete_crr_checklist(out.get("checklist"))
        return out if found else None

    def __crr_pad_row(self, row):
        cells = [str(c or "") for c in (row or [])]
        while len(cells) < 6:
            cells.append("")
        return cells[:6]

    def __crr_parse_groups(self, rows):
        groups = {cat: [] for cat in _CRR_CATEGORIES}
        current = None
        pending = []
        for row in rows or []:
            if not isinstance(row, list):
                continue
            cells = self.__crr_pad_row(row)
            a = cells[0].strip()
            if a == "编号" or ("问题" in "".join(cells[:2]) and not a.isdigit()):
                continue
            if a in _CRR_CATEGORIES:
                current = a
                continue
            if a.isdigit():
                if current:
                    groups[current].append(cells)
                else:
                    pending.append(cells)
        if pending:
            groups["结构"] = pending + groups["结构"]
        return groups

    def __complete_crr_checklist(self, rows):
        """丢掉文件编号/标题空行；缺的分类用默认检查表补，已有分类（含勾选）保留。"""
        groups = self.__crr_parse_groups(rows)
        default_groups = self.__crr_parse_groups(_MD008_CHECKLIST)
        out = [["编号", "问题", "是", "否", "不适用", "备注"]]
        for cat in _CRR_CATEGORIES:
            out.append([cat, "", "", "", "", ""])
            out.extend(groups[cat] or default_groups[cat])
        return out

    def __normalize_crr_content(self, content, doc_type):
        base = self.__crr_default_content(doc_type)
        if not isinstance(content, dict):
            return base
        if isinstance(content.get("checklist"), list) and content.get("checklist"):
            for key in base:
                if content.get(key) is not None:
                    base[key] = content.get(key)
            base["code_url"] = str(base.get("code_url") or "").replace("\t", "  ")
            base["checklist"] = self.__complete_crr_checklist(base.get("checklist"))
            return base
        extracted = None

        def walk(ns):
            nonlocal extracted
            for n in ns or []:
                if extracted or not isinstance(n, dict):
                    continue
                for tb in n.get("tables") or []:
                    extracted = self.__extract_crr_from_grid(tb)
                    if extracted:
                        return
                walk(n.get("children") or [])

        walk(content.get("sections") or [])
        if extracted:
            extracted["code_url"] = extracted.get("code_url") or base["code_url"]
            extracted["basis"] = extracted.get("basis") or base["basis"]
            extracted["method"] = extracted.get("method") or base["method"]
            extracted["checklist"] = self.__complete_crr_checklist(extracted.get("checklist"))
            return extracted
        return base

    def __build_default_content(self, doc_type):
        raw = BUILD_DEFAULTS.get(doc_type) or BUILD_DEFAULTS.get("md_009_01") or {}
        return copy.deepcopy(raw)

    def __build_fmt_pct(self, v):
        s = str(v if v is not None else "").strip()
        if not s:
            return ""
        if s.endswith("%"):
            return s
        try:
            n = float(s)
        except Exception:
            return s
        if abs(n - 1) < 1e-9:
            return "100.00%"
        if abs(n) <= 1.0001:
            return f"{n * 100:.2f}%"
        return f"{n:.2f}%"

    def __build_pad_row(self, row):
        cells = [str(c if c is not None else "") for c in (row or [])]
        while len(cells) < 4:
            cells.append("")
        return cells[:4]

    def __build_parse_qty(self, v):
        s = str(v if v is not None else "").replace(",", "").strip()
        if not s:
            return 0.0
        try:
            return float(s)
        except Exception:
            return 0.0

    def __build_parse_pct(self, v):
        s = str(v if v is not None else "").strip()
        if not s:
            return 0.0
        if s.endswith("%"):
            try:
                return float(s[:-1].strip() or 0)
            except Exception:
                return 0.0
        try:
            n = float(s)
        except Exception:
            return 0.0
        return n * 100.0 if abs(n) <= 1.0001 else n

    def __build_fill_total(self, dist):
        """总计数量/占比按紧挨其上的最后一组因素求和，避免把性别+年龄+设备重复相加。"""
        rows = [self.__build_pad_row(r) for r in (dist or []) if isinstance(r, list)]
        if not rows:
            return [["因素", "类别", "数量", "占比"], ["总计", "", "0", "0.00%"]]
        if str(rows[0][0]).strip() != "因素":
            rows = [["因素", "类别", "数量", "占比"]] + rows
        total_at = next((i for i, r in enumerate(rows) if str(r[0]).strip() == "总计"), -1)
        end = total_at if total_at >= 0 else len(rows)
        start = 1
        for i in range(end - 1, 0, -1):
            a = str(rows[i][0]).strip()
            if a and a != "总计":
                start = i
                break
        qty = 0.0
        pct = 0.0
        for i in range(start, end):
            qty += self.__build_parse_qty(rows[i][2])
            pct += self.__build_parse_pct(rows[i][3])
        qty_s = str(int(round(qty))) if abs(qty - round(qty)) < 1e-9 else str(qty)
        if pct == 0 and qty > 0:
            pct_s = "100.00%"
        elif abs(pct - 100) < 0.05:
            pct_s = "100.00%"
        else:
            pct_s = f"{pct:.2f}%"
        total_row = ["总计", "", qty_s, pct_s]
        if total_at >= 0:
            rows[total_at] = total_row
        else:
            rows.append(total_row)
        return rows

    def __kernel_first(self, raw):
        s = str(raw or "").strip()
        if not s or s in ("none", "(空)"):
            return ""
        if s.startswith("["):
            inner = s.strip("[]")
            s = inner.split(",")[0].strip().strip("'\"") or s
        for sep in ("\\", ",", "/", ";"):
            if sep in s:
                s = s.split(sep)[0].strip()
                break
        return s.strip("'\"")

    def __iter_case_rows(self, content):
        def walk(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                rows = n.get("case_rows")
                if isinstance(rows, list):
                    for r in rows:
                        if isinstance(r, dict):
                            yield r
                yield from walk(n.get("children") or [])
        yield from walk((content or {}).get("sections") or [])

    def __kernel_series_prefix(self, name):
        u = str(name or "").strip().upper()
        if u.endswith("系列"):
            u = u[:-2]
        if not u or u in ("LUNG", "SOFT"):
            return None
        if u == "B" or re.match(r"^B[A-Z]{0,2}\d", u):
            return "B"
        if u == "Y" or re.match(r"^Y[A-Z0-9]", u):
            return "Y"
        if u == "FC" or re.match(r"^FC\d", u):
            return "FC"
        if u == "I" or re.match(r"^I\d", u):
            return "I"
        return None

    def __kernel_rows_from_pairs(self, pairs, total_n):
        counts = {}
        order = []
        for raw, qty in pairs or []:
            name = self.__kernel_first(raw)
            if not name:
                continue
            q = float(qty or 0)
            if q <= 0:
                continue
            u = name.strip()
            up = u.upper()
            prefix = self.__kernel_series_prefix(name)
            if prefix:
                lab = "%s系列" % prefix
            elif up in ("LUNG", "SOFT"):
                lab = up
            else:
                lab = name
            if lab not in counts:
                order.append(lab)
                counts[lab] = 0.0
            counts[lab] += q
        if not counts or total_n <= 0:
            return []
        kept = []
        other = 0.0
        for lab in order:
            c = counts[lab]
            if lab.endswith("系列"):
                kept.append((lab, c))
                continue
            if lab == "其他" or c < 5:
                other += c
                continue
            kept.append((lab, c))
        if other > 0:
            kept.append(("其他", other))
        out = []
        first = True
        for lab, c in kept:
            qty_s = str(int(round(c))) if abs(c - round(c)) < 1e-9 else str(c)
            out.append(["重建算法" if first else "", lab, qty_s, self.__build_fmt_pct(c / total_n)])
            first = False
        return out

    def __kernel_dist_from_content(self, content):
        pairs = []
        n = 0
        any_real = False
        for row in self.__iter_case_rows(content):
            n += 1
            raw = row.get("ConvolutionKernel")
            if self.__kernel_first(raw):
                any_real = True
                pairs.append((raw, 1))
        if not any_real or n <= 0:
            return []
        return self.__kernel_rows_from_pairs(pairs, n)

    def __ensure_kernel_dist(self, dist, content):
        rows = [self.__build_pad_row(r) for r in (dist or []) if isinstance(r, list)]
        if not rows:
            return dist
        old_pairs = []
        i = 1
        while i < len(rows):
            a = str(rows[i][0]).strip()
            if a == "总计":
                break
            if a in ("重建算法", "卷积核"):
                j = i + 1
                while j < len(rows) and not str(rows[j][0]).strip():
                    j += 1
                for k in range(i, j):
                    old_pairs.append((rows[k][1], self.__build_parse_qty(rows[k][2])))
                rows[i:j] = []
                continue
            i += 1
        block = self.__kernel_dist_from_content(content)
        if not block and old_pairs:
            total = sum(q for _, q in old_pairs) or 1.0
            block = self.__kernel_rows_from_pairs(old_pairs, total)
        if block:
            total_at = next((k for k, r in enumerate(rows) if str(r[0]).strip() == "总计"), len(rows))
            insert_at = total_at
            t = 1
            while t < total_at:
                a = str(rows[t][0]).strip()
                if a == "设备":
                    j = t + 1
                    while j < total_at and not str(rows[j][0]).strip():
                        j += 1
                    insert_at = j
                    break
                t += 1
            rows[insert_at:insert_at] = block
        return self.__build_fill_total(rows)

    def __extract_build_from_grid(self, tb):
        if not isinstance(tb, list):
            return None
        out = {
            "author": "", "write_date": "", "data_use": "", "data_type": "",
            "method": "", "case_count": "", "annotator": "",
            "dist_rows": [["因素", "类别", "数量", "占比"]],
            "author_sign": "", "auditor_sign": "",
        }
        found = False
        in_dist = False
        for row in tb:
            if not isinstance(row, list):
                continue
            cells = self.__build_pad_row(row)
            a, b, c, d = [x.strip() for x in cells]
            if a == "编写人":
                found = True
                out["author"] = b
                if c == "编写时间":
                    out["write_date"] = d
            elif a == "数据用途":
                found = True
                out["data_use"] = b
                if c == "数据类型":
                    out["data_type"] = d
            elif a == "构建方法":
                out["method"] = b or c
            elif a == "病例数量":
                out["case_count"] = b
                if "标记" in c:
                    out["annotator"] = d
            elif a == "数据分布":
                in_dist = True
            elif a == "因素" and "类别" in (b + c):
                in_dist = True
            elif "签字" in a:
                out["author_sign"] = b
                if "审核" in c:
                    out["auditor_sign"] = d
                in_dist = False
            elif in_dist and (a or b or c or d):
                if a == "总计":
                    out["dist_rows"].append(["总计", "", c or b, self.__build_fmt_pct(d or "1")])
                else:
                    out["dist_rows"].append([a, b, c, self.__build_fmt_pct(d)])
        return out if found else None

    def __normalize_build_content(self, content, doc_type):
        base = self.__build_default_content(doc_type)
        if not isinstance(content, dict):
            base["dist_rows"] = self.__build_fill_total(base.get("dist_rows") or [])
            return base
        if isinstance(content.get("dist_rows"), list) and content.get("dist_rows"):
            for key in base:
                if content.get(key) is not None:
                    base[key] = content.get(key)
            dist = []
            for r in base.get("dist_rows") or []:
                if not isinstance(r, list):
                    continue
                cells = self.__build_pad_row(r)
                dist.append(cells)
            if not dist or str(dist[0][0]).strip() != "因素":
                dist = [["因素", "类别", "数量", "占比"]] + dist
            has_total = any(str(r[0]).strip() == "总计" for r in dist)
            if not has_total:
                base["dist_rows"] = self.__build_default_content(doc_type)["dist_rows"]
            else:
                for r in dist:
                    if str(r[0]).strip() not in ("因素", "总计"):
                        r[3] = self.__build_fmt_pct(r[3])
                base["dist_rows"] = dist
            base["dist_rows"] = self.__build_fill_total(base.get("dist_rows") or [])
            return base
        extracted = None

        def walk(ns):
            nonlocal extracted
            for n in ns or []:
                if extracted or not isinstance(n, dict):
                    continue
                for tb in n.get("tables") or []:
                    extracted = self.__extract_build_from_grid(tb)
                    if extracted:
                        return
                walk(n.get("children") or [])

        walk(content.get("sections") or [])
        if extracted:
            for k in ("author", "write_date", "data_use", "data_type", "method", "case_count", "annotator"):
                extracted[k] = extracted.get(k) or base[k]
            has_total = any(r and str(r[0]).strip() == "总计" for r in extracted.get("dist_rows") or [])
            if not has_total:
                extracted["dist_rows"] = base["dist_rows"]
            extracted["dist_rows"] = self.__build_fill_total(extracted.get("dist_rows") or [])
            return extracted
        base["dist_rows"] = self.__build_fill_total(base.get("dist_rows") or [])
        return base

    def __train_default_content(self, doc_type):
        raw = TRAIN_DEFAULTS.get(doc_type) or TRAIN_DEFAULTS.get("md_012_01") or {}
        return copy.deepcopy(raw)

    def __train_pad_row(self, row, n=3):
        cells = [str(c if c is not None else "") for c in (row or [])]
        while len(cells) < n:
            cells.append("")
        return cells[:n]

    def __train_fill_count(self, content):
        pts = content.get("eval_points") or []
        last = ""
        for r in pts:
            if not isinstance(r, list) or not r:
                continue
            a = str(r[0]).strip()
            if not a or a in ("数据量", "step"):
                continue
            last = a
        if last:
            content["case_count"] = last
        return content

    def __extract_train_from_grid(self, tb, doc_type):
        if not isinstance(tb, list):
            return None
        out = self.__train_default_content(doc_type)
        found = False
        for row in tb:
            if not isinstance(row, list):
                continue
            cells = [str(c or "").strip() for c in row]
            while len(cells) < 7:
                cells.append("")
            a = cells[0]
            if a == "编写人":
                found = True
                out["author"] = cells[1]
                if "编写日期" in cells:
                    i = cells.index("编写日期")
                    out["write_date"] = cells[i + 1] if i + 1 < len(cells) else ""
                if "审核人" in cells:
                    i = cells.index("审核人")
                    out["auditor"] = cells[i + 1] if i + 1 < len(cells) else ""
            elif a == "模型名称":
                found = True
                out["model_name"] = cells[1]
            elif a == "模型功能":
                out["model_func"] = cells[1]
            elif a == "训练集":
                out["train_set"] = cells[1]
                if "数量" in cells:
                    i = cells.index("数量")
                    out["case_count"] = cells[i + 1] if i + 1 < len(cells) else out["case_count"]
            elif a == "训练时间":
                out["train_time"] = cells[1]
            elif a == "硬件环境":
                out["hw_env"] = cells[1]
            elif a == "软件环境":
                out["sw_env"] = cells[1]
            elif a == "结论":
                out["conclusion"] = cells[1]
            elif "编写人" in a and "签字" in a:
                out["author_sign"] = cells[1]
                if any("审核人" in x for x in cells):
                    for i, x in enumerate(cells):
                        if "审核人" in x and i + 1 < len(cells):
                            out["auditor_sign"] = cells[i + 1]
                            break
        return out if found else None

    def __normalize_train_content(self, content, doc_type):
        base = self.__train_default_content(doc_type)
        if not isinstance(content, dict):
            return self.__train_fill_count(base)
        if isinstance(content.get("eval_points"), list) and content.get("eval_points"):
            for key in base:
                if content.get(key) is not None:
                    base[key] = content.get(key)
            if not isinstance(base.get("eval_points"), list) or not base["eval_points"]:
                base["eval_points"] = self.__train_default_content(doc_type)["eval_points"]
            if not isinstance(base.get("process_points"), list) or not base["process_points"]:
                base["process_points"] = self.__train_default_content(doc_type)["process_points"]
            return self.__train_fill_count(base)
        extracted = None

        def walk(ns):
            nonlocal extracted
            for n in ns or []:
                if extracted or not isinstance(n, dict):
                    continue
                for tb in n.get("tables") or []:
                    extracted = self.__extract_train_from_grid(tb, doc_type)
                    if extracted:
                        return
                walk(n.get("children") or [])

        walk(content.get("sections") or [])
        if extracted:
            return self.__train_fill_count(extracted)
        return self.__train_fill_count(base)

    def __test_default_content(self, doc_type):
        raw = TEST_DEFAULTS.get(doc_type) or TEST_DEFAULTS.get("md_013_01") or {}
        return copy.deepcopy(raw)

    def __test_ncols(self, doc_type):
        return 6 if doc_type == "md_013_01" else 5

    def __test_header(self, doc_type):
        if doc_type == "md_013_01":
            return ["因素", "类别", "阳性数据量", "阴性数据量", "灵敏度(95%CI区间)", "特异度(95%CI区间)"]
        return ["因素", "类别", "样本量", "dice均值", "dice方差"]

    def __test_qty_cols(self, doc_type):
        return (2, 3) if doc_type == "md_013_01" else (2,)

    def __test_pad_row(self, row, n):
        cells = [str(c if c is not None else "").replace("\xa0", "").strip() for c in (row or [])]
        while len(cells) < n:
            cells.append("")
        return cells[:n]

    def __test_fmt_dice(self, v):
        s = str(v if v is not None else "").strip()
        if not s:
            return ""
        try:
            return f"{float(s):.4f}"
        except Exception:
            return s

    def __test_fill_total(self, rows, doc_type):
        n = self.__test_ncols(doc_type)
        header = self.__test_header(doc_type)
        qty_cols = self.__test_qty_cols(doc_type)
        out = [self.__test_pad_row(r, n) for r in (rows or []) if isinstance(r, list)]
        if not out:
            out = [header[:]]
        if str(out[0][0]).strip() != "因素":
            out = [header[:]] + out
        if doc_type == "md_013_02":
            for r in out[1:]:
                for ci in (3, 4):
                    if ci < len(r):
                        r[ci] = self.__test_fmt_dice(r[ci])
        total_at = next((i for i, r in enumerate(out) if str(r[0]).strip() == "总计"), -1)
        end = total_at if total_at >= 0 else len(out)
        start = 1
        for i in range(end - 1, 0, -1):
            a = str(out[i][0]).strip()
            if a and a != "总计":
                start = i
                break
        sums = {ci: 0.0 for ci in qty_cols}
        for i in range(start, end):
            for ci in qty_cols:
                sums[ci] += self.__build_parse_qty(out[i][ci] if ci < len(out[i]) else "")
        old = out[total_at] if total_at >= 0 else [""] * n
        total = ["总计"] + [""] * (n - 1)
        for ci in range(1, n):
            if ci in qty_cols:
                q = sums[ci]
                total[ci] = str(int(round(q))) if abs(q - round(q)) < 1e-9 else str(q)
            else:
                total[ci] = old[ci] if ci < len(old) else ""
                if doc_type == "md_013_02" and ci in (3, 4):
                    total[ci] = self.__test_fmt_dice(total[ci])
        if total_at >= 0:
            out[total_at] = total
        else:
            out.append(total)
        return out

    def __extract_test_from_grid(self, tb, doc_type):
        if not isinstance(tb, list):
            return None
        n = self.__test_ncols(doc_type)
        out = self.__test_default_content(doc_type)
        out["result_rows"] = [self.__test_header(doc_type)]
        found = False
        in_result = False
        for row in tb:
            if not isinstance(row, list):
                continue
            cells = self.__test_pad_row(row, max(n, 6))
            a = cells[0]
            if a == "编写人":
                found = True
                out["author"] = cells[1]
                if "编写日期" in cells:
                    i = cells.index("编写日期")
                    out["write_date"] = cells[i + 1] if i + 1 < len(cells) else ""
                if "审核人" in cells:
                    i = cells.index("审核人")
                    out["auditor"] = cells[i + 1] if i + 1 < len(cells) else ""
            elif a == "测试模型名称":
                found = True
                out["model_name"] = cells[1]
            elif a == "测试集":
                out["test_set"] = cells[1]
            elif a == "测试方法":
                out["method"] = cells[1]
            elif a == "测试时间":
                out["test_time"] = cells[1]
            elif a == "硬件环境":
                out["hw_env"] = cells[1]
            elif a == "软件环境":
                out["sw_env"] = cells[1]
            elif a == "测试结果":
                in_result = True
            elif a == "因素" and "类别" in "".join(cells):
                in_result = True
            elif a.startswith("结论"):
                out["conclusion"] = cells[1] or (cells[2] if len(cells) > 2 else "")
                in_result = False
            elif "编写人" in a and "签字" in a:
                out["author_sign"] = cells[1]
                if any("审核人" in x for x in cells):
                    for i, x in enumerate(cells):
                        if "审核人" in x and i + 1 < len(cells):
                            out["auditor_sign"] = cells[i + 1]
                            break
                in_result = False
            elif in_result and any(cells[:n]):
                out["result_rows"].append(cells[:n])
        return out if found else None

    def __normalize_test_content(self, content, doc_type):
        base = self.__test_default_content(doc_type)
        n = self.__test_ncols(doc_type)
        header = self.__test_header(doc_type)
        if not isinstance(content, dict):
            base["result_rows"] = self.__test_fill_total(base.get("result_rows") or [], doc_type)
            return base
        if isinstance(content.get("result_rows"), list) and content.get("result_rows"):
            for key in base:
                if content.get(key) is not None:
                    base[key] = content.get(key)
            rows = [self.__test_pad_row(r, n) for r in (base.get("result_rows") or []) if isinstance(r, list)]
            if not rows or str(rows[0][0]).strip() != "因素":
                rows = [header[:]] + rows
            has_total = any(str(r[0]).strip() == "总计" for r in rows)
            if not has_total:
                base["result_rows"] = self.__test_default_content(doc_type)["result_rows"]
            else:
                base["result_rows"] = rows
            base["result_rows"] = self.__test_fill_total(base.get("result_rows") or [], doc_type)
            return base
        extracted = None

        def walk(ns):
            nonlocal extracted
            for n0 in ns or []:
                if extracted or not isinstance(n0, dict):
                    continue
                for tb in n0.get("tables") or []:
                    extracted = self.__extract_test_from_grid(tb, doc_type)
                    if extracted:
                        return
                walk(n0.get("children") or [])

        walk(content.get("sections") or [])
        if extracted:
            for k in ("author", "write_date", "auditor", "model_name", "test_set", "method", "test_time", "hw_env", "sw_env", "conclusion"):
                extracted[k] = extracted.get(k) or base[k]
            has_total = any(r and str(r[0]).strip() == "总计" for r in extracted.get("result_rows") or [])
            if not has_total:
                extracted["result_rows"] = base["result_rows"]
            extracted["result_rows"] = self.__test_fill_total(extracted.get("result_rows") or [], doc_type)
            return extracted
        base["result_rows"] = self.__test_fill_total(base.get("result_rows") or [], doc_type)
        return base

    def __pkg_default_content(self, doc_type):
        raw = PKG_DEFAULTS.get(doc_type) or PKG_DEFAULTS.get("md_015_01") or {}
        return copy.deepcopy(raw)

    def __pkg_is_flat(self, content):
        if not isinstance(content, dict):
            return False
        keys = ("model_func", "param_url", "code_url", "pack_code_url", "consistency_url",
                "consistency_data_url", "consistency_result_url", "conclusion",
                "submit_model", "test_conclusion", "author")
        return any(content.get(k) is not None for k in keys)

    def __extract_pkg_from_grid(self, tb, doc_type):
        if not isinstance(tb, list):
            return None
        out = self.__pkg_default_content(doc_type)
        found = False
        is_rec = doc_type in PKG_REC_TYPES
        is_submit = doc_type in PKG_SUBMIT_TYPES
        for row in tb:
            if not isinstance(row, list):
                continue
            cells = [str(c if c is not None else "").strip() for c in row]
            while len(cells) < 6:
                cells.append("")
            a = cells[0].replace(" ", "")
            if "签字" in a and "编写人" in a:
                out["author_sign"] = cells[1]
            elif "签字" in a and "审核人" in a:
                out["auditor_sign"] = cells[1]
            elif "签字" in a and "批准人" in a:
                out["approver_sign"] = cells[1]
            elif a == "编写人":
                found = True
                out["author"] = cells[1]
                if "编写日期" in cells:
                    i = cells.index("编写日期")
                    out["write_date"] = cells[i + 1] if i + 1 < len(cells) else ""
                if "审核人" in cells:
                    i = cells.index("审核人")
                    out["auditor"] = cells[i + 1] if i + 1 < len(cells) else ""
            elif a in ("模型功能", "功能"):
                found = True
                out["model_func"] = cells[1]
            elif a == "提交模型":
                found = True
                out["submit_model"] = cells[1]
            elif a == "模型测试结论":
                out["test_conclusion"] = cells[1]
            elif a == "模型代码地址":
                out["code_url"] = cells[1]
            elif a == "模型参数地址":
                found = True
                out["param_url"] = cells[1]
            elif a == "一致性测试结果":
                out["consistency_url"] = cells[1]
            elif a == "待封装代码地址":
                out["code_url"] = cells[1]
            elif a == "封装代码地址":
                out["pack_code_url"] = cells[1]
            elif a == "一致性测试数据地址":
                out["consistency_data_url"] = cells[1]
            elif a == "一致性结果地址":
                out["consistency_result_url"] = cells[1]
            elif a == "验收结论":
                out["conclusion"] = cells[1]
            elif "提交人" in a:
                out["submitter_sign"] = cells[1]
                for i, x in enumerate(cells):
                    if "审核人" in x and i + 1 < len(cells):
                        out["auditor_sign"] = cells[i + 1]
                        break
            elif "封装人" in a:
                out["packer_sign"] = cells[1]
                for i, x in enumerate(cells):
                    if "审核人" in x and i + 1 < len(cells):
                        out["auditor_sign"] = cells[i + 1]
                        break
        if found and is_rec:
            out.pop("code_url", None)
            out.pop("consistency_url", None)
            out.pop("submitter_sign", None)
        elif found and not is_submit:
            out.pop("pack_code_url", None)
            out.pop("consistency_data_url", None)
            out.pop("consistency_result_url", None)
            out.pop("conclusion", None)
            out.pop("packer_sign", None)
        return out if found else None

    def __normalize_pkg_content(self, content, doc_type):
        base = self.__pkg_default_content(doc_type)
        if not isinstance(content, dict):
            return base
        if self.__pkg_is_flat(content) and not content.get("sections"):
            for key in base:
                if content.get(key) is not None:
                    base[key] = content.get(key)
            return base
        extracted = None

        def walk(ns):
            nonlocal extracted
            for n0 in ns or []:
                if extracted or not isinstance(n0, dict):
                    continue
                for tb in n0.get("tables") or []:
                    extracted = self.__extract_pkg_from_grid(tb, doc_type)
                    if extracted:
                        return
                walk(n0.get("children") or [])

        walk(content.get("sections") or [])
        if extracted:
            for k in base:
                extracted[k] = extracted.get(k) or base[k]
            return extracted
        return base

    def __latest_data_content(self, product_id, doc_type):
        if not product_id:
            return None
        row = db.session.execute(
            select(DataDoc)
            .where(DataDoc.product_id == product_id, DataDoc.doc_type == doc_type)
            .order_by(DataDoc.id.desc())
        ).scalars().first()
        return row.content if row else None

    def __parse_dd015_dist(self, content):
        for _title, tables in self.__iter_content_tables(content):
            for tb in tables:
                if not isinstance(tb, list):
                    continue
                header_i = -1
                for i, row in enumerate(tb):
                    if not isinstance(row, list):
                        continue
                    cells = [str(c or "").strip() for c in row]
                    if len(cells) >= 3 and cells[0] == "因素" and cells[1] == "类别":
                        header_i = i
                        break
                if header_i < 0:
                    continue
                out = [["因素", "类别", "数量", "占比"]]
                for row in tb[header_i + 1:]:
                    if not isinstance(row, list):
                        continue
                    cells = self.__build_pad_row(row)
                    a, b, c, d = [x.strip() for x in cells]
                    if a == "总计":
                        break
                    if a in ("数据分布", "统计人", "数据总量（序列）", "疾病构成"):
                        continue
                    if not a and not b and not c:
                        continue
                    out.append([a, b, c, self.__build_fmt_pct(d)])
                if len(out) > 1:
                    return self.__build_fill_total(out)
        return None

    def __dd015_dist_for_product(self, product_id):
        for dt in ("dd_015_03", "dd_015_02", "dd_015_01"):
            content = self.__latest_data_content(product_id, dt)
            dist = self.__parse_dd015_dist(content)
            if dist:
                return self.__ensure_kernel_dist(dist, content)
        return None

    def __iter_content_tables(self, content):
        def walk(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                yield str(n.get("title") or ""), n.get("tables") or []
                yield from walk(n.get("children") or [])
        yield from walk((content or {}).get("sections") or [])

    def __norm_build_date(self, s):
        raw = str(s or "").strip()
        if not raw:
            return ""
        if re.search(r"年", raw):
            return self.__to_dotted_date(raw)
        m = re.match(r"^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$", raw)
        if m:
            return "%s.%d.%d" % (m.group(1), int(m.group(2)), int(m.group(3)))
        num = raw.replace(",", "")
        if num.replace(".", "", 1).isdigit() and float(num) > 20000:
            try:
                dt = datetime(1899, 12, 30) + timedelta(days=int(float(num)))
                return "%s.%d.%d" % (dt.year, dt.month, dt.day)
            except Exception:
                return raw
        return raw

    def __parse_dd010_rows(self, content):
        out = {}
        for title, tables in self.__iter_content_tables(content):
            t = title.replace(" ", "")
            for tb in tables:
                if not isinstance(tb, list) or not tb:
                    continue
                first = "".join(str(c or "") for c in (tb[0] if isinstance(tb[0], list) else []))
                if t not in ("标注",) and "标注数据库" not in first:
                    continue
                header = None
                name_i = qty_i = date_i = None
                for row in tb:
                    if not isinstance(row, list):
                        continue
                    cells = [str(c or "").strip() for c in row]
                    if "数据集" in cells and any("数据量" in x for x in cells):
                        header = cells
                        name_i = cells.index("数据集")
                        qty_i = next(i for i, x in enumerate(cells) if "数据量" in x)
                        date_i = next((i for i, x in enumerate(cells) if "日期" in x), None)
                        continue
                    if header is None or name_i is None or qty_i is None:
                        continue
                    name = cells[name_i] if name_i < len(cells) else ""
                    qty = cells[qty_i] if qty_i < len(cells) else ""
                    if name and qty and name not in ("数据集",):
                        rec = {
                            "qty": qty.split(".")[0] if qty.replace(".", "", 1).isdigit() else qty,
                            "date": "",
                        }
                        if date_i is not None and date_i < len(cells):
                            rec["date"] = self.__norm_build_date(cells[date_i])
                        out[name] = rec
        return out

    def __parse_dd010_counts(self, content):
        return {k: (v or {}).get("qty") or "" for k, v in (self.__parse_dd010_rows(content) or {}).items()}

    def __parse_dd012_counts(self, content):
        out = {}
        for _title, tables in self.__iter_content_tables(content):
            for tb in tables:
                if not isinstance(tb, list):
                    continue
                header = None
                name_i = qty_i = None
                for row in tb:
                    if not isinstance(row, list):
                        continue
                    cells = [str(c or "").strip() for c in row]
                    if "批次" in cells and "数据量" in cells:
                        header = cells
                        name_i = cells.index("批次")
                        qty_i = cells.index("数据量")
                        continue
                    if header is None:
                        continue
                    name = cells[name_i] if name_i < len(cells) else ""
                    qty = cells[qty_i] if qty_i < len(cells) else ""
                    if name and qty and name not in ("批次",):
                        out[name] = qty.split(".")[0] if qty.replace(".", "", 1).isdigit() else qty
        return out

    def __dataset_row(self, product_id, dataset_name):
        if not product_id or not dataset_name:
            return {}
        rows = self.__parse_dd010_rows(self.__latest_data_content(product_id, "dd_010"))
        if dataset_name in rows:
            return rows[dataset_name] or {}
        counts = self.__parse_dd012_counts(self.__latest_data_content(product_id, "dd_012"))
        qty = counts.get(dataset_name) or ""
        return {"qty": qty, "date": ""} if qty else {}

    def __dataset_qty(self, product_id, dataset_name):
        return (self.__dataset_row(product_id, dataset_name) or {}).get("qty") or ""

    def __dist_total_qty(self, dist):
        for r in reversed(dist or []):
            if isinstance(r, list) and str(r[0] or "").strip() == "总计":
                return str(r[2] or "").strip()
        return ""

    def __build_write_date(self, product_id, doc_type):
        if not product_id or not doc_type:
            return ""
        product = db.session.execute(select(Product).where(Product.id == product_id)).scalars().first()
        info = self.__collect_autofill(product_id, product, "", doc_type)
        return self.__to_dotted_date(info.get("file_date") or "")

    def __build_author(self, product_id, doc_type):
        kind = BUILD_AUTHOR_ROLE.get(doc_type)
        if not product_id or not kind:
            return ""
        members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == product_id)).scalars().all()
        if kind == "algo":
            names = self.__member_names(members, lambda r: r == "算法工程师")
        else:
            names = self.__member_names(members, lambda r: r == "模型负责人")
            if not names:
                names = self.__member_names(members, lambda r: r == "模型部负责人")
        return names[0] if names else ""

    def __model_lead_name(self, product_id):
        if not product_id:
            return ""
        members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == product_id)).scalars().all()
        names = self.__member_names(members, lambda r: r == "模型负责人")
        if not names:
            names = self.__member_names(members, lambda r: r == "模型部负责人")
        return names[0] if names else ""

    @staticmethod
    def __one_line_env(s):
        parts = [p.strip() for p in re.split(r"[\r\n]+", str(s or "")) if p.strip()]
        return "，".join(parts)

    @staticmethod
    def __fmt_short_date(s):
        m = re.match(r"^(\d{4})\.(\d{1,2})\.(\d{1,2})$", str(s or "").strip())
        if m:
            return "%s.%d.%d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
        return str(s or "").strip()

    def __test_runtime_env(self, product_id):
        data = dict(DEFAULT_RUNTIME_ENV)
        if product_id:
            row = db.session.execute(select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == product_id)).scalars().first()
            if row:
                data.update(row.dict(exclude_null=True) or {})
        hw = self.__one_line_env(data.get("srv_gpu") or "")
        os_name = str(data.get("srv_os") or "").strip()
        cuda = str(data.get("srv_cuda") or "").strip()
        if cuda and "CUDA" not in cuda.upper():
            cuda = "CUDA " + cuda
        sw = os_name
        if cuda:
            sw = (os_name + "，" + cuda) if os_name else cuda
        return hw, sw

    def __dd015_cases_for_product(self, product_id):
        for dt in ("dd_015_03", "dd_015_02", "dd_015_01"):
            content = self.__latest_data_content(product_id, dt)
            rows = list(self.__iter_case_rows(content)) if content else []
            if rows:
                return rows
        return []

    @staticmethod
    def __case_cell(row, *keys):
        for k in keys:
            if not isinstance(row, dict):
                continue
            v = row.get(k)
            if v is None:
                continue
            s = str(v).strip()
            if s and s.lower() not in ("none", "nan"):
                return v
        return ""

    def __parse_dice_val(self, v):
        s = str(v if v is not None else "").strip()
        if not s or s in ("/", "none", "nan", "-"):
            return None
        try:
            return float(s)
        except Exception:
            return None

    def __case_sex(self, row):
        s = str(self.__case_cell(row, "SEX", "sex") or "").strip()
        return s if s and s.lower() != "none" else ""

    def __case_age_bin(self, row):
        raw = self.__case_cell(row, "AGE", "age")
        try:
            age = float(raw)
        except Exception:
            return ""
        bins = (0, 18, 40, 60, 110)
        for i in range(1, len(bins)):
            if bins[i - 1] < age <= bins[i]:
                return "(%s, %s]" % (bins[i - 1], bins[i])
        return ""

    @staticmethod
    def __flag_num(v):
        s = str(v if v is not None else "").strip()
        if not s or s.lower() in ("/", "-", "none", "nan"):
            return None
        try:
            return float(s)
        except Exception:
            return None

    def __is_flag(self, v, num):
        n = self.__flag_num(v)
        return n is not None and abs(n - num) < 1e-9

    def __case_device(self, row):
        s = str(self.__case_cell(row, "DEVICE", "device") or "").strip()
        return s if s and s.lower() != "none" else ""

    def __case_kvp(self, row):
        raw = self.__case_cell(row, "KVP", "kvp")
        if raw in ("", None):
            return ""
        try:
            n = float(raw)
            if abs(n - round(n)) < 1e-9:
                return str(int(round(n)))
            return str(n)
        except Exception:
            s = str(raw).strip()
            return s if s.lower() != "none" else ""

    def __case_thickness(self, row):
        raw = self.__case_cell(row, "THICKNESS", "thickness")
        if raw in ("", None):
            return ""
        s = str(raw).strip()
        return s if s and s.lower() != "none" else ""

    def __case_kernel_label(self, row):
        name = self.__kernel_first(self.__case_cell(row, "ConvolutionKernel"))
        if not name:
            return ""
        prefix = self.__kernel_series_prefix(name)
        if prefix:
            return "%s系列" % prefix
        if name.upper() in ("LUNG", "SOFT"):
            return name.upper()
        return name

    def __new_test_bucket(self):
        return {"n": 0, "dices": [], "pos": 0, "neg": 0, "tp": 0, "fn": 0, "fp": 0, "tn": 0}

    def __add_test_case(self, bucket, row):
        bucket["n"] += 1
        gt_v = self.__case_cell(row, "gt", "GT")
        pred_v = self.__case_cell(row, "pred", "PRED", "Pred")
        d = self.__parse_dice_val(self.__case_cell(row, "dice", "DICE", "Dice"))
        if d is not None:
            bucket["dices"].append(d)
        if self.__is_flag(gt_v, 1):
            bucket["pos"] += 1
        elif self.__is_flag(gt_v, 0):
            bucket["neg"] += 1
        if self.__flag_num(gt_v) is not None and self.__flag_num(pred_v) is not None:
            p = self.__is_flag(pred_v, 1)
            if self.__is_flag(gt_v, 1):
                if p:
                    bucket["tp"] += 1
                else:
                    bucket["fn"] += 1
            elif self.__is_flag(gt_v, 0):
                if p:
                    bucket["fp"] += 1
                else:
                    bucket["tn"] += 1

    def __merge_test_bucket(self, dst, src):
        dst["n"] += src["n"]
        dst["dices"].extend(src["dices"])
        for k in ("pos", "neg", "tp", "fn", "fp", "tn"):
            dst[k] += src[k]

    def __group_test_factor(self, rows, getter, merge_small=False):
        buckets = {}
        order = []
        for r in rows or []:
            lab = getter(r)
            if not lab:
                continue
            if lab not in buckets:
                order.append(lab)
                buckets[lab] = self.__new_test_bucket()
            self.__add_test_case(buckets[lab], r)
        if not merge_small:
            return [(lab, buckets[lab]) for lab in order if buckets[lab]["n"] > 0]
        kept = []
        other = self.__new_test_bucket()
        for lab in order:
            b = buckets[lab]
            if lab.endswith("系列"):
                kept.append((lab, b))
                continue
            if lab == "其他" or b["n"] < 5:
                self.__merge_test_bucket(other, b)
                continue
            kept.append((lab, b))
        if other["n"] > 0:
            kept.append(("其他", other))
        return kept

    @staticmethod
    def __dice_mean_std(vals):
        """与 pandas 一致：Mean=算术平均；Std=样本标准差 ddof=1。仅 1 例时方差写 0.0000。"""
        nums = [float(x) for x in (vals or []) if x is not None]
        n = len(nums)
        if n <= 0:
            return "", ""
        mean = sum(nums) / float(n)
        if n < 2:
            return "%.4f" % mean, "0.0000"
        var = sum((x - mean) ** 2 for x in nums) / float(n - 1)
        return "%.4f" % mean, "%.4f" % math.sqrt(var)

    @staticmethod
    def __fmt_rate_ci(success, n):
        if not n:
            return ""
        p = success / float(n)
        se = math.sqrt(p * (1 - p) / n) if n else 0.0
        lo = max(0.0, p - 1.96 * se)
        hi = min(1.0, p + 1.96 * se)

        def t(x):
            s = ("%.3f" % x).rstrip("0").rstrip(".")
            if s == "1":
                return "1.0"
            if s == "0":
                return "0.0"
            return s

        return "%s(%s, %s)" % (t(p), t(lo), t(hi))

    def __test_result_from_cases(self, rows, doc_type):
        if not rows:
            return []
        thick_name = "层厚（mm）" if doc_type == "md_013_01" else "层厚"
        factors = [
            ("性别", lambda r: self.__case_sex(r), False),
            ("年龄", lambda r: self.__case_age_bin(r), False),
            ("设备", lambda r: self.__case_device(r), False),
            ("重建算法", lambda r: self.__case_kernel_label(r), True),
            ("管电压", lambda r: self.__case_kvp(r), False),
            (thick_name, lambda r: self.__case_thickness(r), False),
        ]
        header = self.__test_header(doc_type)
        n = self.__test_ncols(doc_type)
        out = [header[:]]
        all_b = self.__new_test_bucket()
        for r in rows:
            self.__add_test_case(all_b, r)
        for name, getter, merge_small in factors:
            groups = self.__group_test_factor(rows, getter, merge_small=merge_small)
            if not groups:
                continue
            first = True
            for lab, b in groups:
                if doc_type == "md_013_01":
                    sen = self.__fmt_rate_ci(b["tp"], b["tp"] + b["fn"])
                    spe = self.__fmt_rate_ci(b["tn"], b["tn"] + b["fp"])
                    out.append([name if first else "", lab, str(b["pos"]), str(b["neg"]), sen, spe][:n])
                else:
                    mean, std = self.__dice_mean_std(b["dices"])
                    out.append([name if first else "", lab, str(b["n"]), mean, std][:n])
                first = False
        if len(out) <= 1:
            return []
        total = ["总计"] + [""] * (n - 1)
        if doc_type == "md_013_01":
            total[4] = self.__fmt_rate_ci(all_b["tp"], all_b["tp"] + all_b["fn"])
            total[5] = self.__fmt_rate_ci(all_b["tn"], all_b["tn"] + all_b["fp"])
        else:
            mean, std = self.__dice_mean_std(all_b["dices"])
            total[3] = mean
            total[4] = std
        out.append(total)
        return self.__test_fill_total(out, doc_type)

    def __parse_ci(self, s):
        m = re.match(r"^\s*([\d.]+)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\s*$", str(s or ""))
        if not m:
            return None
        return float(m.group(1)), float(m.group(2)), float(m.group(3))

    def __test_conclusion(self, rows, doc_type):
        rows = [r for r in (rows or []) if isinstance(r, list)]
        if doc_type == "md_013_02":
            means = []
            for r in rows[1:]:
                if str(r[0] or "").strip() == "总计":
                    continue
                m = self.__parse_dice_val(r[3] if len(r) > 3 else "")
                if m is not None:
                    means.append(m)
            if not means:
                return ""
            if all(m > 0.97 for m in means):
                return "每个分段的平均dice都大于0.97，满足测试指标。"
            return "并非每个分段的平均dice都大于0.97，不满足测试指标。"
        total = next((r for r in rows if str(r[0] or "").strip() == "总计"), None)
        if not total or len(total) < 6:
            return ""
        sen = self.__parse_ci(total[4])
        spe = self.__parse_ci(total[5])
        if not sen or not spe:
            return ""
        sen_ok = sen[1] > 0.8
        spe_ok = spe[1] > 0.8
        both = sen_ok and spe_ok

        def num(x):
            s = ("%.3f" % x).rstrip("0").rstrip(".")
            if s == "1":
                return "1.0"
            if s == "0":
                return "0.0"
            return s

        return (
            "灵敏度为%s，95%CI低值%s%s目标值0.8；特异度为%s，95%CI低值%s%s目标值0.8，%s测试指标。"
            % (
                str(total[4]).strip(),
                num(sen[1]),
                ">" if sen_ok else "≤",
                str(total[5]).strip(),
                num(spe[1]),
                ">" if spe_ok else "≤",
                "均满足" if both else "不满足",
            )
        )

    def __apply_test_autofill(self, content, doc_type, product_id):
        if not isinstance(content, dict) or not product_id:
            return content
        lead = self.__model_lead_name(product_id)
        if lead:
            content["author"] = lead
            content["auditor"] = lead
        kws = serv_review_util.COVER_KEYWORDS.get(doc_type) or []
        lo, hi = serv_review_util.date_range(product_id, kws)
        if lo or hi:
            a = self.__fmt_short_date(lo)
            b = self.__fmt_short_date(hi)
            if b:
                content["write_date"] = b
            if a and b:
                content["test_time"] = a if a == b else "%s-%s" % (a, b)
            elif a or b:
                content["test_time"] = a or b
        hw, sw = self.__test_runtime_env(product_id)
        if hw:
            content["hw_env"] = hw
        if sw:
            content["sw_env"] = sw
        rows = self.__test_result_from_cases(self.__dd015_cases_for_product(product_id), doc_type)
        if rows:
            content["result_rows"] = rows
            conc = self.__test_conclusion(rows, doc_type)
            if conc:
                content["conclusion"] = conc
        return content

    @staticmethod
    def __md014_kind(title):
        t = str(title or "")
        if "重建" in t:
            return "recon"
        if "分诊" in t:
            return "triage"
        if "分割" in t:
            return "seg"
        return ""

    @staticmethod
    def __md014_dice_target(title):
        return 0.97 if "肺叶" in str(title or "") else 0.8

    @staticmethod
    def __md014_mod_name(title):
        t = re.sub(r"(模型)?测试$", "", str(title or "").strip())
        return t.replace("模块", "").strip() or str(title or "").strip()

    @staticmethod
    def __md014_num(x):
        if abs(x - round(x)) < 1e-9:
            return str(int(round(x)))
        return ("%.4f" % x).rstrip("0").rstrip(".")

    @staticmethod
    def __md014_caption(old_body, fallback=""):
        for ln in reversed(str(old_body or "").splitlines()):
            s = ln.strip()
            if s.startswith("表"):
                return s
        return fallback

    @staticmethod
    def __md014_lead(old_body):
        lines = [ln for ln in str(old_body or "").splitlines() if not ln.strip().startswith("表")]
        return "\n".join(lines).strip()

    def __md014_factor_table(self, rows, mode):
        if not rows:
            return []
        thick = "层厚" if mode == "dice" else "层厚（mm）"
        factors = [
            ("性别", lambda r: self.__case_sex(r), False),
            ("年龄", lambda r: self.__case_age_bin(r), False),
            ("设备", lambda r: self.__case_device(r), False),
            ("重建算法", lambda r: self.__case_kernel_label(r), True),
            ("管电压", lambda r: self.__case_kvp(r), False),
            (thick, lambda r: self.__case_thickness(r), False),
        ]
        all_b = self.__new_test_bucket()
        for r in rows:
            self.__add_test_case(all_b, r)
        total_n = all_b["n"] or 0
        if mode == "dist":
            header = ["因素", "类别", "阳性样本量", "阴性样本量", "总样本量", "总样本量占比"]
        elif mode == "triage":
            header = ["因素", "类别", "阳性样本量", "阴性样本量", "总样本量", "灵敏度(95%CI)", "特异度（95%CI)"]
        else:
            header = ["因素", "类别", "样本量", "dice均值", "dice标准差"]
        out = [header]
        last_start = 1
        for name, getter, merge_small in factors:
            groups = self.__group_test_factor(rows, getter, merge_small=merge_small)
            if not groups:
                continue
            last_start = len(out)
            first = True
            for lab, b in groups:
                if mode == "dist":
                    pct = "%.2f%%" % (100.0 * b["n"] / total_n) if total_n else "0.00%"
                    out.append([name if first else "", lab, str(b["pos"]), str(b["neg"]), str(b["n"]), pct])
                elif mode == "triage":
                    sen = self.__fmt_rate_ci(b["tp"], b["tp"] + b["fn"])
                    spe = self.__fmt_rate_ci(b["tn"], b["tn"] + b["fp"])
                    out.append([name if first else "", lab, str(b["pos"]), str(b["neg"]), str(b["n"]), sen, spe])
                else:
                    mean, std = self.__dice_mean_std(b["dices"])
                    out.append([name if first else "", lab, str(b["n"]), mean, std])
                first = False
        if len(out) <= 1:
            return []
        qty_idx = [2, 3, 4] if mode != "dice" else [2]
        sums = {i: 0 for i in qty_idx}
        for r in out[last_start:]:
            for i in qty_idx:
                try:
                    sums[i] += int(str(r[i]).strip() or "0")
                except Exception:
                    pass
        if mode == "dist":
            out.append(["总计", "", str(sums[2]), str(sums[3]), str(sums[4]), "100.00%"])
        elif mode == "triage":
            sen = self.__fmt_rate_ci(all_b["tp"], all_b["tp"] + all_b["fn"])
            spe = self.__fmt_rate_ci(all_b["tn"], all_b["tn"] + all_b["fp"])
            out.append(["总计", "", str(sums[2]), str(sums[3]), str(sums[4]), sen, spe])
        else:
            mean, std = self.__dice_mean_std(all_b["dices"])
            out.append(["总计", "", str(sums[2]), mean, std])
        return out

    def __md014_dist_body(self, rows, old_body, title):
        all_b = self.__new_test_bucket()
        for r in rows:
            self.__add_test_case(all_b, r)
        n, pos, neg = all_b["n"], all_b["pos"], all_b["neg"]
        devices, seen = [], set()
        for r in rows:
            d = self.__case_device(r)
            if d and d not in seen:
                seen.add(d)
                devices.append(d)
        age_old = 0
        for r in rows:
            if self.__case_age_bin(r) in ("(40, 60]", "(60, 110]"):
                age_old += 1
        ths = []
        for r in rows:
            try:
                ths.append(float(self.__case_thickness(r)))
            except Exception:
                pass
        kvp_groups = self.__group_test_factor(rows, lambda r: self.__case_kvp(r), False)
        extra = []
        if devices:
            extra.append("数据涵盖%s设备" % "、".join(devices))
        if n and age_old / float(n) >= 0.5:
            extra.append("年龄多分布在40岁以上")
        if ths and max(ths) <= 2:
            extra.append("层厚小于等于2mm")
        elif ths:
            extra.append("层厚分布在%s～%smm" % (self.__md014_num(min(ths)), self.__md014_num(max(ths))))
        if kvp_groups:
            vals = []
            for lab, b in kvp_groups:
                try:
                    vals.append((float(lab), b["n"], lab))
                except Exception:
                    continue
            if vals:
                mn, mx = min(v[0] for v in vals), max(v[0] for v in vals)
                top = sorted(vals, key=lambda x: -x[1])[:2]
                extra.append(
                    "管电压分布在%skvp至%skvp，多为%s"
                    % (self.__md014_num(mn), self.__md014_num(mx), "及".join("%sKVP" % v[2] for v in top))
                )
        pos_lab = "肺栓塞阳性数据" if "肺叶" in str(title or "") else "阳性数据"
        prefix = "根据数据入排标准，标记后的" if "根据数据入排标准" in str(old_body or "") else ""
        head = "%s测试数据总计%d例。其中%s%d例，阴性数据%d例。" % (prefix, n, pos_lab, pos, neg)
        if extra:
            head += "，".join(extra) + "。"
        cap = self.__md014_caption(old_body, "")
        if cap.startswith("表"):
            m = re.match(r"表\s*(\d+)", cap)
            if m:
                return head + "具体分布信息如表 %s所示。\n%s" % (m.group(1), cap)
            return head + "具体分布信息如下表所示。\n" + cap
        return head + "具体分布信息如下表所示。"

    def __md014_triage_conc(self, rows):
        all_b = self.__new_test_bucket()
        for r in rows:
            self.__add_test_case(all_b, r)
        sen_n = all_b["tp"] + all_b["fn"]
        spe_n = all_b["tn"] + all_b["fp"]
        sen = self.__fmt_rate_ci(all_b["tp"], sen_n)
        spe = self.__fmt_rate_ci(all_b["tn"], spe_n)
        parsed_s = self.__parse_ci(sen)
        parsed_p = self.__parse_ci(spe)
        if not parsed_s or not parsed_p:
            return ""

        def wrap(s):
            m = re.match(r"^([\d.]+)\(([\d.]+),\s*([\d.]+)\)$", s)
            if not m:
                return s
            return "%s(95%%CI:%s, %s)" % (m.group(1), m.group(2), m.group(3))

        def num(x):
            s = ("%.3f" % x).rstrip("0").rstrip(".")
            if s == "1":
                return "1.0"
            if s == "0":
                return "0.0"
            return s

        sen_ok = parsed_s[1] > 0.8
        spe_ok = parsed_p[1] > 0.8
        return (
            "灵敏度为%s，95%%CI低值%s%s目标值0.8；特异度为%s，95%%CI低值%s%s目标值0.8，%s测试指标。"
            % (
                wrap(sen),
                num(parsed_s[1]),
                ">" if sen_ok else "≤",
                wrap(spe),
                num(parsed_p[1]),
                ">" if spe_ok else "≤",
                "均满足" if sen_ok and spe_ok else "不满足",
            )
        )

    def __md014_seg_conc(self, rows, title, chapter):
        all_b = self.__new_test_bucket()
        for r in rows:
            self.__add_test_case(all_b, r)
        mean, _std = self.__dice_mean_std(all_b["dices"])
        if not mean:
            return ""
        target = self.__md014_dice_target(title)
        name = self.__md014_mod_name(title)
        m = float(mean)
        ok = m > target
        groups = self.__md014_factor_table(rows, "dice")
        means = []
        for r in groups[1:]:
            if str(r[0]).strip() == "总计":
                continue
            v = self.__parse_dice_val(r[3] if len(r) > 3 else "")
            if v is not None:
                means.append(v)
        all_ok = bool(means) and all(x > target for x in means) and ok
        target_s = "0.97" if abs(target - 0.97) < 1e-9 else self.__md014_num(target)
        if chapter == "结论":
            return (
                "我们通过客观的分割精度测试，验证了%s的分割精度和分割效果。分割精度测试集%d例，DICE系数为%s，各亚组%s测试指标。"
                % (name, all_b["n"], mean, "也均满足" if all_ok else "未全部满足")
            )
        if chapter == "结果及结论":
            return (
                "经测试，平均%s的DICE值为%s%s目标值%s，%s测试指标。"
                % (name, mean, ">" if ok else "≤", target_s, "满足" if all_ok else "不满足")
            )
        return (
            "经测试，平均%s的DICE值为%s%s目标值%s。对不同设备、层厚、管电压、性别以及年龄亚组的分析见下表，%s测试指标。"
            % (name, mean, ">" if ok else "≤", target_s, "满足" if all_ok else "不满足")
        )

    def __md014_lobe_table(self, rows):
        lobes = (
            ("右肺上叶", ("右肺上叶", "RUL", "rul", "dice_rul")),
            ("右肺下叶", ("右肺下叶", "RLL", "rll", "dice_rll")),
            ("右肺中叶", ("右肺中叶", "RML", "rml", "dice_rml")),
            ("左肺上叶", ("左肺上叶", "LUL", "lul", "dice_lul")),
            ("左肺下叶", ("左肺下叶", "LLL", "lll", "dice_lll")),
        )
        names = [x[0] for x in lobes]
        per = []
        any_per = False
        for _name, keys in lobes:
            vals = []
            for r in rows or []:
                v = self.__parse_dice_val(self.__case_cell(r, *keys))
                if v is not None:
                    vals.append(v)
            if vals:
                any_per = True
            per.append(vals)
        if any_per:
            means, stds = [], []
            for vals in per:
                m, s = self.__dice_mean_std(vals) if vals else ("", "")
                means.append(m)
                stds.append(s)
        else:
            all_b = self.__new_test_bucket()
            for r in rows or []:
                self.__add_test_case(all_b, r)
            m, s = self.__dice_mean_std(all_b["dices"])
            if not m:
                return []
            means = [m] * 5
            stds = [s] * 5
        return [
            ["肺叶"] + names,
            ["dice均值"] + means,
            ["dice标准差"] + stds,
        ]

    def __md014_module_sections(self, content):
        sections = (content or {}).get("sections") or []
        fixed = {
            "算法方案详细设计", "文件修订记录", "产品信息", "概述", "算法基本信息", "参考文献", "算法介绍",
            "模型测试报告", "参考文件", "引言", "测试环境", "硬件环境", "软件环境", "附件1 评审记录",
            "测试目的", "测试背景", "测试范围", "术语及缩略语",
        }
        out = []
        for s in sections:
            if not isinstance(s, dict):
                continue
            title = str(s.get("title") or "").strip()
            if not title or title in fixed or s.get("ref_type") in ("cover", "revision", "basic_info"):
                continue
            child_titles = [str(c.get("title") or "") for c in (s.get("children") or [])]
            has_marker = any(("测试指标" in t or "测试数据" in t or "测试结果" in t) for t in child_titles)
            if has_marker or title.endswith("模块") or title.endswith("测试"):
                out.append(s)
        return out

    def __md014_env_bodies(self, product_id):
        data = dict(DEFAULT_RUNTIME_ENV)
        if product_id:
            row = db.session.execute(select(ProdRuntimeEnv).where(ProdRuntimeEnv.prod_id == product_id)).scalars().first()
            if row:
                data.update(row.dict(exclude_null=True) or {})
        gpu = self.__one_line_env(data.get("srv_gpu") or "")
        cpu = self.__one_line_env(data.get("srv_cpu") or "")
        mem = self.__one_line_env(data.get("srv_memory") or "").rstrip("。")
        disk = self.__one_line_env(data.get("srv_disk") or "").rstrip("。")
        nic = self.__one_line_env(data.get("srv_nic") or "").rstrip("。")
        hw = "".join(
            p
            for p in (
                ("GPU型号为%s。" % gpu) if gpu else "",
                ("CPU为%s。" % cpu) if cpu else "",
                ("内存%s。" % mem) if mem else "",
                ("硬盘%s。" % disk) if disk else "",
                ("网卡为%s。" % nic) if nic else "",
            )
            if p
        )
        os_name = str(data.get("srv_os") or "").strip()
        cuda = str(data.get("srv_cuda") or "").strip()
        if cuda and "CUDA" not in cuda.upper():
            cuda = "CUDA " + cuda
        cuda_drv = (cuda + "驱动程序") if cuda else "CUDA驱动程序"
        sw = ""
        if os_name:
            sw = (
                "%s作为操作系统，安装英伟达GPU驱动程序，%s，cuDNN，numpy，scipy深度学习工具库以及PyTorch深度学习框架。开发语言选择Python3.7。"
                % (os_name, cuda_drv)
            )
        return hw, sw

    def __md014_fill_env(self, content, product_id):
        hw, sw = self.__md014_env_bodies(product_id)
        for s in (content or {}).get("sections") or []:
            if not isinstance(s, dict):
                continue
            if self.__strip_num(s.get("title")) != "测试环境":
                continue
            for c in s.get("children") or []:
                if not isinstance(c, dict):
                    continue
                k = self.__strip_num(c.get("title"))
                if k == "硬件环境" and hw:
                    c["body"] = hw
                elif k == "软件环境" and sw:
                    c["body"] = sw

    def __apply_md014_autofill(self, content, product_id):
        if not isinstance(content, dict) or not product_id:
            return content
        self.__md014_fill_env(content, product_id)
        rows = self.__dd015_cases_for_product(product_id)
        if not rows:
            return content
        recon_txt = "三维重建为传统算法，无客观测试指标。"
        for sec in self.__md014_module_sections(content):
            kind = self.__md014_kind(sec.get("title"))
            for child in (sec.get("children") or []):
                if not isinstance(child, dict):
                    continue
                key = self.__strip_num(child.get("title")).replace(" ", "")
                if key == "测试数据":
                    tb = self.__md014_factor_table(rows, "dist")
                    if tb:
                        child["tables"] = [tb]
                        child["body"] = self.__md014_dist_body(rows, child.get("body"), sec.get("title"))
                    continue
                if kind == "recon" and (
                    key in ("测试结果及结论", "测试结果", "结论") or "不同影响因素" in key
                ):
                    child["body"] = recon_txt
                    child["tables"] = []
                    continue
                if key == "测试结果及结论":
                    if kind == "triage":
                        conc = self.__md014_triage_conc(rows)
                        if conc:
                            child["body"] = conc
                    elif kind == "seg":
                        conc = self.__md014_seg_conc(rows, sec.get("title"), "结果及结论")
                        if conc:
                            child["body"] = conc
                    continue
                if "不同影响因素" in key:
                    if kind == "triage":
                        tb = self.__md014_factor_table(rows, "triage")
                    elif kind == "seg":
                        tb = self.__md014_factor_table(rows, "dice")
                    else:
                        tb = []
                    if tb:
                        lead = self.__md014_lead(child.get("body"))
                        cap = self.__md014_caption(child.get("body"), "表 2 内部测试集的不同影响因素分析")
                        child["tables"] = [tb]
                        child["body"] = (lead + ("\n" + cap if cap else "")).strip()
                    continue
                if key == "测试结果":
                    if kind == "seg":
                        tb = self.__md014_factor_table(rows, "dice")
                        if tb:
                            extra = self.__md014_lobe_table(rows) if "肺叶" in str(sec.get("title") or "") else []
                            child["tables"] = [tb] + ([extra] if extra else [])
                            conc = self.__md014_seg_conc(rows, sec.get("title"), "结果")
                            if conc:
                                child["body"] = conc
                    elif kind == "triage":
                        conc = self.__md014_triage_conc(rows)
                        if conc:
                            child["body"] = conc
                        tb = self.__md014_factor_table(rows, "triage")
                        if tb:
                            child["tables"] = [tb]
                    continue
                if key == "结论":
                    if kind == "seg":
                        conc = self.__md014_seg_conc(rows, sec.get("title"), "结论")
                        if conc:
                            child["body"] = conc
                    elif kind == "triage":
                        conc = self.__md014_triage_conc(rows)
                        if conc:
                            child["body"] = conc
        return content

    def __apply_dataset_counts(self, content, doc_type, product_id):
        if not isinstance(content, dict) or not product_id:
            return content
        if doc_type in BUILD_DOC_TYPES:
            row = self.__dataset_row(product_id, BUILD_DATASET_NAME.get(doc_type))
            qty = (row or {}).get("qty") or ""
            upload_date = (row or {}).get("date") or ""
            dist = self.__dd015_dist_for_product(product_id)
            if dist:
                content["dist_rows"] = dist
                total = self.__dist_total_qty(dist)
                if total:
                    content["case_count"] = total
                elif qty:
                    content["case_count"] = qty
            elif qty:
                content["case_count"] = qty
            write_date = self.__build_write_date(product_id, doc_type) or upload_date
            if write_date:
                content["write_date"] = write_date
            author = self.__build_author(product_id, doc_type)
            if author:
                content["author"] = author
            return content
        if doc_type in TRAIN_DOC_TYPES:
            build_type = TRAIN_BUILD_TYPE.get(doc_type)
            name = BUILD_DATASET_NAME.get(build_type)
            qty = self.__dataset_qty(product_id, name)
            if not qty and build_type:
                row = db.session.execute(
                    select(ModelDoc)
                    .where(ModelDoc.product_id == product_id, ModelDoc.doc_type == build_type)
                    .order_by(ModelDoc.id.desc())
                ).scalars().first()
                if row:
                    qty = str((self.__normalize_build_content(row.content, build_type) or {}).get("case_count") or "").strip()
            if qty:
                content["case_count"] = qty
            return content
        if doc_type in TEST_DOC_TYPES:
            return self.__apply_test_autofill(content, doc_type, product_id)
        if doc_type == "md_014":
            return self.__apply_md014_autofill(content, product_id)
        return content

    def __apply_dataset_autofill(self, obj: ModelDocObj):
        if obj.doc_type == "md_014":
            obj.content = self.__apply_md014_autofill(obj.content or {}, obj.product_id)
            return
        if obj.doc_type not in BUILD_DOC_TYPES and obj.doc_type not in TRAIN_DOC_TYPES and obj.doc_type not in TEST_DOC_TYPES:
            return
        obj.content = self.__apply_dataset_counts(obj.content or {}, obj.doc_type, obj.product_id)

    def __normalize_content(self, content, doc_type=None, product_id=None):
        if doc_type in EQ_DOC_TYPES:
            return self.__normalize_eq_content(content, doc_type)
        if doc_type in CRR_DOC_TYPES:
            return self.__normalize_crr_content(content, doc_type)
        if doc_type in BUILD_DOC_TYPES:
            return self.__normalize_build_content(content, doc_type)
        if doc_type in TRAIN_DOC_TYPES:
            return self.__normalize_train_content(content, doc_type)
        if doc_type in TEST_DOC_TYPES:
            return self.__normalize_test_content(content, doc_type)
        if doc_type in PKG_DOC_TYPES:
            return self.__normalize_pkg_content(content, doc_type)
        if not isinstance(content, dict) or not isinstance(content.get("sections"), list):
            return self.__default_content(doc_type, product_id=product_id)
        out = {"sections": [self.__normalize_node(s) for s in content["sections"]]}
        if doc_type == "md_001":
            self.__relocate_md001_tables(out)
        if doc_type == "md_006":
            self.__relocate_md006_tables(out)
        if doc_type == "md_007":
            self.__fill_md007_algo_info(out)
        if doc_type in WORD_CONTENTS:
            self.__fill_empty_template_tables(out, doc_type)
        if doc_type in ("md_008_01", "md_008_02"):
            self.__complete_md008_checklist(out, doc_type)
        if doc_type in ("md_019", "md_020"):
            self.__complete_env_maint_chapter(out, doc_type)
        self.__drop_product_info(out)
        self.__ensure_review_annex(out, doc_type)
        return out

    @classmethod
    def __drop_product_info(cls, content):
        """去掉原 Word 没有的「产品信息」章（已存文档打开/导出时也去掉）。"""
        def drop(ns):
            out = []
            for n in ns or []:
                t = cls.__strip_num(n.get("title"))
                if n.get("ref_type") == "basic_info" or t == "产品信息":
                    continue
                n["children"] = drop(n.get("children") or [])
                out.append(n)
            return out
        content["sections"] = drop((content or {}).get("sections") or [])

    @classmethod
    def __is_annex_title(cls, title):
        t = cls.__strip_num(title).replace(" ", "")
        return t.startswith("附件") and "评审记录" in t

    @classmethod
    def __ensure_review_annex(cls, content, doc_type=None):
        """原 Word 有评审表的，附件为空则补上；误挂在其它章节的评审表挪回附件。"""
        sections = (content or {}).get("sections")
        if not isinstance(sections, list):
            return

        def strip_annex_line(n):
            body = str(n.get("body") or "")
            lines = [ln for ln in body.split("\n") if ln.strip() not in ("附件 1 评审记录", "附件1 评审记录")]
            n["body"] = "\n".join(lines).rstrip()

        annex_nodes = []

        def find(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                strip_annex_line(n)
                if cls.__is_annex_title(n.get("title")):
                    annex_nodes.append(n)
                find(n.get("children") or [])

        find(sections)
        annex = annex_nodes[0] if annex_nodes else None
        annex_ids = {id(n) for n in annex_nodes}
        pulled = []

        def pull(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                if id(n) in annex_ids:
                    pull(n.get("children") or [])
                    continue
                keep = []
                for tb in (n.get("tables") or []):
                    if cls.__is_review_grid(tb):
                        pulled.append(tb)
                    else:
                        keep.append(tb)
                n["tables"] = keep
                pull(n.get("children") or [])

        pull(sections)
        src = copy.deepcopy(REVIEW_TABLES.get(doc_type) or []) if doc_type else []
        table = None
        if annex:
            existing = [tb for tb in (annex.get("tables") or []) if cls.__is_review_grid(tb)]
            table = existing[0] if existing else (pulled[0] if pulled else (src or None))
            if table:
                annex["tables"] = [table]
                annex["title"] = "附件 1 评审记录"
        elif pulled or src:
            table = pulled[0] if pulled else src
            sections.append({"title": "附件 1 评审记录", "body": "", "tables": [table], "children": []})

    @staticmethod
    def __is_review_grid(tb):
        return isinstance(tb, list) and tb and isinstance(tb[0], list) and "评审记录" in str(tb[0][0] or "")

    @staticmethod
    def __table_hdr(tb):
        if not (isinstance(tb, list) and tb and isinstance(tb[0], list) and tb[0]):
            return "", 0
        return str(tb[0][0] or "").strip(), len(tb[0])

    @staticmethod
    def __table_head_cells(tb):
        if not (isinstance(tb, list) and tb and isinstance(tb[0], list)):
            return []
        return [str(c or "").strip() for c in tb[0]]

    def __relocate_md006_tables(self, content):
        """按原 Word：人员表→人员资源；设备表→开发平台；里程碑表→项目开发计划及里程碑。"""
        sections = (content or {}).get("sections") or []
        nodes = {}

        def visit(ns):
            for n in ns or []:
                nodes[self.__strip_num(n.get("title"))] = n
                visit(n.get("children") or [])

        visit(sections)

        def is_person(tb):
            return self.__table_head_cells(tb)[:4] == ["编号", "姓名", "所属部门", "角色"]

        def is_equip(tb):
            return self.__table_head_cells(tb)[:3] == ["编号", "设备", "设备名称"]

        def is_mile(tb):
            return self.__table_head_cells(tb)[:5] == ["阶段", "任务划分", "负责人", "计划完成时间", "阶段性交付物"]

        def collect_and_strip(pred, keep_node):
            moved = []

            def walk(ns):
                for n in ns or []:
                    stay, take = [], []
                    for tb in (n.get("tables") or []):
                        if pred(tb) and n is not keep_node:
                            take.append(tb)
                        else:
                            stay.append(tb)
                    n["tables"] = stay
                    moved.extend(take)
                    walk(n.get("children") or [])

            walk(sections)
            return moved

        for title, pred in (
            ("人员资源", is_person),
            ("开发平台", is_equip),
            ("项目开发计划及里程碑", is_mile),
        ):
            target = nodes.get(title)
            if target is None:
                continue
            misplaced = collect_and_strip(pred, target)
            if misplaced and not any(pred(tb) for tb in (target.get("tables") or [])):
                target["tables"] = misplaced + (target.get("tables") or [])

    def __relocate_md001_tables(self, content):
        """按原 Word 把误挂章节的表挪回：评审表→附件；SCI 表→标识配置；工具表→版本更新原则。"""
        sections = (content or {}).get("sections") or []
        nodes = {}

        def visit(ns):
            for n in ns or []:
                nodes[self.__strip_num(n.get("title"))] = n
                visit(n.get("children") or [])

        visit(sections)

        def pull(title, pred):
            node = nodes.get(title)
            if not node:
                return []
            tbs = node.get("tables") or []
            moved = [tb for tb in tbs if pred(tb)]
            if moved:
                node["tables"] = [tb for tb in tbs if not pred(tb)]
            return moved

        tool, annex = nodes.get("配置管理工具"), nodes.get("附件 1 评审记录")
        if tool and annex:
            moved = pull("配置管理工具", self.__is_review_grid)
            if moved and not any(self.__is_review_grid(tb) for tb in (annex.get("tables") or [])):
                annex["tables"] = moved + (annex.get("tables") or [])

        ident = nodes.get("标识配置")
        if ident is not None and not (ident.get("tables") or []):
            def is_sci5(tb):
                h, n = self.__table_hdr(tb)
                return h == "SCI名称" and n >= 5
            def is_sci4(tb):
                h, n = self.__table_hdr(tb)
                return h == "SCI名称" and n == 4
            moved = pull("目的", is_sci5) + pull("范围", is_sci4) + pull("目的", is_sci4) + pull("范围", is_sci5)
            if moved:
                ident["tables"] = moved

        verp = nodes.get("版本更新原则")
        if verp is not None and not (verp.get("tables") or []):
            def is_tool(tb):
                return self.__table_hdr(tb)[0] == "工具类型"
            moved = pull("缩写", is_tool)
            if moved:
                verp["tables"] = moved

        prod_name = ""
        def take_name(ns):
            nonlocal prod_name
            for n in ns or []:
                t = self.__strip_num(n.get("title"))
                if n.get("ref_type") == "basic_info" or t == "产品信息":
                    for tb in n.get("tables") or []:
                        for row in tb or []:
                            if isinstance(row, list) and str(row[0] if row else "").strip() == "产品名称":
                                v = str(row[1] if len(row) > 1 else "").strip()
                                if v:
                                    prod_name = v
                                    return
                take_name(n.get("children") or [])
        take_name(sections)

        def drop_info(ns):
            out = []
            for n in ns or []:
                t = self.__strip_num(n.get("title"))
                if n.get("ref_type") == "basic_info" or t == "产品信息":
                    continue
                n["children"] = drop_info(n.get("children") or [])
                out.append(n)
            return out
        content["sections"] = drop_info(sections)
        nodes.clear()
        visit(content["sections"])

        scope = nodes.get("范围")
        if scope is not None:
            from_tbl = ""
            keep = []
            for tb in (scope.get("tables") or []):
                if self.__is_prod_name_table(tb):
                    for row in tb:
                        if isinstance(row, list) and str(row[0] if row else "").strip() == "产品名称":
                            v = str(row[1] if len(row) > 1 else "").strip()
                            if v and not from_tbl:
                                from_tbl = v
                    continue
                keep.append(tb)
            scope["tables"] = keep
            scope["body"] = self.__fill_scope_body(scope.get("body") or "", from_tbl or prod_name)

    @classmethod
    def __md007_data_url(cls, key):
        if key in _MD007_IMG_CACHE:
            return _MD007_IMG_CACHE[key]
        name = _MD007_IMG_FILES.get(key) or ""
        path = os.path.join(_MD007_IMG_DIR, name) if name else ""
        data = ""
        if path and os.path.isfile(path):
            with open(path, "rb") as f:
                data = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
        _MD007_IMG_CACHE[key] = data
        return data

    @staticmethod
    def __tables_have_text(tables):
        for tb in tables or []:
            for row in tb or []:
                for c in row or []:
                    s = str(c or "").strip()
                    if s and not s.startswith("data:image"):
                        return True
        return False

    @staticmethod
    def __has_figure_table(tables):
        for tb in tables or []:
            if not isinstance(tb, list) or not tb:
                continue
            cols = max((len(row) for row in tb if isinstance(row, list)), default=0)
            if cols != 1:
                continue
            for row in tb:
                if isinstance(row, list) and row and str(row[0] or "").startswith("data:image"):
                    return True
        return False

    @staticmethod
    def __fill_flow_cell(tb, url):
        if not url or not isinstance(tb, list):
            return
        for row in tb:
            if not isinstance(row, list) or not row:
                continue
            if "算法流程图" not in str(row[0] or ""):
                continue
            while len(row) < 2:
                row.append("")
            if not str(row[1] or "").strip():
                row[1] = url

    @classmethod
    def __collect_md007_src(cls):
        src = {}

        def visit(ns, parents):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                title = cls.__strip_num(n.get("title"))
                path = parents + [title]
                if title == "算法基本信息":
                    if "肺栓塞分割模块" in path:
                        src["pe"] = n
                    elif "肺叶分割模块" in path:
                        src["lobe"] = n
                    elif "三维重建模块" in path:
                        src["recon"] = n
                    else:
                        src["h1"] = n
                elif title == "模块设计描述":
                    if "肺栓塞分割模块" in path:
                        src["pe_desc"] = n
                    elif "肺叶分割模块" in path:
                        src["lobe_desc"] = n
                    elif "三维重建模块" in path:
                        src["recon_desc"] = n
                visit(n.get("children") or [], path)

        visit((WORD_CONTENTS.get("md_007") or {}).get("sections") or [], [])
        return src

    def __fill_md007_algo_info(self, content):
        """原 Word：三个「算法基本信息」为两列表；图 1～6 与立方体示意图按章节补上。空才填。"""
        sections = (content or {}).get("sections")
        if not isinstance(sections, list):
            return
        src = self.__collect_md007_src()
        imgs = {k: self.__md007_data_url(k) for k in _MD007_IMG_FILES}

        def ensure_tables(node, src_node, flow_key=None, fig_keys=None):
            if not isinstance(node, dict):
                return
            tables = node.get("tables") if isinstance(node.get("tables"), list) else []
            if not self.__tables_have_text(tables) and not self.__has_figure_table(tables):
                src_tables = copy.deepcopy((src_node or {}).get("tables") or []) if src_node else []
                if src_tables:
                    tables = src_tables
            if flow_key:
                for tb in tables:
                    self.__fill_flow_cell(tb, imgs.get(flow_key) or "")
            if fig_keys and not self.__has_figure_table(tables):
                extra = [[[imgs[k]]] for k in fig_keys if imgs.get(k)]
                tables = list(tables) + extra
            node["tables"] = tables

        def visit(ns, parents):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                title = self.__strip_num(n.get("title"))
                path = parents + [title]
                if title == "算法基本信息":
                    if "肺栓塞分割模块" in path:
                        ensure_tables(n, src.get("pe"), flow_key="pe_flow")
                    elif "肺叶分割模块" in path:
                        ensure_tables(n, src.get("lobe"), flow_key="lobe_flow")
                    elif "三维重建模块" in path:
                        ensure_tables(n, src.get("recon"), flow_key="recon_flow")
                    else:
                        ensure_tables(n, src.get("h1"), fig_keys=["fig1"])
                elif title == "模块设计描述":
                    if "肺栓塞分割模块" in path:
                        ensure_tables(n, None, fig_keys=["fig2", "fig3", "fig4"])
                    elif "肺叶分割模块" in path:
                        ensure_tables(n, None, fig_keys=["lobe_flow"])
                    elif "三维重建模块" in path:
                        ensure_tables(n, None, fig_keys=["recon_flow", "cube"])
                visit(n.get("children") or [], path)

        visit(sections, [])

    def __fill_empty_template_tables(self, content, doc_type):
        """原 Word 章节表：按标题路径从模板补到空章节。封面/修订/产品信息不走此逻辑。空才填。"""
        src = (WORD_CONTENTS.get(doc_type) or {}).get("sections")
        sections = (content or {}).get("sections")
        if not isinstance(src, list) or not isinstance(sections, list):
            return
        skip = {"cover", "revision", "basic_info"}
        src_map = {}

        def visit_src(ns, parents):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                title = self.__strip_num(n.get("title"))
                src_map[tuple(parents + [title])] = n
                visit_src(n.get("children") or [], parents + [title])

        visit_src(src, [])

        def visit(ns, parents):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                title = self.__strip_num(n.get("title"))
                path = tuple(parents + [title])
                src_n = src_map.get(path)
                if (
                    src_n
                    and src_n.get("ref_type") not in skip
                    and n.get("ref_type") not in skip
                ):
                    src_tables = copy.deepcopy(src_n.get("tables") or [])
                    if src_tables and not self.__tables_have_text(n.get("tables")) and not self.__has_figure_table(n.get("tables")):
                        n["tables"] = src_tables
                visit(n.get("children") or [], parents + [title])

        visit(sections, [])

    @staticmethod
    def __md008_row0(row):
        return str(row[0] if row else "").strip()

    @classmethod
    def __is_md008_checklist(cls, tb):
        if not isinstance(tb, list) or len(tb) < 3:
            return False
        has_header = False
        has_addr = False
        for row in tb:
            if not isinstance(row, list):
                continue
            if cls.__md008_row0(row) == "代码地址":
                has_addr = True
            cells = [str(c or "").replace(" ", "") for c in row]
            if "编号" in cells and "是" in cells and "否" in cells and any("不适用" in x for x in cells):
                has_header = True
        return has_header and has_addr

    def __complete_md008_checklist(self, content, doc_type):
        src_tb = None
        for n in (DEFAULT_CONTENTS.get(doc_type) or {}).get("sections") or []:
            for tb in n.get("tables") or []:
                if self.__is_md008_checklist(tb):
                    src_tb = tb
                    break
            if src_tb:
                break
        if not src_tb:
            return

        def start_key(tb):
            keys = [self.__md008_row0(r) for r in tb if isinstance(r, list)]
            if "文档" not in keys:
                return "文档"
            if not any(k.startswith("结论") for k in keys):
                return "结论"
            if not any("签字" in k for k in keys):
                return "审核人"
            return ""

        def visit(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                tables = n.get("tables") or []
                for i, tb in enumerate(tables):
                    if not self.__is_md008_checklist(tb):
                        continue
                    key = start_key(tb)
                    if not key:
                        continue
                    while tb and isinstance(tb[-1], list) and not any(str(c or "").strip() for c in tb[-1]):
                        tb.pop()
                    src_i = -1
                    for j, r in enumerate(src_tb):
                        a = self.__md008_row0(r)
                        if key == "文档" and a == "文档":
                            src_i = j
                            break
                        if key == "结论" and a.startswith("结论"):
                            src_i = j
                            break
                        if key == "审核人" and "签字" in a:
                            src_i = j
                            break
                    if src_i < 0:
                        continue
                    tables[i] = tb + copy.deepcopy(src_tb[src_i:])
                n["tables"] = tables
                visit(n.get("children") or [])

        visit((content or {}).get("sections") or [])

    @staticmethod
    def __is_env_check_grid(tb):
        return isinstance(tb, list) and tb and isinstance(tb[0], list) and str(tb[0][0] or "").strip() == "env_check"

    @staticmethod
    def __is_asset_grid(tb):
        if not (isinstance(tb, list) and tb and isinstance(tb[0], list) and tb[0]):
            return False
        hdr = [str(c or "") for c in tb[0]]
        return str(hdr[0] or "").strip() == "资产编码" and any("设备信息" in h for h in hdr)

    @staticmethod
    def __env_check_leaves(doc_type, kind):
        cols = []
        for gl, leaves in ENV_CHECK_GROUPS.get((doc_type, kind), ENV_CHECK_GROUPS[("md_019", "dev")]):
            if leaves:
                for lf in leaves:
                    cols.append({"label": lf, "type": "check"})
            else:
                t = "date" if gl == "日期" else "problem" if gl.startswith("出现的问题") else "checker" if gl == "检查人" else "check"
                cols.append({"label": gl, "type": t})
        return cols

    @classmethod
    def __env_check_defaults(cls, doc_type, kind):
        out = []
        for c in cls.__env_check_leaves(doc_type, kind):
            if c["type"] != "check":
                continue
            lb = c["label"]
            out.append("否" if ("更新升级" in lb or "日志是否错误" in lb) else "是")
        return out

    def __complete_env_maint_chapter(self, content, doc_type):
        if doc_type not in ("md_019", "md_020"):
            return
        want = "开发环境维护记录" if doc_type == "md_019" else "测试环境维护记录"
        after = "开发环境定期检查" if doc_type == "md_019" else "测试环境定期检查"
        sections = (content or {}).get("sections")
        if not isinstance(sections, list):
            return

        def find_title(ns, name):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                if self.__strip_num(n.get("title")) == name:
                    return n
                hit = find_title(n.get("children") or [], name)
                if hit:
                    return hit
            return None

        if find_title(sections, want):
            return
        new_node = {"title": want, "body": "", "tables": [], "children": []}
        idx = next((i for i, n in enumerate(sections) if isinstance(n, dict) and self.__strip_num(n.get("title")) == after), -1)
        if idx >= 0:
            sections.insert(idx + 1, new_node)
        else:
            sections.append(new_node)

    @staticmethod
    def __cell_eq_nonempty(a, b):
        sa, sb = str(a or ""), str(b or "")
        return sa == sb and sa.strip() != ""

    def __grid_span_origins(self, grid):
        rows = [list(r) for r in grid]
        r_n = len(rows)
        c_n = max((len(r) for r in rows), default=0)
        for r in rows:
            while len(r) < c_n:
                r.append("")
        skip = [[False] * c_n for _ in range(r_n)]
        colspan = [[1] * c_n for _ in range(r_n)]
        rowspan = [[1] * c_n for _ in range(r_n)]
        for r in range(r_n):
            c = 0
            while c < c_n:
                if skip[r][c]:
                    c += 1
                    continue
                c2 = c
                while c2 + 1 < c_n and self.__cell_eq_nonempty(rows[r][c], rows[r][c2 + 1]):
                    c2 += 1
                colspan[r][c] = c2 - c + 1
                for k in range(c + 1, c2 + 1):
                    skip[r][k] = True
                c = c2 + 1
        for r in range(r_n):
            for c in range(c_n):
                if skip[r][c]:
                    continue
                if c != 0:
                    continue
                if not str(rows[r][c] or "").strip():
                    continue
                cs = colspan[r][c]
                r2 = r
                while r2 + 1 < r_n:
                    if skip[r2 + 1][c] or colspan[r2 + 1][c] != cs:
                        break
                    if not self.__cell_eq_nonempty(rows[r][c], rows[r2 + 1][c]):
                        break
                    r2 += 1
                rs = r2 - r + 1
                if rs > 1:
                    rowspan[r][c] = rs
                    for k in range(r + 1, r2 + 1):
                        skip[k][c] = True
        origins = []
        for r in range(r_n):
            for c in range(c_n):
                if skip[r][c]:
                    continue
                origins.append((r, c, rowspan[r][c], colspan[r][c]))
        return rows, origins

    def __md008_span_origins(self, grid):
        categories = {"结构", "文档", "变量", "算法操作", "循环和分支"}
        meta4 = {"代码地址", "被审核人"}
        meta2 = {"审核依据", "审核方式"}
        rows = [list(r) if isinstance(r, list) else [] for r in (grid or [])]
        r_n = len(rows)
        c_n = max([7] + [len(r) for r in rows])
        for r in rows:
            while len(r) < c_n:
                r.append("")
        skip = [[False] * c_n for _ in range(r_n)]
        colspan = [[1] * c_n for _ in range(r_n)]
        rowspan = [[1] * c_n for _ in range(r_n)]

        def empty_row(r):
            return not any(str(rows[r][c] or "").strip() for c in range(c_n))

        def only_first(r):
            if not str(rows[r][0] or "").strip():
                return False
            return not any(str(rows[r][c] or "").strip() for c in range(1, c_n))

        def merge(r, c, rs, cs):
            if r >= r_n or c >= c_n:
                return
            rr = min(rs, r_n - r)
            cc = min(cs, c_n - c)
            rowspan[r][c] = rr
            colspan[r][c] = cc
            skip[r][c] = False
            for i in range(rr):
                for j in range(cc):
                    if i == 0 and j == 0:
                        continue
                    skip[r + i][c + j] = True

        for r in range(r_n):
            if skip[r][0]:
                continue
            a = str(rows[r][0] or "").strip()
            if not a:
                continue
            if a.startswith("结论"):
                merge(r, 0, 2 if r + 1 < r_n and empty_row(r + 1) else 1, c_n)
                continue
            if "审核人" in a and "签字" in a:
                rs = 2 if r + 1 < r_n and empty_row(r + 1) else 1
                merge(r, 0, rs, 2)
                merge(r, 2, rs, c_n - 2)
                continue
            if a in meta4:
                merge(r, 0, 1, 2)
                merge(r, 3, 1, 2)
                merge(r, 5, 1, 2)
                continue
            if a in meta2:
                merge(r, 0, 1, 2)
                merge(r, 2, 1, c_n - 2)
                continue
            if a == "编号" or a.isdigit():
                merge(r, 1, 1, 2)
                continue
            if a in categories or only_first(r):
                merge(r, 0, 1, c_n)
        origins = []
        for r in range(r_n):
            for c in range(c_n):
                if skip[r][c]:
                    continue
                origins.append((r, c, rowspan[r][c], colspan[r][c]))
        return rows, origins

    def __env_maint_span_origins(self, grid):
        rows = [list(r) if isinstance(r, list) else [] for r in (grid or [])]
        r_n = len(rows)
        c_n = max([17] + [len(r) for r in rows])
        for r in rows:
            while len(r) < c_n:
                r.append("")
        skip = [[False] * c_n for _ in range(r_n)]
        colspan = [[1] * c_n for _ in range(r_n)]
        rowspan = [[1] * c_n for _ in range(r_n)]

        def only_first(r):
            if not str(rows[r][0] or "").strip():
                return False
            return not any(str(rows[r][c] or "").strip() for c in range(1, c_n))

        def merge(r, c, rs, cs):
            if r >= r_n or c >= c_n:
                return
            rr = min(rs, r_n - r)
            cc = min(cs, c_n - c)
            rowspan[r][c] = rr
            colspan[r][c] = cc
            skip[r][c] = False
            for i in range(rr):
                for j in range(cc):
                    if i == 0 and j == 0:
                        continue
                    skip[r + i][c + j] = True

        h = -1
        for r in range(r_n):
            if str(rows[r][0] or "").strip() == "日期" and "检查内容" in str(rows[r][1] or ""):
                h = r
                break
        for r in range(r_n):
            if h >= 0 and h <= r <= h + 2:
                continue
            if only_first(r):
                merge(r, 0, 1, c_n)
        if h >= 0:
            merge(h, 0, 3, 1)
            merge(h, 1, 1, 14)
            merge(h, 15, 3, 1)
            merge(h, 16, 3, 1)
            if h + 1 < r_n:
                merge(h + 1, 1, 1, 4)
                merge(h + 1, 5, 1, 3)
                merge(h + 1, 8, 2, 1)
                merge(h + 1, 9, 1, 2)
                merge(h + 1, 11, 2, 1)
                merge(h + 1, 12, 2, 1)
                merge(h + 1, 13, 2, 1)
                merge(h + 1, 14, 2, 1)
        origins = []
        for r in range(r_n):
            for c in range(c_n):
                if skip[r][c]:
                    continue
                origins.append((r, c, rowspan[r][c], colspan[r][c]))
        return rows, origins

    @staticmethod
    def __fill_cover_meta(content, version):
        """封面编制部门 / 文件版本：仅填空。"""
        for section in (content or {}).get("sections") or []:
            if not isinstance(section, dict):
                continue
            for table in (section.get("tables") or []):
                if not isinstance(table, list):
                    continue
                for row in table:
                    if not isinstance(row, list) or not row:
                        continue
                    label = str(row[0] or "").strip()
                    if label in ("编制部门", "使用部门", "编写部门") and len(row) >= 2:
                        if not str(row[1] or "").strip():
                            row[1] = COVER_DEPT
                    if label in ("文件版本", "版本号") and len(row) >= 4:
                        if version and not str(row[3] or "").strip():
                            row[3] = version

    def __autofill_for_export(self, content, obj: ModelDocObj):
        if obj.doc_type in EQ_DOC_TYPES:
            return content
        if obj.doc_type in CRR_DOC_TYPES:
            return self.__fill_crr_fields(content, obj)
        if obj.doc_type in BUILD_DOC_TYPES:
            c = self.__normalize_build_content(content, obj.doc_type)
            return self.__apply_dataset_counts(c, obj.doc_type, obj.product_id)
        if obj.doc_type in TRAIN_DOC_TYPES:
            c = self.__normalize_train_content(content, obj.doc_type)
            return self.__apply_dataset_counts(c, obj.doc_type, obj.product_id)
        if obj.doc_type in TEST_DOC_TYPES:
            c = self.__normalize_test_content(content, obj.doc_type)
            return self.__apply_dataset_counts(c, obj.doc_type, obj.product_id)
        if obj.doc_type in PKG_DOC_TYPES:
            return self.__normalize_pkg_content(content, obj.doc_type)
        sections = (content or {}).get("sections") or []
        prod_id = obj.product_id
        if not prod_id:
            return content
        product = db.session.execute(select(Product).where(Product.id == prod_id)).scalars().first()
        info = self.__collect_autofill(prod_id, product, obj.version, obj.doc_type)
        for node in sections:
            self.__fill_node(node, info)
        if obj.doc_type in ("md_019", "md_020"):
            self.__rebuild_env_checks(content, info)
        self.__fill_cover_meta(content, obj.version)
        key = obj.doc_type or ""
        serv_review_util.fill_cover_dates(content, serv_review_util.cover_date(prod_id, key))
        serv_review_util.fill_cover_signers(content, serv_review_util.cover_signers(prod_id, key))
        serv_review_util.fill_annex_reviews(content, prod_id, key, getattr(product, "name", "") or "")
        fill_chapter_images(content, obj.doc_type)
        return content

    def __collect_autofill(self, prod_id, product, doc_version, doc_type):
        prod_name = (getattr(product, "name", "") or "").strip()
        full_version = (getattr(product, "full_version", "") or "").strip()
        product_code = (getattr(product, "product_code", "") or "").strip()
        scope = (getattr(product, "scope", "") or "").strip()

        tl_rows = db.session.execute(
            select(ProjectTimelineRow).where(ProjectTimelineRow.prod_id == prod_id)
        ).scalars().all()
        cell_map = {}
        model_row_ids = set()

        def is_model_dev_out(text):
            s = str(text or "")
            if re.search(r"模型开发(?!计划)", s):
                return True
            if "模型训练" in s:
                return True
            if re.search(r"模型测试(?!方案)", s):
                return True
            if "模型封装" in s or "模型服务提交" in s:
                return True
            return False

        if tl_rows:
            for c in db.session.execute(
                select(ProjectTimelineCell).where(ProjectTimelineCell.row_id.in_([r.id for r in tl_rows]))
            ).scalars().all():
                cell_map.setdefault(c.row_id, []).append(c.output_result or "")
                if (c.dept or "") == "模型部" and is_model_dev_out(c.output_result):
                    model_row_ids.add(c.row_id)

        def to_int(v):
            digits = re.sub(r"[^\d]", "", str(v or ""))
            return int(digits) if digits else None

        date_rows = [r for r in tl_rows if (r.row_type or "date") == "date" and to_int(r.year) and to_int(r.month)]

        def date_key(r):
            return to_int(r.year) * 10000 + to_int(r.month) * 100 + (to_int(r.day) or 0)

        kws = doc_keywords(doc_type) or [doc_title(doc_type)]
        file_rows = [
            r for r in date_rows
            if any(any(k in str(v or "") for k in kws) for v in cell_map.get(r.id, []))
        ]
        file_date = ""
        if file_rows:
            fr = min(file_rows, key=date_key)
            file_date = f"{to_int(fr.year)}年{to_int(fr.month)}月{to_int(fr.day)}日"

        cycle_text = ""
        model_dates = []
        if doc_type in ("md_006", "md_019", "md_020"):
            for r in date_rows:
                if r.id not in model_row_ids:
                    continue
                y, m, d = to_int(r.year), to_int(r.month), to_int(r.day) or 1
                try:
                    model_dates.append(date(y, m, d))
                except Exception:
                    continue
            if doc_type == "md_006" and model_dates:
                days = (max(model_dates) - min(model_dates)).days + 1
                if days > 0:
                    cycle_text = "共用时约%d天。" % days

        members = db.session.execute(select(ProjectMember).where(ProjectMember.prod_id == prod_id)).scalars().all()
        def find_member(pred):
            for m in members:
                if pred(str(m.role or "")):
                    return (m.name or "").strip()
            return ""
        modeler = find_member(lambda r: r in ("模型部负责人", "模型负责人")) or find_member(lambda r: "模型" in r)
        algo = find_member(lambda r: "算法" in r)
        approver = find_member(lambda r: "研发负责人" in r) or find_member(lambda r: "负责人" in r)

        md022_file_nos = {}
        md022_srs = {}
        if doc_type == "md_022":
            md022_file_nos = {t: self.__md022_file_no(prod_id, doc_version, t) for t in MD022_FILE_TYPES}
            md022_srs = self.__md022_srs_by_module(prod_id)

        md008_date = md008_auditee = md008_auditor = md008_sign = ""
        if doc_type in ("md_008_01", "md_008_02"):
            auditees = self.__member_names(members, lambda r: r == "算法工程师")
            auditors = self.__member_names(members, lambda r: r == "高级算法工程师")
            md008_date = self.__to_dotted_date(file_date)
            md008_auditee = " ".join(auditees)
            md008_auditor = " ".join(auditors)
            md008_sign = serv_review_util._sign_by_name(auditors[0] if auditors else "") or md008_auditor

        env_weeks = []
        env_assets = None
        env_checker = env_title = ""
        if doc_type in ("md_019", "md_020"):
            env_title = "开发环境维护记录" if doc_type == "md_019" else "测试环境维护记录"
            dev_ds, test_ds = [], []
            for r in date_rows:
                y, m, d = to_int(r.year), to_int(r.month), to_int(r.day) or 1
                try:
                    dt = date(y, m, d)
                except Exception:
                    continue
                vals = cell_map.get(r.id, [])
                if any(("产品开发" in str(v)) and ("计划" not in str(v)) for v in vals):
                    dev_ds.append(dt)
                if any("测试" in str(v) for v in vals):
                    test_ds.append(dt)
            if dev_ds and test_ds:
                env_weeks = self.__week_ranges_from_dates([min(dev_ds), max(test_ds)])
            eq_type = "md_deq" if doc_type == "md_019" else "md_teq"
            eq_doc = db.session.execute(
                select(ModelDoc).where(ModelDoc.product_id == prod_id, ModelDoc.doc_type == eq_type).order_by(ModelDoc.id.desc())
            ).scalars().first()
            if eq_doc:
                env_assets = self.__parse_eq_codes(eq_doc.content if isinstance(eq_doc.content, dict) else {})
            checkers = self.__member_names(members, lambda r: r == "模型部负责人") or self.__member_names(members, lambda r: r == "模型负责人")
            env_checker = serv_review_util._sign_by_name(checkers[0] if checkers else "") or (checkers[0] if checkers else "")

        return {
            "prod_name": prod_name, "full_version": full_version, "product_code": product_code,
            "scope": scope, "file_date": file_date, "version": doc_version,
            "reviser": modeler or algo, "approver": approver, "cycle_text": cycle_text,
            "members": members, "doc_type": doc_type,
            "md022_file_nos": md022_file_nos, "md022_srs": md022_srs,
            "md008_date": md008_date, "md008_auditee": md008_auditee,
            "md008_auditor": md008_auditor, "md008_sign": md008_sign,
            "env_weeks": env_weeks, "env_assets": env_assets, "env_checker": env_checker,
            "env_title": env_title,
        }

    @staticmethod
    def __fill_scope_body(body, prod_name):
        name = str(prod_name or "").strip()
        s = str(body or "")
        if re.search(r"产品名称[：:]\s*\S", s):
            return s
        if re.search(r"产品名称[：:]", s):
            return re.sub(r"产品名称[：:]\s*", ("产品名称：" + name) if name else "产品名称：", s, count=1)
        line = f"产品名称：{name}" if name else "产品名称："
        return f"{line}\n{s}" if s else line

    @staticmethod
    def __is_prod_name_table(tb):
        return (
            isinstance(tb, list) and tb and isinstance(tb[0], list)
            and str(tb[0][0] if tb[0] else "").strip() == "产品名称"
            and len(tb[0]) <= 2
        )

    @staticmethod
    def __strip_num(title):
        return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()

    def __fill_node(self, node, info):
        ref = node.get("ref_type")
        title = self.__strip_num(node.get("title"))
        if ref == "revision" or title == "文件修订记录":
            tables = node.get("tables") or []
            if tables and isinstance(tables[0], list):
                t = tables[0]
                cols = len(t[0]) if t and t[0] else 5
                while len(t) < 6:
                    t.append([""] * cols)
                row = t[1]
                def set_if(i, val):
                    if val and not str(row[i] if i < len(row) else "").strip():
                        row[i] = val
                set_if(0, info["file_date"])
                set_if(1, info["version"])
                if not str(row[2] if len(row) > 2 else "").strip():
                    row[2] = "首次发布"
                set_if(3, info["reviser"])
                set_if(4, info["approver"])
        if ref == "basic_info" or title == "产品信息":
            label_map = {
                "产品名称": info["prod_name"],
                "软件版本": info["full_version"],
                "完整版本": info["full_version"],
                "产品标识": info["product_code"],
                "产品代码": info["product_code"],
                "适用范围": info["scope"],
                "预期用途": info["scope"],
                "项目名称": info["prod_name"],
            }
            for table in (node.get("tables") or []):
                for row in table:
                    if not isinstance(row, list) or len(row) < 2:
                        continue
                    key = str(row[0]).strip()
                    if key in label_map and label_map[key] and not str(row[1] or "").strip():
                        row[1] = label_map[key]
        if title == "范围":
            node["body"] = self.__fill_scope_body(node.get("body") or "", info.get("prod_name") or "")
        is_cycle = ref == "prod_cycle" or (title == "项目开发时间" and not (node.get("children") or []))
        if is_cycle and info.get("cycle_text"):
            node["body"] = info["cycle_text"]
        if info.get("doc_type") == "md_006":
            self.__fill_md006_people_node(node, info.get("members") or [])
        if info.get("doc_type") == "md_017":
            self.__fill_md017_people_node(node, info.get("members") or [])
        if info.get("doc_type") == "md_022":
            self.__fill_md022_trace_node(node, info)
        if info.get("doc_type") in ("md_008_01", "md_008_02"):
            self.__fill_md008_meta_node(node, info)
        if info.get("doc_type") in ("md_019", "md_020"):
            self.__fill_env_maint_node(node, info)
        for child in (node.get("children") or []):
            self.__fill_node(child, info)

    @staticmethod
    def __member_names(members, pred):
        out = []
        for m in members or []:
            role = str(getattr(m, "role", "") or "").strip()
            name = str(getattr(m, "name", "") or "").strip()
            if name and pred(role):
                out.append(name)
        return out

    def __fill_md006_people_node(self, node, members):
        title = self.__strip_num(node.get("title"))
        staff_defs = [
            (lambda r: r in ("模型部负责人", "模型负责人"), "模型部负责人"),
            (lambda r: r == "高级算法工程师", "高级算法工程师"),
            (lambda r: r == "算法工程师", "算法工程师"),
            (lambda r: r == "项目专员", "项目专员"),
        ]
        staff_rows = []
        for pred, label in staff_defs:
            for name in self.__member_names(members, pred):
                staff_rows.append([str(len(staff_rows) + 1), name, "模型部", label])
        pm = (self.__member_names(members, lambda r: "产品经理" in r) or [""])[0]
        testers = self.__member_names(members, lambda r: r == "项目专员")
        algos = self.__member_names(members, lambda r: r == "算法工程师")
        tpm = (self.__member_names(members, lambda r: "TPM" in r.upper()) or [""])[0]
        if not tpm:
            tpm = " ".join(self.__member_names(members, lambda r: "开发人员" in r))
        data_names = " ".join(self.__member_names(members, lambda r: "数据" in r))
        model_dept = " ".join(r[1] for r in staff_rows)

        if title == "项目简介" and pm:
            body = str(node.get("body") or "")
            if re.search(r"产品经理[：:]", body):
                node["body"] = re.sub(r"产品经理[：:][^\n]*", "产品经理： " + pm, body, count=1)
            else:
                node["body"] = (body.rstrip() + ("\n" if body.strip() else "") + "产品经理： " + pm)

        tables = node.get("tables") or []
        if title == "人员资源" and tables and isinstance(tables[0], list) and tables[0]:
            hdr = tables[0][0]
            if isinstance(hdr, list) and "编号" in str(hdr[0] or ""):
                tables[0] = [hdr] + staff_rows

        if "里程碑" in title and tables and isinstance(tables[0], list) and tables[0]:
            t = tables[0]
            header = t[0] if isinstance(t[0], list) else []
            hi = next((i for i, h in enumerate(header) if "负责人" in str(h or "")), -1)
            si = next((i for i, h in enumerate(header) if "阶段" in str(h or "")), -1)
            if hi >= 0:
                for row in t[1:]:
                    if not isinstance(row, list):
                        continue
                    stage = str(row[si] or "") if si >= 0 else " ".join(str(c or "") for c in row)
                    names = testers if "测试" in stage else algos
                    if names:
                        while len(row) <= hi:
                            row.append("")
                        row[hi] = "\n".join(names)

        for i, tb in enumerate(tables):
            if not self.__is_review_grid(tb):
                continue
            new_tb = []
            for row in tb:
                if not isinstance(row, list) or str(row[0] or "").strip() != "参评人员":
                    new_tb.append(row)
                    continue
                next_row = list(row)

                def put(idx):
                    if idx >= len(next_row):
                        return
                    dept = str(next_row[idx] or "").strip()
                    names = ""
                    if dept == "模型部":
                        names = model_dept
                    elif dept == "产品部":
                        names = pm
                    elif "产品开发" in dept:
                        names = tpm
                    elif dept == "数据部":
                        names = data_names
                    if names and idx + 1 < len(next_row):
                        next_row[idx + 1] = names

                put(1)
                put(3)
                new_tb.append(next_row)
            tables[i] = new_tb
        node["tables"] = tables

    def __fill_md017_people_node(self, node, members):
        if self.__strip_num(node.get("title")) != "测试人员":
            return
        tables = node.get("tables") or []
        for ti, tb in enumerate(tables):
            if not isinstance(tb, list) or not tb or not isinstance(tb[0], list):
                continue
            hdr = [str(h or "") for h in tb[0]]
            pi = next((i for i, h in enumerate(hdr) if "资源数量" in h or "具体人员" in h), -1)
            ri = next((i for i, h in enumerate(hdr) if "角色" in h), 0)
            if pi < 0:
                continue
            new_tb = [tb[0]]
            for row in tb[1:]:
                if not isinstance(row, list):
                    new_tb.append(row)
                    continue
                next_row = list(row)
                role = str(next_row[ri] if ri < len(next_row) else "").strip()
                names = self.__member_names(members, lambda r, role=role: r == role) if role else []
                while len(next_row) <= pi:
                    next_row.append("")
                next_row[pi] = ("%d人/%s" % (len(names), " ".join(names))) if names else ""
                new_tb.append(next_row)
            tables[ti] = new_tb
        node["tables"] = tables

    def __md022_file_no(self, prod_id, version, doc_type):
        row = db.session.execute(
            select(ModelDoc).where(ModelDoc.product_id == prod_id, ModelDoc.doc_type == doc_type).order_by(ModelDoc.id.desc())
        ).scalars().first()
        stored = (row.file_no or "").strip() if row else ""
        ver = version or ((row.version or "") if row else "")
        return serv_review_util.resolve_doc_file_no(prod_id, stored, ver, doc_type) or ""

    def __md022_srs_by_module(self, prod_id):
        out = {m: "" for m in MD022_MODULES}
        if not prod_id:
            return out
        doc = db.session.execute(
            select(SrsDoc).where(
                SrsDoc.product_id == prod_id,
                ~SrsDoc.version.like(f"{DELETED_SRS_VERSION_PREFIX}%"),
            ).order_by(SrsDoc.id.desc())
        ).scalars().first()
        if not doc:
            return out
        reqs = db.session.execute(
            select(SrsReq).where(SrsReq.doc_id == doc.id, SrsReq.type_code != "reqd")
        ).scalars().all()

        def blob(row):
            return " ".join(str(getattr(row, f, "") or "") for f in ("module", "function", "sub_function"))

        fallback = ""
        for module in MD022_MODULES:
            hits = [
                str(r.code or "").strip()
                for r in reqs
                if module in blob(r) and str(r.code or "").strip().upper().startswith("SRS-")
            ]
            if hits:
                hits.sort()
                out[module] = hits[0]
                if not fallback:
                    fallback = hits[0]
        if fallback:
            for module in MD022_MODULES:
                if not out[module]:
                    out[module] = fallback
        return out

    def __fill_md022_trace_node(self, node, info):
        if self.__strip_num(node.get("title")) != "模型可追溯性分析表":
            return
        file_nos = info.get("md022_file_nos") or {}
        srs_map = info.get("md022_srs") or {}
        tables = node.get("tables") or []
        for ti, tb in enumerate(tables):
            if not isinstance(tb, list) or not tb or not isinstance(tb[0], list):
                continue
            hdr = [str(h or "").strip() for h in tb[0]]
            if "算法需求" not in hdr or "模块" not in hdr:
                continue
            req_i = hdr.index("算法需求")
            mod_i = hdr.index("模块")
            col_i = {name: hdr.index(name) for name in MD022_ID_COLS if name in hdr}
            new_tb = [tb[0]]
            for row in tb[1:]:
                if not isinstance(row, list):
                    new_tb.append(row)
                    continue
                next_row = list(row)
                while len(next_row) < len(hdr):
                    next_row.append("")
                module = str(next_row[mod_i] if mod_i < len(next_row) else "").strip()
                mapping = MD022_MODULE_DOC_TYPES.get(module) or {}
                next_row[req_i] = srs_map.get(module) or ""
                for name, idx in col_i.items():
                    dt = mapping.get(name)
                    next_row[idx] = (file_nos.get(dt) or "") if dt else ""
                new_tb.append(next_row)
            tables[ti] = new_tb
        node["tables"] = tables

    @staticmethod
    def __to_dotted_date(s):
        m = re.search(r"(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日", str(s or ""))
        if m:
            return "%s.%d.%d" % (m.group(1), int(m.group(2)), int(m.group(3)))
        return str(s or "").strip()

    def __fill_md008_meta_node(self, node, info):
        tables = node.get("tables") or []
        date = info.get("md008_date") or ""
        auditee = info.get("md008_auditee") or ""
        auditor = info.get("md008_auditor") or ""
        sign = info.get("md008_sign") or auditor
        for ti, tb in enumerate(tables):
            if not self.__is_md008_checklist(tb):
                continue
            new_tb = []
            for row in tb:
                if not isinstance(row, list):
                    new_tb.append(row)
                    continue
                next_row = list(row)
                while len(next_row) < 7:
                    next_row.append("")
                a = str(next_row[0] or "").strip()
                if a == "代码地址":
                    next_row[5] = date
                if a == "被审核人":
                    next_row[2] = auditee
                    next_row[5] = auditor
                if "审核人" in a and "签字" in a:
                    next_row[2] = sign
                new_tb.append(next_row)
            tables[ti] = new_tb
        node["tables"] = tables

    @staticmethod
    def __week_ranges_from_dates(dates):
        if not dates:
            return []
        start_d, end_d = min(dates), max(dates)
        if start_d > end_d:
            return []

        def fmt(d):
            return f"{d.year}.{d.month:02d}.{d.day:02d}"

        ranges = []
        cur = start_d - timedelta(days=start_d.weekday())
        while cur <= end_d:
            monday = cur
            friday = monday + timedelta(days=4)
            ws = max(monday, start_d)
            we = min(friday, end_d)
            if ws.weekday() >= 5:
                cur = monday + timedelta(days=7)
                continue
            if we.weekday() >= 5:
                we = friday
            if ws <= we:
                ranges.append(f"{fmt(ws)}- {fmt(we)}")
            cur = monday + timedelta(days=7)
        return ranges

    def __parse_eq_table(self, tb):
        out, seen = [], set()
        if not isinstance(tb, list):
            return out
        hi = brand_i = code_i = name_i = usage_i = -1
        for i, row in enumerate(tb):
            if not isinstance(row, list):
                continue
            cells = [str(c or "").strip() for c in row]
            if any(c == "品牌" for c in cells) and any("资产编码" in c for c in cells):
                hi = i
                brand_i = next(j for j, c in enumerate(cells) if c == "品牌")
                code_i = next(j for j, c in enumerate(cells) if "资产编码" in c)
                name_i = next((j for j, c in enumerate(cells) if c == "名称"), -1)
                usage_i = next((j for j, c in enumerate(cells) if c == "用途"), -1)
                break
        if hi < 0:
            return out
        for row in tb[hi + 1:]:
            if not isinstance(row, list):
                continue
            brand = str(row[brand_i] if brand_i < len(row) else "").strip()
            code = str(row[code_i] if code_i < len(row) else "").strip()
            name = str(row[name_i] if 0 <= name_i < len(row) else "").strip()
            usage = str(row[usage_i] if 0 <= usage_i < len(row) else "").strip()
            if name == "显示器":
                continue
            if brand in ("组装机", "Apple") and code and code not in seen:
                seen.add(code)
                out.append((code, usage))
        return out

    def __parse_eq_codes(self, content):
        if isinstance(content, dict) and isinstance(content.get("rows"), list):
            return self.__parse_eq_table(content.get("rows"))
        out, seen = [], set()

        def walk(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                for tb in n.get("tables") or []:
                    if not isinstance(tb, list):
                        continue
                    hi = brand_i = code_i = name_i = -1
                    for i, row in enumerate(tb):
                        if not isinstance(row, list):
                            continue
                        cells = [str(c or "").strip() for c in row]
                        if any(c == "品牌" for c in cells) and any("资产编码" in c for c in cells):
                            hi = i
                            brand_i = next(j for j, c in enumerate(cells) if c == "品牌")
                            code_i = next(j for j, c in enumerate(cells) if "资产编码" in c)
                            name_i = next((j for j, c in enumerate(cells) if c == "名称"), -1)
                            break
                    if hi < 0:
                        continue
                    for row in tb[hi + 1:]:
                        if not isinstance(row, list):
                            continue
                        brand = str(row[brand_i] if brand_i < len(row) else "").strip()
                        code = str(row[code_i] if code_i < len(row) else "").strip()
                        name = str(row[name_i] if 0 <= name_i < len(row) else "").strip()
                        if name == "显示器":
                            continue
                        usage = ""
                        if any("用途" in str(c or "") for c in (tb[hi] if hi >= 0 else [])):
                            usage_i = next((j for j, c in enumerate(tb[hi]) if "用途" in str(c or "")), -1)
                            usage = str(row[usage_i] if 0 <= usage_i < len(row) else "").strip()
                        if brand in ("组装机", "Apple") and code and code not in seen:
                            seen.add(code)
                            out.append((code, usage))
                walk(n.get("children") or [])

        walk((content or {}).get("sections") or [])
        return out

    def __fill_env_maint_node(self, node, info):
        eq_assets = info.get("env_assets")
        prod_name = info.get("prod_name") or ""
        full_version = info.get("full_version") or ""
        tables = node.get("tables") or []
        for ti, tb in enumerate(tables):
            if not isinstance(tb, list) or not self.__is_asset_grid(tb):
                continue
            old = {}
            for row in tb[1:]:
                if isinstance(row, list) and row:
                    code = str(row[0] or "").strip()
                    if code:
                        old[code] = str(row[1] if len(row) > 1 else "")
            hdr = [str(c or "") for c in tb[0]]
            hdr = hdr[:4] if len(hdr) >= 4 else ["资产编码", "设备信息", "产品名称", "完整版本"]
            if eq_assets is not None:
                body = [[code, old.get(code, ""), prod_name, full_version] for code, _u in eq_assets]
                tables[ti] = [hdr] + body
            else:
                new_tb = [hdr]
                for row in tb[1:]:
                    if not isinstance(row, list):
                        continue
                    next_row = list(row)
                    while len(next_row) < 4:
                        next_row.append("")
                    next_row[2] = prod_name
                    next_row[3] = full_version
                    new_tb.append(next_row)
                tables[ti] = new_tb
        node["tables"] = tables

    def __collect_asset_codes(self, content):
        out, seen = [], set()

        def walk(ns):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                for tb in n.get("tables") or []:
                    if not self.__is_asset_grid(tb):
                        continue
                    for row in tb[1:]:
                        if not isinstance(row, list) or not row:
                            continue
                        code = str(row[0] or "").strip()
                        if code and code not in seen:
                            seen.add(code)
                            out.append((code, ""))
                walk(n.get("children") or [])

        walk((content or {}).get("sections") or [])
        return out

    def __rebuild_env_checks(self, content, info):
        want = info.get("env_title") or ""
        doc_type = info.get("doc_type") or "md_019"
        weeks = info.get("env_weeks") or []
        checker = info.get("env_checker") or ""
        assets = info.get("env_assets")
        if assets is None:
            assets = self.__collect_asset_codes(content)

        def find_title(ns, name):
            for n in ns or []:
                if not isinstance(n, dict):
                    continue
                if self.__strip_num(n.get("title")) == name:
                    return n
                hit = find_title(n.get("children") or [], name)
                if hit:
                    return hit
            return None

        node = find_title((content or {}).get("sections") or [], want)
        if not node:
            return
        old = {}
        for tb in node.get("tables") or []:
            if not self.__is_env_check_grid(tb):
                continue
            code = str(tb[0][2] if len(tb[0]) > 2 else "")
            by_date = {}
            for row in tb[1:]:
                if isinstance(row, list) and row:
                    by_date[str(row[0] or "")] = [str(c or "") for c in row]
            old[code] = by_date
        tables = []
        for code, usage in assets or []:
            kind = "server" if "共用" in str(usage or "") else "dev"
            defaults = self.__env_check_defaults(doc_type, kind)
            prev = old.get(code) or {}
            rows = [["env_check", kind, code]]
            for w in weeks:
                p = prev.get(w) or []
                marks = []
                for i, d in enumerate(defaults):
                    v = str(p[i + 1] if i + 1 < len(p) else "").strip()
                    marks.append(v if v in ("是", "否") else d)
                problem = str(p[len(defaults) + 1] if len(p) > len(defaults) + 1 else "").strip() or "无"
                rows.append([w] + marks + [problem, checker])
            tables.append(rows)
        node["tables"] = tables

    def __apply_env_eq_assets(self, obj: ModelDocObj, product: Product = None):
        """打开详情时按最新设备清单覆盖资产编码并重建周检（与 DEM get 一致，不落库）。"""
        if obj.doc_type not in ("md_019", "md_020") or not obj.product_id:
            return
        info = self.__collect_autofill(obj.product_id, product, obj.version, obj.doc_type)

        def walk(ns):
            for n in ns or []:
                if isinstance(n, dict):
                    self.__fill_env_maint_node(n, info)
                    walk(n.get("children") or [])

        walk((obj.content or {}).get("sections") or [])
        self.__rebuild_env_checks(obj.content, info)

    def __fill_crr_fields(self, content, obj: ModelDocObj):
        content = self.__normalize_crr_content(content, obj.doc_type)
        if not obj.product_id:
            return content
        product = db.session.execute(select(Product).where(Product.id == obj.product_id)).scalars().first()
        info = self.__collect_autofill(obj.product_id, product, obj.version, obj.doc_type)
        content["check_date"] = info.get("md008_date") or ""
        content["sign_date"] = content["check_date"]
        content["auditee"] = info.get("md008_auditee") or ""
        content["auditor"] = info.get("md008_auditor") or ""
        content["sign_img"] = info.get("md008_sign") or content.get("auditor") or ""
        return content

    def __apply_crr_autofill(self, obj: ModelDocObj, product: Product = None):
        if obj.doc_type not in CRR_DOC_TYPES:
            return
        obj.content = self.__fill_crr_fields(obj.content, obj)

    def __exists(self, product_id, doc_type, version, exclude_id=None):
        sql = select(func.count(ModelDoc.id)).where(
            ModelDoc.product_id == product_id,
            ModelDoc.doc_type == doc_type,
            ModelDoc.version == version,
        )
        if exclude_id:
            sql = sql.where(ModelDoc.id != exclude_id)
        return (db.session.execute(sql).scalar() or 0) > 0

    async def add_model_doc(self, form: ModelDocForm):
        try:
            doc_type = (form.doc_type or "").strip()
            if doc_type not in DOC_META:
                return Resp.resp_err(msg=ts("msg_err_param"))
            if self.__exists(form.product_id, doc_type, form.version):
                return Resp.resp_err(msg=ts("msg_obj_exist"))
            payload = form.dict(exclude_none=True)
            payload["doc_type"] = doc_type
            row = ModelDoc(**payload)
            row.id = None
            row.file_no = serv_review_util.resolve_doc_file_no(form.product_id, form.file_no, form.version, doc_type) or None
            row.content = self.__normalize_content(row.content, doc_type, product_id=form.product_id)
            row.content = self.__apply_dataset_counts(row.content, doc_type, form.product_id)
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=ModelDocForm(id=row.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def duplicate_model_doc(self, id: int, product_id: int = None):
        try:
            fromdoc: ModelDoc = db.session.execute(select(ModelDoc).where(ModelDoc.id == id)).scalars().first()
            if not fromdoc:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            target_pid = product_id or fromdoc.product_id
            all_versions = db.session.execute(
                select(ModelDoc.version).where(ModelDoc.product_id == target_pid, ModelDoc.doc_type == fromdoc.doc_type)
            ).scalars().all()
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
            newdoc = ModelDoc(
                product_id=target_pid,
                doc_type=fromdoc.doc_type,
                version=version,
                file_no=sync_file_no_version(
                    (fromdoc.file_no or "").strip()
                    or serv_review_util.resolve_doc_file_no(target_pid, "", version, fromdoc.doc_type)
                    or "",
                    version,
                ) or None,
                change_log=fromdoc.change_log,
                content=copy.deepcopy(self.__normalize_content(fromdoc.content, fromdoc.doc_type, product_id=target_pid)),
            )
            db.session.add(newdoc)
            db.session.commit()
            return Resp.resp_ok(data=ModelDocForm(id=newdoc.id))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_model_doc(self, form: ModelDocForm):
        try:
            row: ModelDoc = db.session.execute(select(ModelDoc).where(ModelDoc.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            payload = form.dict(exclude_none=True)
            payload.pop("doc_type", None)
            next_pid = payload.get("product_id", row.product_id)
            next_ver = payload.get("version", row.version)
            if next_pid != row.product_id or next_ver != row.version:
                if self.__exists(next_pid, row.doc_type, next_ver, exclude_id=row.id):
                    return Resp.resp_err(msg=ts("msg_obj_exist"))
            if next_pid != row.product_id or "content" in payload:
                raw = payload.get("content", row.content)
                filled = self.__normalize_content(raw, row.doc_type, product_id=next_pid)
                filled = self.__apply_dataset_counts(filled, row.doc_type, next_pid)
                payload["content"] = filled
            for key, value in payload.items():
                if key == "id":
                    continue
                if key == "content":
                    value = self.__normalize_content(value, row.doc_type, product_id=next_pid)
                    value = self.__apply_dataset_counts(value, row.doc_type, next_pid)
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_model_doc(self, id: int):
        db.session.execute(delete(ModelDoc).where(ModelDoc.id == id))
        db.session.commit()
        return Resp.resp_ok()

    async def get_model_doc(self, id: int):
        sql = select(ModelDoc, Product).join(Product, ModelDoc.product_id == Product.id).where(ModelDoc.id == id)
        row = db.session.execute(sql).first()
        if not row:
            return Resp.resp_err(msg=ts("msg_obj_null"))
        doc, product = row
        obj = self.__to_obj(doc, product)
        self.__apply_env_eq_assets(obj, product)
        self.__apply_crr_autofill(obj, product)
        self.__apply_dataset_autofill(obj)
        return Resp.resp_ok(data=obj)

    async def list_model_doc(self, op_user: UserObj = None, product_id: int = 0, version: str = None,
                             doc_type: str = None, doc_type_prefix: str = None,
                             page_index: int = 0, page_size: int = 10):
        wheres = []
        if doc_type:
            wheres.append(ModelDoc.doc_type == doc_type)
        if doc_type_prefix:
            wheres.append(ModelDoc.doc_type.like(f"{doc_type_prefix}%"))
        if product_id:
            wheres.append(ModelDoc.product_id == product_id)
        if version:
            wheres.append(ModelDoc.version.like(f"%{version}%"))
        if op_user and op_user.id != 1 and op_user.role_code == Roles.product_manager.value.code:
            wheres.append(Product.create_user_id == op_user.id)
        sql_total = select(func.count(ModelDoc.id)).join(Product, ModelDoc.product_id == Product.id).where(*wheres)
        total = db.session.execute(sql_total).scalar() or 0
        sql = (
            select(ModelDoc, Product)
            .join(Product, ModelDoc.product_id == Product.id)
            .where(*wheres)
            .order_by(ModelDoc.id.desc())
            .offset(page_index * page_size)
            .limit(page_size)
        )
        rows: List[ModelDocObj] = [self.__to_obj(doc, product) for doc, product in db.session.execute(sql).all()]
        return Resp.resp_ok(data=Page(total=total, rows=rows, page_index=page_index, page_size=page_size))

    def __export_xlsx(self, output, obj: ModelDocObj, content):
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        wb = Workbook()
        default = wb.active
        if obj.doc_type in EQ_DOC_TYPES or (isinstance(content, dict) and isinstance(content.get("rows"), list)):
            thin_eq = Border(
                left=Side(style="thin"), right=Side(style="thin"),
                top=Side(style="thin"), bottom=Side(style="thin"),
            )
            default.title = (doc_title(obj.doc_type) or "设备清单")[:31]
            for r_i, row in enumerate(content.get("rows") or [], 1):
                if not isinstance(row, list):
                    continue
                for c_i, val in enumerate(row, 1):
                    cell = default.cell(r_i, c_i, str(val or ""))
                    cell.alignment = Alignment(wrap_text=True, vertical="center")
                    cell.border = thin_eq
                    cell.font = Font(bold=(r_i == 1), name="宋体")
            wb.save(output)
            output.seek(0)
            return
        used_names = set()
        thin = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )

        def sheet_name(title):
            raw = self.__strip_num(title) or "Sheet"
            name = re.sub(r'[:\\/\?\*\[\]]', "_", raw)[:31] or "Sheet"
            base = name
            idx = 2
            while name.lower() in used_names:
                suffix = str(idx)
                name = (base[: 31 - len(suffix)] + suffix)
                idx += 1
            used_names.add(name.lower())
            return name

        def write_table(ws, grid, start_row=1):
            if self.__is_md008_checklist(grid):
                rows, origins = self.__md008_span_origins(grid)
                r_n = len(rows)
                c_n = max((len(r) for r in rows), default=7)
                for r_i, row in enumerate(rows):
                    for c_i in range(c_n):
                        raw = row[c_i] if c_i < len(row) else ""
                        s = str(raw or "")
                        if s.startswith("data:image"):
                            s = "[签名]"
                        cell = ws.cell(start_row + r_i, c_i + 1, s)
                        cell.alignment = Alignment(wrap_text=True, vertical="center")
                        cell.border = thin
                        cell.font = Font(name="宋体")
                for r, c, rs, cs in origins:
                    if rs > 1 or cs > 1:
                        ws.merge_cells(
                            start_row=start_row + r, start_column=c + 1,
                            end_row=start_row + r + rs - 1, end_column=c + cs,
                        )
                widths = (10.5, 11.4, 41.7, 6.9, 6.5, 6.9, 13.6)
                for i, w in enumerate(widths, 1):
                    ws.column_dimensions[get_column_letter(i)].width = w
                return start_row + r_n
            r_idx = start_row
            for r_i, row in enumerate(grid or []):
                if not isinstance(row, list):
                    continue
                for c_i, val in enumerate(row, 1):
                    s = str(val or "")
                    if s.startswith("data:image"):
                        s = "[签名]"
                    cell = ws.cell(r_idx, c_i, s)
                    cell.alignment = Alignment(wrap_text=True, vertical="center")
                    cell.border = thin
                    if r_i == 0:
                        cell.font = Font(bold=True, name="宋体")
                    else:
                        cell.font = Font(name="宋体")
                r_idx += 1
            return r_idx

        first = True
        for node in (content or {}).get("sections") or []:
            ws = default if first else wb.create_sheet()
            first = False
            ws.title = sheet_name(node.get("title"))
            title = self.__strip_num(node.get("title"))
            tables = node.get("tables") or []
            crr_sheet = any(self.__is_md008_checklist(t) for t in tables)
            if crr_sheet:
                row = 1
                for table in tables:
                    row = write_table(ws, table, row) + 1
            else:
                ws.cell(1, 1, title).font = Font(bold=True, size=14, name="宋体")
                row = 3
                if (node.get("body") or "").strip():
                    ws.cell(row, 1, node.get("body"))
                    row += 2
                for table in tables:
                    row = write_table(ws, table, row) + 2
            for child in (node.get("children") or []):
                ws.cell(row, 1, self.__strip_num(child.get("title"))).font = Font(bold=True, name="宋体")
                row += 1
                if (child.get("body") or "").strip():
                    ws.cell(row, 1, child.get("body"))
                    row += 1
                for table in (child.get("tables") or []):
                    row = write_table(ws, table, row) + 2
        if first:
            default.title = "模型文件"
        wb.save(output)
        output.seek(0)

    def __export_crr_docx(self, output, obj: ModelDocObj, content):
        c = content if isinstance(content, dict) else {}
        document = Document()
        section = document.sections[0]
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)
        header_para = section.header.add_paragraph()
        header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        docx_util.fonted_txt(header_para, obj.file_no or "")
        docx_util.add_page_number_footer(section, obj.file_no or "", skip_first=False)

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT):
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = align
                    para.add_run().add_picture(BytesIO(base64.b64decode(b64)), height=Pt(30))
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
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        def set_check(cell, checked):
            cell.text = ""
            para = cell.paragraphs[0]
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = para.add_run("\u2611\ufe0e" if checked else "\u2610")
            run.font.size = Pt(12)
            run.font.name = "宋体"
            rpr = run._element.get_or_add_rPr()
            rfonts = rpr.find(qn("w:rFonts"))
            if rfonts is None:
                rfonts = OxmlElement("w:rFonts")
                rpr.append(rfonts)
            for _attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
                rfonts.set(qn(_attr), "宋体")
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        title = document.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        docx_util.fonted_txt(title, doc_title(obj.doc_type), font_size=18.0, bold=True)

        head = document.add_table(rows=0, cols=4)
        head.style = "Table Grid"
        head.alignment = WD_TABLE_ALIGNMENT.CENTER

        def head_row(label1, val1, label2="", val2="", merge_val=False):
            cells = head.add_row().cells
            set_cell(cells[0], label1, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
            if merge_val:
                merged = cells[1].merge(cells[2]).merge(cells[3])
                set_cell(merged, val1)
            else:
                set_cell(cells[1], val1)
                set_cell(cells[2], label2, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
                set_cell(cells[3], val2)

        head_row("代码地址", str(c.get("code_url", "") or "").replace("\t", " "), "检查日期", c.get("check_date", ""))
        head_row("被审核人", c.get("auditee", ""), "审核人", c.get("auditor", ""))
        head_row("审核依据", c.get("basis", "") or "", merge_val=True)
        head_row("审核方式", c.get("method", "") or "代码审查", merge_val=True)
        document.add_paragraph()

        checklist = [r for r in (c.get("checklist") or []) if isinstance(r, list)]
        cols = 6
        tbl = document.add_table(rows=0, cols=cols)
        tbl.style = "Table Grid"
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        col_dxa = [720, 4680, 720, 720, 1008, 2160]
        cat_flags = []
        for r_idx, row in enumerate(checklist):
            cells = tbl.add_row().cells
            first = str(row[0] if row else "").strip()
            is_cat = first in _CRR_CATEGORIES and all(not str(row[i] if i < len(row) else "").strip() for i in range(1, cols))
            cat_flags.append(is_cat)
            if is_cat:
                merged = cells[0]
                for i in range(1, cols):
                    merged = merged.merge(cells[i])
                set_cell(merged, first, bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
                tc_pr = merged._tc.get_or_add_tcPr()
                shd = OxmlElement("w:shd")
                shd.set(qn("w:val"), "clear")
                shd.set(qn("w:color"), "auto")
                shd.set(qn("w:fill"), "FFFF99")
                tc_pr.append(shd)
            else:
                for c_idx in range(cols):
                    val = row[c_idx] if c_idx < len(row) else ""
                    if r_idx != 0 and c_idx in (2, 3, 4):
                        set_check(cells[c_idx], bool(str(val).strip()))
                        continue
                    align = WD_ALIGN_PARAGRAPH.CENTER if c_idx != 1 else WD_ALIGN_PARAGRAPH.LEFT
                    set_cell(cells[c_idx], val, bold=(r_idx == 0), align=align)
        tbl.autofit = False
        _tblPr = tbl._tbl.tblPr
        _layout = _tblPr.find(qn("w:tblLayout"))
        if _layout is None:
            _layout = OxmlElement("w:tblLayout")
            _tblPr.append(_layout)
        _layout.set(qn("w:type"), "fixed")
        _grid = tbl._tbl.find(qn("w:tblGrid"))
        if _grid is not None:
            for _gc in list(_grid):
                _grid.remove(_gc)
            for _w in col_dxa:
                _gc = OxmlElement("w:gridCol")
                _gc.set(qn("w:w"), str(_w))
                _grid.append(_gc)
        for _ri, _r in enumerate(tbl.rows):
            if _ri < len(cat_flags) and cat_flags[_ri]:
                continue
            _cells = _r.cells
            for _i, _w in enumerate(col_dxa):
                if _i < len(_cells):
                    _tcpr = _cells[_i]._tc.get_or_add_tcPr()
                    _tcw = _tcpr.find(qn("w:tcW"))
                    if _tcw is None:
                        _tcw = OxmlElement("w:tcW")
                        _tcpr.append(_tcw)
                    _tcw.set(qn("w:w"), str(_w))
                    _tcw.set(qn("w:type"), "dxa")
        document.add_paragraph()

        concl = str(c.get("conclusion") or "").strip()
        concl_tbl = document.add_table(rows=1, cols=1)
        concl_tbl.style = "Table Grid"
        concl_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        marks = " ".join([("%s%s" % ("\u2611\ufe0e" if concl == name else "\u2610", name)) for name in _CRR_CONCLUSIONS])
        set_cell(concl_tbl.rows[0].cells[0], "结论： " + marks)
        document.add_paragraph()

        sign_tbl = document.add_table(rows=1, cols=3)
        sign_tbl.style = "Table Grid"
        sign_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        srow = sign_tbl.rows[0].cells
        sign_tbl.rows[0].height = Pt(52)
        sign_tbl.rows[0].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        set_cell(srow[0], "审核人（签字）/日期", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(srow[1], c.get("sign_img", "") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(srow[2], c.get("sign_date", "") or c.get("check_date", "") or "", align=WD_ALIGN_PARAGRAPH.CENTER)

        document.save(output)
        output.seek(0)

    def __export_build_docx(self, output, obj: ModelDocObj, content):
        c = content if isinstance(content, dict) else {}
        document = Document()
        section = document.sections[0]
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)
        header_para = section.header.add_paragraph()
        header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        docx_util.fonted_txt(header_para, obj.file_no or "")
        docx_util.add_page_number_footer(section, obj.file_no or "", skip_first=False)

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT):
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = align
                    para.add_run().add_picture(BytesIO(base64.b64decode(b64)), height=Pt(30))
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
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        title = document.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        docx_util.fonted_txt(title, doc_title(obj.doc_type), font_size=18.0, bold=True)

        tbl = document.add_table(rows=0, cols=4)
        tbl.style = "Table Grid"
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER

        def add_row():
            return tbl.add_row().cells

        def pair(l1, v1, l2, v2):
            cells = add_row()
            set_cell(cells[0], l1, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
            set_cell(cells[1], v1, align=WD_ALIGN_PARAGRAPH.CENTER)
            set_cell(cells[2], l2, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
            set_cell(cells[3], v2, align=WD_ALIGN_PARAGRAPH.CENTER)

        pair("编写人", c.get("author") or "", "编写时间", c.get("write_date") or "")
        pair("数据用途", c.get("data_use") or "", "数据类型", c.get("data_type") or "")
        cells = add_row()
        set_cell(cells[0], "构建方法", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
        merged = cells[1].merge(cells[2]).merge(cells[3])
        set_cell(merged, c.get("method") or "")
        pair("病例数量", c.get("case_count") or "", "标记人员及方式", c.get("annotator") or "")
        cells = add_row()
        bar = cells[0].merge(cells[1]).merge(cells[2]).merge(cells[3])
        set_cell(bar, "数据分布", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)

        dist = [self.__build_pad_row(r) for r in (c.get("dist_rows") or []) if isinstance(r, list)]
        if not dist:
            dist = [["因素", "类别", "数量", "占比"]]
        dist_start = len(tbl.rows)
        for r_idx, row in enumerate(dist):
            cells = add_row()
            is_head = r_idx == 0
            is_total = str(row[0]).strip() == "总计"
            for ci in range(4):
                set_cell(
                    cells[ci], row[ci],
                    bold=(is_head or is_total),
                    align=WD_ALIGN_PARAGRAPH.CENTER,
                )
        i = 1
        while i < len(dist):
            a = str(dist[i][0] or "").strip()
            if not a or a == "总计":
                i += 1
                continue
            j = i + 1
            while j < len(dist) and not str(dist[j][0] or "").strip():
                j += 1
            if j > i + 1:
                start_cell = tbl.cell(dist_start + i, 0)
                end_cell = tbl.cell(dist_start + j - 1, 0)
                start_cell.merge(end_cell)
                set_cell(start_cell, a, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
            i = j

        cells = add_row()
        tbl.rows[-1].height = Pt(44)
        tbl.rows[-1].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        set_cell(cells[0], "编写人签字（日期）", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(cells[1], c.get("author_sign") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(cells[2], "审核人签字（日期）", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell(cells[3], c.get("auditor_sign") or "", align=WD_ALIGN_PARAGRAPH.CENTER)

        col_dxa = [1400, 3600, 1400, 2400]
        tbl.autofit = False
        _tblPr = tbl._tbl.tblPr
        _layout = _tblPr.find(qn("w:tblLayout"))
        if _layout is None:
            _layout = OxmlElement("w:tblLayout")
            _tblPr.append(_layout)
        _layout.set(qn("w:type"), "fixed")
        _grid = tbl._tbl.find(qn("w:tblGrid"))
        if _grid is not None:
            for _gc in list(_grid):
                _grid.remove(_gc)
            for _w in col_dxa:
                _gc = OxmlElement("w:gridCol")
                _gc.set(qn("w:w"), str(_w))
                _grid.append(_gc)
        for _r in tbl.rows:
            _cells = _r.cells
            for _i, _w in enumerate(col_dxa):
                if _i < len(_cells):
                    _tcpr = _cells[_i]._tc.get_or_add_tcPr()
                    _tcw = _tcpr.find(qn("w:tcW"))
                    if _tcw is None:
                        _tcw = OxmlElement("w:tcW")
                        _tcpr.append(_tcw)
                    _tcw.set(qn("w:w"), str(_w))
                    _tcw.set(qn("w:type"), "dxa")

        document.save(output)
        output.seek(0)

    def __export_train_docx(self, output, obj: ModelDocObj, content):
        c = content if isinstance(content, dict) else {}
        document = Document()
        section = document.sections[0]
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.7)
        section.right_margin = Inches(0.7)
        header_para = section.header.add_paragraph()
        header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        docx_util.fonted_txt(header_para, obj.file_no or "")
        docx_util.add_page_number_footer(section, obj.file_no or "", skip_first=False)

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT, img_w=None):
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    para.add_run().add_picture(BytesIO(base64.b64decode(b64)), width=Inches(img_w or 6.2))
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
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        title = document.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        docx_util.fonted_txt(title, doc_title(obj.doc_type), font_size=18.0, bold=True)

        tbl = document.add_table(rows=0, cols=6)
        tbl.style = "Table Grid"
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER

        def add_row():
            return tbl.add_row().cells

        def label_cell(cell, text):
            set_cell(cell, text, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)

        cells = add_row()
        label_cell(cells[0], "编写人")
        set_cell(cells[1], c.get("author") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        label_cell(cells[2], "编写日期")
        set_cell(cells[3], c.get("write_date") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        label_cell(cells[4], "审核人")
        set_cell(cells[5], c.get("auditor") or "", align=WD_ALIGN_PARAGRAPH.CENTER)

        def span_val(label, value):
            row = add_row()
            label_cell(row[0], label)
            merged = row[1].merge(row[2]).merge(row[3]).merge(row[4]).merge(row[5])
            set_cell(merged, value)

        span_val("模型名称", c.get("model_name") or "")
        span_val("模型功能", c.get("model_func") or "")
        cells = add_row()
        label_cell(cells[0], "训练集")
        set_cell(cells[1].merge(cells[2]), c.get("train_set") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        label_cell(cells[3], "数量")
        set_cell(cells[4].merge(cells[5]), c.get("case_count") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        span_val("训练时间", c.get("train_time") or "")

        def bar(text):
            row = add_row()
            merged = row[0].merge(row[1]).merge(row[2]).merge(row[3]).merge(row[4]).merge(row[5])
            set_cell(merged, text, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)

        bar("训练环境")
        span_val("硬件环境", c.get("hw_env") or "")
        span_val("软件环境", c.get("sw_env") or "")
        bar("训练数据量评估曲线")
        cells = add_row()
        tbl.rows[-1].height = Pt(220)
        tbl.rows[-1].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        pic = cells[0].merge(cells[1]).merge(cells[2]).merge(cells[3]).merge(cells[4]).merge(cells[5])
        set_cell(pic, c.get("eval_img") or "", img_w=6.2)
        bar("训练过程曲线")
        cells = add_row()
        tbl.rows[-1].height = Pt(180)
        tbl.rows[-1].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        pic = cells[0].merge(cells[1]).merge(cells[2]).merge(cells[3]).merge(cells[4]).merge(cells[5])
        set_cell(pic, c.get("process_img") or "", img_w=6.2)
        span_val("结论", c.get("conclusion") or "")
        cells = add_row()
        tbl.rows[-1].height = Pt(44)
        tbl.rows[-1].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        label_cell(cells[0], "编写人（签字）/日期")
        set_cell(cells[1].merge(cells[2]), c.get("author_sign") or "", align=WD_ALIGN_PARAGRAPH.CENTER)
        label_cell(cells[3], "审核人（签字）/日期")
        set_cell(cells[4].merge(cells[5]), c.get("auditor_sign") or "", align=WD_ALIGN_PARAGRAPH.CENTER)

        document.save(output)
        output.seek(0)

    def __export_test_xlsx(self, output, obj: ModelDocObj, content):
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        c = content if isinstance(content, dict) else {}
        wb = Workbook()
        ws = wb.active
        ws.title = "工作表1"
        thin = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )
        center = Alignment(wrap_text=True, vertical="center", horizontal="center")
        left = Alignment(wrap_text=True, vertical="center", horizontal="left")

        def cell_text(val):
            s = str(val or "")
            return "[签名]" if s.startswith("data:image") else s

        def put(r, col, val, bold=False, size=10.5, align=center):
            cell = ws.cell(r, col, cell_text(val))
            cell.font = Font(name="宋体", size=size, bold=bold)
            cell.alignment = align
            cell.border = thin
            return cell

        def border_range(r1, c1, r2, c2):
            for rr in range(r1, r2 + 1):
                for cc in range(c1, c2 + 1):
                    ws.cell(rr, cc).border = thin
                    if ws.cell(rr, cc).font is None or not ws.cell(rr, cc).font.name:
                        ws.cell(rr, cc).font = Font(name="宋体", size=10.5)
                    if not ws.cell(rr, cc).alignment or not ws.cell(rr, cc).alignment.vertical:
                        ws.cell(rr, cc).alignment = center

        def merge(r1, c1, r2, c2):
            if r1 != r2 or c1 != c2:
                ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
            border_range(r1, c1, r2, c2)

        put(1, 1, obj.file_no or "", bold=True, size=12)
        merge(1, 1, 1, 6)
        ws.row_dimensions[1].height = 29
        put(2, 1, doc_title(obj.doc_type), bold=True, size=16)
        merge(2, 1, 2, 6)
        ws.row_dimensions[2].height = 44

        r = 3
        put(r, 1, "编写人", bold=True)
        put(r, 2, c.get("author") or "")
        put(r, 3, "编写日期", bold=True)
        put(r, 4, c.get("write_date") or "")
        put(r, 5, "审核人", bold=True)
        put(r, 6, c.get("auditor") or "")

        def span_val(label, value):
            nonlocal r
            r += 1
            put(r, 1, label, bold=True)
            put(r, 2, value or "", align=left)
            merge(r, 2, r, 6)
            ws.row_dimensions[r].height = 23

        def bar(text):
            nonlocal r
            r += 1
            put(r, 1, text, bold=True)
            merge(r, 1, r, 6)
            ws.row_dimensions[r].height = 23

        span_val("测试模型名称", c.get("model_name") or "")
        span_val("测试集", c.get("test_set") or "")
        span_val("测试方法", c.get("method") or "")
        span_val("测试时间", c.get("test_time") or "")
        bar("测试环境")
        span_val("硬件环境", c.get("hw_env") or "")
        span_val("软件环境", c.get("sw_env") or "")
        bar("测试结果")

        is_pe = obj.doc_type == "md_013_01"
        n = 6 if is_pe else 5
        rows = [self.__test_pad_row(row, n) for row in (c.get("result_rows") or []) if isinstance(row, list)]
        if not rows:
            rows = [self.__test_header(obj.doc_type)]
        r += 1
        result_start = r
        for r_idx, row in enumerate(rows):
            is_head = r_idx == 0
            is_total = str(row[0]).strip() == "总计"
            if is_pe:
                for ci in range(6):
                    put(r, ci + 1, row[ci] if ci < len(row) else "", bold=(is_head or is_total))
            else:
                for ci in range(4):
                    put(r, ci + 1, row[ci] if ci < len(row) else "", bold=(is_head or is_total))
                put(r, 5, row[4] if len(row) > 4 else "", bold=(is_head or is_total))
                merge(r, 5, r, 6)
            ws.row_dimensions[r].height = 22
            r += 1
        i = 1
        while i < len(rows):
            a = str(rows[i][0] or "").strip()
            if not a or a == "总计":
                i += 1
                continue
            j = i + 1
            while j < len(rows) and not str(rows[j][0] or "").strip():
                j += 1
            if j > i + 1:
                top = result_start + i
                bot = result_start + j - 1
                merge(top, 1, bot, 1)
                put(top, 1, a, bold=True)
            i = j

        put(r, 1, "结论", bold=True)
        put(r, 2, c.get("conclusion") or "", align=left)
        merge(r, 2, r, 6)
        ws.row_dimensions[r].height = 32
        r += 1
        put(r, 1, "编写人（签字）/日期", bold=True)
        put(r, 2, c.get("author_sign") or "")
        merge(r, 2, r, 3)
        put(r, 4, "审核人（签字）/日期", bold=True)
        put(r, 5, c.get("auditor_sign") or "")
        merge(r, 5, r, 6)
        ws.row_dimensions[r].height = 32

        widths = (12.0, 14.0, 10.0, 12.0, 18.0, 18.0)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        wb.save(output)
        output.seek(0)

    def __export_pkg_xlsx(self, output, obj: ModelDocObj, content):
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        c = content if isinstance(content, dict) else {}
        is_rec = obj.doc_type in PKG_REC_TYPES
        is_submit = obj.doc_type in PKG_SUBMIT_TYPES
        cols = 8 if is_rec else 6
        wb = Workbook()
        ws = wb.active
        ws.title = "工作表1"
        thin = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )
        center = Alignment(wrap_text=True, vertical="center", horizontal="center")
        left = Alignment(wrap_text=True, vertical="center", horizontal="left")

        def cell_text(val):
            s = str(val or "")
            return "[签名]" if s.startswith("data:image") else s

        def put(r, col, val, bold=False, size=10.5, align=center):
            cell = ws.cell(r, col, cell_text(val))
            cell.font = Font(name="宋体", size=size, bold=bold)
            cell.alignment = align
            cell.border = thin
            return cell

        def border_range(r1, c1, r2, c2):
            for rr in range(r1, r2 + 1):
                for cc in range(c1, c2 + 1):
                    cell = ws.cell(rr, cc)
                    cell.border = thin
                    if not cell.font or not cell.font.name:
                        cell.font = Font(name="宋体", size=10.5)
                    if not cell.alignment or not cell.alignment.vertical:
                        cell.alignment = center

        def merge(r1, c1, r2, c2):
            if r1 != r2 or c1 != c2:
                ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
            border_range(r1, c1, r2, c2)

        if is_submit:
            title = "模型服务提交记录"
        elif is_rec:
            title = "模型工程封装记录"
        else:
            title = "模型工程封装需求"
        put(1, 1, (obj.file_no or "").replace("\t", "").strip(), bold=True, size=12)
        merge(1, 1, 1, cols)
        ws.row_dimensions[1].height = 22
        put(2, 1, title, bold=True, size=16)
        merge(2, 1, 2, cols)
        ws.row_dimensions[2].height = 36

        r = 3

        def span_val(label, value, value_center=False):
            nonlocal r
            put(r, 1, label, bold=True)
            put(r, 2, value or "", align=center if value_center else left)
            merge(r, 2, r, cols)
            ws.row_dimensions[r].height = 28 if len(str(value or "")) > 60 else 22
            r += 1

        if is_submit:
            put(r, 1, "编写人", bold=True)
            put(r, 2, c.get("author") or "")
            put(r, 3, "编写日期", bold=True)
            put(r, 4, c.get("write_date") or "")
            put(r, 5, "审核人", bold=True)
            put(r, 6, c.get("auditor") or "")
            ws.row_dimensions[r].height = 22
            r += 1
            span_val("功能", c.get("model_func") or "")
            span_val("提交模型", c.get("submit_model") or "")
            span_val("模型测试结论", c.get("test_conclusion") or "")
            span_val("模型代码地址", c.get("code_url") or "")
            span_val("模型参数地址", c.get("param_url") or "")
            span_val("一致性测试数据地址", c.get("consistency_data_url") or "")
            span_val("一致性结果地址", c.get("consistency_result_url") or "")
            for label, key in (
                ("编写人（签字）/日期", "author_sign"),
                ("审核人（签字）/日期", "auditor_sign"),
                ("批准人（签字）/日期", "approver_sign"),
            ):
                put(r, 1, label, bold=True)
                put(r, 2, c.get(key) or "")
                merge(r, 2, r, 6)
                ws.row_dimensions[r].height = 32
                r += 1
        else:
            span_val("模型功能", c.get("model_func") or "")
            if is_rec:
                span_val("封装代码地址", c.get("pack_code_url") or "")
            span_val("模型参数地址", c.get("param_url") or "")
            if is_rec:
                span_val("一致性测试数据地址", c.get("consistency_data_url") or "")
                span_val("一致性结果地址", c.get("consistency_result_url") or "")
                span_val("验收结论", c.get("conclusion") or "", value_center=True)
            else:
                span_val("一致性测试结果", c.get("consistency_url") or "")
                span_val("待封装代码地址", c.get("code_url") or "")

            put(r, 1, "封装人/日期" if is_rec else "提交人/日期", bold=True)
            if is_rec:
                put(r, 2, c.get("packer_sign") or "")
                merge(r, 2, r, 4)
                put(r, 5, "审核人/日期", bold=True)
                put(r, 6, c.get("auditor_sign") or "")
                merge(r, 6, r, 8)
            else:
                put(r, 2, c.get("submitter_sign") or "")
                merge(r, 2, r, 3)
                put(r, 4, "审核人/日期", bold=True)
                put(r, 5, c.get("auditor_sign") or "")
                merge(r, 5, r, 6)
            ws.row_dimensions[r].height = 32

        if is_rec:
            widths = (18.0, 12.0, 13.0, 13.0, 13.0, 13.0, 13.0, 13.0)
        else:
            widths = (16.0, 12.0, 12.0, 12.0, 14.0, 18.0)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        wb.save(output)
        output.seek(0)

    async def export_model_doc(self, output, id: int):
        resp = await self.get_model_doc(id)
        obj: ModelDocObj = resp.data
        if obj is None:
            Document().save(output)
            output.seek(0)
            return "模型文件", "docx"
        c = self.__autofill_for_export(self.__normalize_content(obj.content, obj.doc_type, product_id=obj.product_id), obj)
        if obj.doc_type in ("pd_003", "md_004", "md_007", "md_014", "md_016", "md_018"):
            self.__fill_algo_chapters(c, obj.product_id, obj.doc_type)
        if obj.doc_type == "md_014":
            self.__apply_md014_autofill(c, obj.product_id)
        title = doc_title(obj.doc_type)
        if obj.doc_type in CRR_DOC_TYPES:
            self.__export_crr_docx(output, obj, c)
            return title, "docx"
        if obj.doc_type in BUILD_DOC_TYPES:
            self.__export_build_docx(output, obj, c)
            return title, "docx"
        if obj.doc_type in TRAIN_DOC_TYPES:
            self.__export_train_docx(output, obj, c)
            return title, "docx"
        if obj.doc_type in TEST_DOC_TYPES:
            self.__export_test_xlsx(output, obj, c)
            return title, "xlsx"
        if obj.doc_type in PKG_DOC_TYPES:
            self.__export_pkg_xlsx(output, obj, c)
            return title, "xlsx"
        if doc_format(obj.doc_type) == "xlsx":
            self.__export_xlsx(output, obj, c)
            return title, "xlsx"
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

        def write_center_title(text, size=22.0, bold=False):
            p = document.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.first_line_indent = Pt(0)
            p.paragraph_format.left_indent = Pt(0)
            p.paragraph_format.right_indent = Pt(0)
            p.paragraph_format.line_spacing = 1.5
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            docx_util.fonted_txt(p, text, font_size=size, bold=bold)

        def add_blank_lines(count):
            for _ in range(max(0, int(count or 0))):
                document.add_paragraph("")

        def add_text(text):
            docx_util.save_txt2docx(str(text or ""), document)

        def png_wh(raw):
            if raw[:8] == b"\x89PNG\r\n\x1a\n" and len(raw) >= 24:
                return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
            return 0, 0

        def add_picture_fit(run, raw, max_w, max_h):
            w, h = png_wh(raw)
            if w > 0 and h > 0 and (h * max_w) > (w * max_h):
                run.add_picture(BytesIO(raw), height=Inches(max_h))
            else:
                run.add_picture(BytesIO(raw), width=Inches(max_w))

        def is_figure_grid(grid):
            cols = max((len(row) for row in grid if isinstance(row, list)), default=0)
            if cols != 1:
                return False
            return any(
                isinstance(row, list) and row and str(row[0] or "").startswith("data:image")
                for row in grid
            )

        def add_figure_grid(grid):
            for row in grid:
                val = str(row[0] if row else "")
                if val.startswith("data:image"):
                    try:
                        raw = base64.b64decode(val.split(",", 1)[1] if "," in val else "")
                        p = document.add_paragraph()
                        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        add_picture_fit(p.add_run(), raw, 5.5, 3.6)
                    except Exception:
                        logger.exception("md007_export_figure_failed")
                elif val.strip():
                    p = document.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    docx_util.fonted_txt(p, val, font_size=10.5)
            document.add_paragraph()

        def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT, figure=False):
            s = str(text or "")
            if s.startswith("data:image"):
                try:
                    raw = base64.b64decode(s.split(",", 1)[1] if "," in s else "")
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = align
                    if figure:
                        add_picture_fit(para.add_run(), raw, 4.2, 2.6)
                    else:
                        para.add_run().add_picture(BytesIO(raw), height=Pt(33))
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    return
                except Exception:
                    pass
            cell.text = ""
            lines = s.split("\n")
            for i, line in enumerate(lines):
                para = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
                para.alignment = align
                para.paragraph_format.line_spacing = 1.3
                docx_util.fonted_txt(para, line, font_size=10.5, bold=bold)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER if align == WD_ALIGN_PARAGRAPH.CENTER else WD_CELL_VERTICAL_ALIGNMENT.TOP

        def set_yesno(cell, mark):
            cell.text = ""
            yes = str(mark or "").strip() == "是"
            no = str(mark or "").strip() == "否"
            p1 = cell.paragraphs[0]
            p1.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r1 = p1.add_run(("\u2611\ufe0e" if yes else "\u2610") + " 是")
            r1.font.size = Pt(9)
            p2 = cell.add_paragraph()
            p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r2 = p2.add_run(("\u2610" if not no else "\u2611\ufe0e") + " 否")
            r2.font.size = Pt(9)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

        def add_env_check_grid(grid):
            kind = str(grid[0][1] if len(grid[0]) > 1 else "dev") or "dev"
            code = str(grid[0][2] if len(grid[0]) > 2 else "")
            doc_t = obj.doc_type or "md_019"
            leaves = self.__env_check_leaves(doc_t, kind)
            groups = ENV_CHECK_GROUPS.get((doc_t, kind), ENV_CHECK_GROUPS[("md_019", "dev")])
            ncols = len(leaves)
            if doc_t == "md_020":
                title_txt = "测试共用-%s检查表（%s）" % ("服务器" if kind == "server" else "测试机", code)
            else:
                title_txt = "开发共用-%s检查表（%s）" % ("服务器" if kind == "server" else "开发机", code)
            tb = document.add_table(rows=0, cols=ncols)
            tb.style = "Table Grid"
            tb.alignment = WD_TABLE_ALIGNMENT.CENTER
            trow = tb.add_row().cells
            tmerge = trow[0]
            for i in range(1, ncols):
                tmerge = tmerge.merge(trow[i])
            set_cell(tmerge, title_txt, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
            grow = tb.add_row().cells
            lrow = tb.add_row().cells
            ci = 0
            for gl, gleaves in groups:
                if gleaves:
                    gm = grow[ci]
                    for k in range(1, len(gleaves)):
                        gm = gm.merge(grow[ci + k])
                    set_cell(gm, gl, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
                    for k, lf in enumerate(gleaves):
                        set_cell(lrow[ci + k], lf, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
                    ci += len(gleaves)
                else:
                    vm = grow[ci].merge(lrow[ci])
                    set_cell(vm, gl, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
                    ci += 1
            for row in grid[1:]:
                cells = tb.add_row().cells
                j = 0
                for idx, col in enumerate(leaves):
                    t = col["type"]
                    if t == "date":
                        set_cell(cells[idx], str(row[0] if row else "").replace("- ", "-\n"), align=WD_ALIGN_PARAGRAPH.CENTER)
                    elif t == "check":
                        set_yesno(cells[idx], row[j + 1] if j + 1 < len(row) else "")
                        j += 1
                    elif t == "problem":
                        set_cell(cells[idx], row[j + 1] if j + 1 < len(row) else "", align=WD_ALIGN_PARAGRAPH.CENTER)
                    elif t == "checker":
                        set_cell(cells[idx], row[j + 2] if j + 2 < len(row) else "", align=WD_ALIGN_PARAGRAPH.CENTER)
            document.add_paragraph()

        def add_grid(grid):
            grid = [row for row in (grid or []) if isinstance(row, list)]
            if self.__is_env_check_grid(grid):
                add_env_check_grid(grid)
                return
            cols = max((len(row) for row in grid), default=0)
            if cols <= 0:
                return
            if is_figure_grid(grid):
                add_figure_grid(grid)
                return
            table = document.add_table(rows=0, cols=cols)
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            if self.__is_review_grid(grid):
                padded, origins = self.__grid_span_origins(grid)
                for _ in padded:
                    table.add_row()
                for r, c, rs, cs in origins:
                    cell = table.cell(r, c)
                    if rs > 1 or cs > 1:
                        cell = cell.merge(table.cell(r + rs - 1, c + cs - 1))
                    set_cell(cell, padded[r][c], bold=(r == 0))
            else:
                for r_idx, row in enumerate(grid):
                    cells = table.add_row().cells
                    left = str(row[0] if row else "")
                    for c_idx in range(cols):
                        set_cell(
                            cells[c_idx],
                            row[c_idx] if c_idx < len(row) else "",
                            bold=(r_idx == 0),
                            figure=("算法流程图" in left and c_idx > 0),
                        )
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

        def add_chapter_image(url, caption=""):
            s = str(url or "")
            if s.startswith("data:image"):
                try:
                    raw = base64.b64decode(s.split(",", 1)[1] if "," in s else "")
                    p = document.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    w, h = png_wh(raw)
                    inch_w = (w / 96.0) if w else 5.5
                    inch_h = (h / 96.0) if h else 3.6
                    if inch_w > 5.5 or inch_h > 3.6:
                        add_picture_fit(p.add_run(), raw, 5.5, 3.6)
                    else:
                        p.add_run().add_picture(BytesIO(raw), width=Inches(max(inch_w, 0.9)))
                except Exception:
                    logger.exception("export_chapter_image_failed")
            if str(caption or "").strip():
                cap = document.add_paragraph()
                cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                docx_util.fonted_txt(cap, str(caption), font_size=10.5)

        def render_body_section(node, level, number=""):
            name = self.__strip_num(node.get("title"))
            heading = f"{number} {name}".strip() if number else name
            add_body_heading(heading, level=max(1, min(level, 9)))
            blocks = split_body_blocks(node.get("body"), node.get("tables"), node.get("images"))
            if blocks:
                for b in blocks:
                    if b.get("type") == "text":
                        add_text(b.get("text"))
                    elif b.get("type") == "image":
                        add_chapter_image(b.get("url"), b.get("caption") or "")
                    elif b.get("type") == "table":
                        tb = b.get("table")
                        if tb is None:
                            t_i = b.get("tableIndex") or 0
                            tbs = node.get("tables") or []
                            tb = tbs[t_i] if t_i < len(tbs) else None
                        if tb:
                            add_grid(tb)
            else:
                if (node.get("body") or "").strip():
                    add_text(node.get("body"))
                for table in (node.get("tables") or []):
                    add_grid(table)
            idx = 0
            for child in (node.get("children") or []):
                idx += 1
                child_num = f"{number}.{idx}" if number else f"{idx}"
                render_body_section(child, level + 1, child_num)

        cover = next((s for s in sections if s.get("ref_type") == "cover"), None)
        revision = next((s for s in sections if s.get("ref_type") == "revision"), None)
        body = [s for s in sections if s.get("ref_type") not in ("cover", "revision")]
        title = (self.__strip_num(cover.get("title")) if cover else "") or doc_title(obj.doc_type)

        add_blank_lines(6)
        write_center_title(title, size=22.0, bold=True)
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
        if obj.doc_type in SKIP_ANNEX_NUM:
            idx = 0
            for node in body:
                t = self.__strip_num(node.get("title"))
                if node.get("ref_type") == "basic_info" or t == "产品信息":
                    render_body_section(node, 1, "")
                    continue
                if t.startswith("附件"):
                    render_body_section(node, 1, "")
                    continue
                idx += 1
                render_body_section(node, 1, str(idx))
        else:
            for i, node in enumerate(body):
                render_body_section(node, 1, str(i + 1))

        docx_util.fill_toc_cache(document)
        document.save(output)
        output.seek(0)
        return title, "docx"
