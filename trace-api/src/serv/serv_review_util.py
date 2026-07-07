#!/usr/bin/env python
# encoding: utf-8

# 「评审记录」章节共享工具：
#   - 各文档模块在正文末尾追加一个「评审记录」章节（内容模板化）。
#   - 评审时间从产品时间线按「文档名关键字 + 评审」自动获取，格式 yyyy.MM.dd。
#   - 提供导出 Word 时评审内容表/参评人员表的合并渲染（类别列纵向合并、整行横向合并）。
# 说明：内容取自各文档对应的《XXX 附：评审记录》模板；勾选统一用「■通过 □存在问题」。
#      选中标记用实心方块 ■(U+25A0)，与空心 □(U+25A1) 同族且非 emoji，避免 Word 渲染成彩色 emoji。

import re
import base64
from io import BytesIO

from sqlalchemy import select
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.project_timeline import ProjectTimelineRow, ProjectTimelineCell
from ..model.project_member import ProjectMember
from ..model.person_sign import PersonSign
from ..utils.sql_ctx import db

CHECK = "■通过 □存在问题"

# 各模块的评审记录模板：items 为 [类别, 评审项] 列表，persons 为参评人员 6 列行
REVIEW_DEFS = {
    "pha": {
        "name_keywords": ["初步危害分析", "危害分析"],
        "items": [
            ["初步危害分析清单", "是否按照ISO14971、GB/T 42062的附录识别了产品的安全特性"],
            ["初步危害分析清单", "已知或可预见的危险（源）是否识别？"],
            ["初步危害分析清单", "软件功能初步危害是否识别？"],
            ["初步危害分析清单", "模型相关初步危害是否识别？"],
            ["初步危害分析清单", "数据标注初步危害是否识别？"],
            ["初步危害分析清单", "网络安全初步危害是否识别？"],
            ["初步危害分析清单", "初步危害分析表是否可追溯？"],
        ],
        "conclusion": (
            "评审结论：\n通过，已经按照ISO14971、GB/T 42062的附录识别了产品的安全特性，"
            "已知或可预见的危险（源）已识别，网络安全初步危害已识别，初步危害分析表可追溯，"
            "产品的初步危害分析活动已完成。"
        ),
        "persons": [
            ["研发总监", "沈宏", "", "产品部经理", "夏晨", ""],
            ["开发负责人", "宁随军", "", "测试负责人", "王小敏", ""],
            ["RA", "张淑芳", "", "QA", "林金贵", ""],
            ["临床人员", "齐济", "", "产品经理", "杨静", ""],
            ["其他参评人员", "", "", "", "", ""],
            ["批准人员签字/日期", "", "", "", "", ""],
        ],
    },
    "pdp": {
        "name_keywords": ["产品开发计划", "开发计划"],
        "items": [
            ["产品简介", "是否包含产品介绍"],
            ["产品简介", "是否包含明确的产品描述"],
            ["产品简介", "是否明确产品开发周期"],
            ["产品简介", "是否明确产品经理"],
            ["资源", "是否明确每个部门的人员资源"],
            ["资源", "是否明确设计开发过程中的设备资源"],
            ["资源", "是否人员资源合理"],
            ["资源", "是否设备资源齐全"],
            ["计划及里程碑", "是否明确每个阶段任务划分和主要活动"],
            ["计划及里程碑", "是否明确每个阶段的责任部门"],
            ["计划及里程碑", "是否明确每个阶段的评审部门"],
            ["计划及里程碑", "是否明确每个阶段的完成时间"],
            ["计划及里程碑", "是否明确每个阶段的交付物"],
            ["计划及里程碑", "是否包含相关所有计划"],
            ["计划及里程碑", "是否各个阶段时间划分合理"],
        ],
        "conclusion": (
            "评审结论：\n通过，产品开发计划中包含了产品介绍、产品描述、产品开发周期，"
            "明确了每个部门的人员资源，明确了设计开发过程中的设备资源，人员资源安排合理，"
            "设备资源齐全，计划中明确了每个阶段任务划分和主要活动，明确了每个阶段的责任部门、"
            "评审部门、完成时间以及交付物，每个阶段时间划分合理。"
        ),
        "persons": [
            ["研发总监", "沈宏", "", "产品部经理", "夏晨", ""],
            ["产品开发部经理", "沈宏", "", "开发负责人", "宁随军", ""],
            ["产品经理", "杨静", "", "测试负责人", "王小敏", ""],
            ["QA", "林金贵", "", "临床人员", "齐济", ""],
            ["RA", "张淑芳", "", "", "", ""],
            ["其他参会人员", "", "", "", "", ""],
            ["批准人员签字/日期", "", "", "", "", ""],
        ],
    },
    "sd": {
        "name_keywords": ["软件开发计划", "开发计划"],
        "items": [
            ["文档完整程度", "项目定义清晰"],
            ["文档完整程度", "有明确且合理的时间计划"],
            ["文档完整程度", "明确人员要求"],
            ["文档完整程度", "明确开发要求"],
            ["文档完整程度", "明确设备资源要求"],
            ["文档完整程度", "符合设计开发流程"],
        ],
        "conclusion": (
            "评审结论：\n通过，项目定义清晰，明确合理的时间计划、人员要求、设备资源要求，"
            "设计开发流程符合要求。"
        ),
        "persons": [
            ["产品经理", "杨静", "", "产品开发部经理", "沈宏", ""],
            ["开发负责人", "宁随军", "", "QA", "林金贵", ""],
            ["其他参评人员", "", "", "", "", ""],
            ["批准人员签字/日期", "", "", "", "", ""],
        ],
    },
    "srs": {
        "name_keywords": ["需求规格说明", "需求规格"],
        "items": [
            ["风险、法规标准引用", "是否明确"],
            ["风险、法规标准引用", "是否合理"],
            ["风险、法规标准引用", "是否完整"],
            ["风险、法规标准引用", "是否符合法规"],
            ["风险、法规标准引用", "是否包含风险控制措施"],
            ["需求撰写", "需求设计前是否具备有效的调研"],
            ["需求撰写", "是否包含完整需求编号"],
            ["需求撰写", "是否包含需求背景及意义"],
            ["需求撰写", "需求撰写是否细化"],
            ["需求撰写", "是否具有一致性"],
            ["需求撰写", "任务是否可被具体拆分"],
            ["需求撰写", "是否考虑异常情况"],
            ["需求撰写", "语义是否清晰明确"],
            ["需求撰写", "是否考虑边界情况"],
            ["需求撰写", "是否满足《需求设计和操作规范》"],
        ],
        "conclusion": (
            "评审结论：\n通过。风险、法规标准引用明确合理，需求撰写内容完整清晰，满足规范要求."
        ),
        "persons": [
            ["研发总监", "沈宏", "", "产品部经理", "夏晨", ""],
            ["开发负责人", "宁随军", "", "测试负责人", "孙家旭", ""],
            ["QA", "林金贵", "", "RA", "杨冰", ""],
            ["临床人员", "齐济", "", "产品经理", "杨静", ""],
            ["其他参会人员", "", "", "", "", ""],
            ["批准人员签字/日期", "", "", "", "", ""],
        ],
    },
    "risk": {
        "name_keywords": ["风险管理报告", "风险管理"],
        "items": [
            ["风险管理报告", "产品定义是否明确？"],
            ["风险管理报告", "产品范围是否明确？"],
            ["风险管理报告", "风险管理固定的内容是否完成？"],
            ["风险管理报告", "风险可接受准则是否定义？"],
            ["风险管理报告", "与安全有关特征的问题是否识别？"],
            ["风险管理报告", "危险（源）是否识别？"],
            ["风险管理报告", "风险控制措施是否合理？"],
            ["风险管理报告", "剩余风险是否可以接受？"],
            ["风险管理报告", "风险控制措施是否引入新的风险？"],
            ["风险管理报告", "风险控制措施的引入是否影响以前识别的危险情况所估计的风险"],
            ["风险管理报告", "综合剩余风险是否合理？"],
            ["风险管理报告", "生产和生产后的风险管理活动是否定义？"],
        ],
        "conclusion": (
            "评审结论：\n通过，风险管理报告中产品定义和产品范围明确，风险可接受准则已定义，"
            "与安全有关特性的问题已识别，危险源已识别，风险控制措施合理，剩余风险可接受，"
            "综合剩余风险可接受，生产和生产后的风险管理活动已定义。"
        ),
        "persons": [
            ["研发总监", "沈宏", "", "产品部经理", "夏晨", ""],
            ["开发负责人", "宁随军", "", "测试负责人", "王小敏", ""],
            ["RA", "张淑芳", "", "QA", "林金贵", ""],
            ["临床人员", "齐济", "", "产品经理", "杨静", ""],
            ["其他参评人员", "/", "/", "/", "/", "/"],
            ["批准人员签字/日期", "", "", "", "", ""],
        ],
    },
}


# 「封面/评审」签署人按部门规则解析（编制人、审核人、批准人）。
#   ("member_role", 角色关键字)：从本产品参与人员中按角色关键字找到姓名，再取其签名；
#   ("name", 姓名)：固定姓名（公司层面固定签署人）。
#   规则来源（用户约定）：
#     - 产品文件：编制人=产品经理；审核/批准=产品总监(夏晨)
#     - 开发文件：编制人=TPM；审核/批准=研发负责人
#     - 测试文件：编制人=测试人员；审核/批准=研发负责人
DEPT_SIGNERS = {
    "product": {
        "编制人": ("member_role", "产品经理"),
        "审核人": ("name", "夏晨"),
        "批准人": ("name", "夏晨"),
    },
    "dev": {
        "编制人": ("member_role", "TPM"),
        "审核人": ("member_role", "研发负责人"),
        "批准人": ("member_role", "研发负责人"),
    },
    "test": {
        "编制人": ("member_role", "测试人员"),
        "审核人": ("member_role", "研发负责人"),
        "批准人": ("member_role", "研发负责人"),
    },
}
DEFAULT_DEPT = "product"

# 各文档模块所属部门（决定封面/评审签署人规则）。如需调整只改此表即可。
DOC_DEPT = {
    # 产品线文件：编制人=产品经理，审核/批准=产品总监(夏晨)
    "pdp": "product", "pir": "product", "label": "product",
    "release_note": "product", "vuh": "product",
    "risk": "product", "rmp": "product", "pha": "product",
    # 开发文件：编制人=TPM，审核/批准=研发负责人
    "sd": "dev", "srs": "dev", "sds": "dev", "cybersec": "dev",
    "nsmp": "dev", "nsr": "dev", "research": "dev",
}


def _before_202509(rev_date):
    """判断评审/文档日期是否在 2025 年 9 月之前（用于测试人员签名统一取宋月的规则）。"""
    m = re.match(r"(\d{4})\D+(\d{1,2})", str(rev_date or ""))
    if not m:
        return False
    return int(m.group(1)) * 100 + int(m.group(2)) < 202509


def review_date(prod_id, name_keywords):
    """从时间线取评审日期（命中「文档名关键字」且优先命中「评审」的行，取最新），格式 yyyy.MM.dd。"""
    if not prod_id:
        return ""

    def to_int(v):
        digits = re.sub(r"[^\d]", "", str(v or ""))
        return int(digits) if digits else None

    tl_rows = db.session.execute(
        select(ProjectTimelineRow).where(ProjectTimelineRow.prod_id == prod_id)
    ).scalars().all()
    if not tl_rows:
        return ""
    cell_map = {}
    for c in db.session.execute(
        select(ProjectTimelineCell).where(ProjectTimelineCell.row_id.in_([r.id for r in tl_rows]))
    ).scalars().all():
        cell_map.setdefault(c.row_id, []).append(c.output_result or "")
    date_rows = [r for r in tl_rows if (r.row_type or "date") == "date" and to_int(r.year) and to_int(r.month)]

    def date_key(r):
        return to_int(r.year) * 10000 + to_int(r.month) * 100 + (to_int(r.day) or 0)

    def match(r, need_review):
        vals = cell_map.get(r.id, [])
        hit_name = any(any(k in str(v or "") for k in name_keywords) for v in vals)
        hit_review = any("评审" in str(v or "") for v in vals)
        return hit_name and (hit_review if need_review else True)

    rows = [r for r in date_rows if match(r, True)] or [r for r in date_rows if match(r, False)]
    if not rows:
        return ""
    r = max(rows, key=date_key)
    return f"{to_int(r.year)}.{to_int(r.month):02d}.{(to_int(r.day) or 1):02d}"


# 各文档「封面日期」取值用的时间线关键字（供 review_date 使用）。
# 规则：编制/审核/批准日期 + 生效日期 统一取该文档在时间线里评审/最后一天的日期。
COVER_KEYWORDS = {
    "sd": ["软件开发计划", "开发计划"],
    "pdp": ["产品开发计划", "开发计划"],
    "cybersec": ["网络安全风险管理报告", "网络安全风险管理", "风险管理报告"],
    "risk": ["风险管理报告", "风险管理"],
    "rmp": ["风险管理计划"],
    "pha": ["初步危害分析", "危害分析"],
    "srs": ["需求规格说明", "需求规格"],
    "sds": ["软件详细设计", "详细设计"],
    "pir": ["产品立项报告", "立项报告"],
    "label": ["产品标签样稿", "标签"],
    "vuh": ["版本更新历史"],
    "nsmp": ["网络安全维护计划", "维护计划"],
    "release_note": ["产品发布说明", "发布说明"],
    "nsr": ["自研软件网络安全研究报告", "网络安全研究报告"],
    "research": ["自研软件研究报告", "软件研究报告"],
}


def fill_cover_dates(content, rev_date):
    """统一填充封面表日期（仅填空，不覆盖已填）：
      - 「编制人/审核人/批准人」行的「日期」列(第4列, index 3) 填 rev_date；
      - 「生效日期」行的值(第2列, index 1) 填 rev_date。
    rev_date 为该文档在时间线里的评审/最后一天日期（见 review_date）。
    通用实现：扫描所有 section 的所有表格，按行首标签匹配，兼容各模块封面结构。"""
    if not rev_date or not isinstance(content, dict):
        return content
    for section in (content.get("sections") or []):
        if not isinstance(section, dict):
            continue
        for table in (section.get("tables") or []):
            if not isinstance(table, list):
                continue
            for row in table:
                if not isinstance(row, list) or not row:
                    continue
                label = str(row[0] or "").strip()
                if label in ("编制人", "审核人", "批准人"):
                    if len(row) >= 4 and not str(row[3] or "").strip():
                        row[3] = rev_date
                elif label == "生效日期":
                    if len(row) >= 2 and not str(row[1] or "").strip():
                        row[1] = rev_date
    return content


def cover_date(prod_id, key):
    """按模块 key 取封面日期（复用 review_date + COVER_KEYWORDS）。"""
    kws = COVER_KEYWORDS.get(key)
    if not prod_id or not kws:
        return ""
    return review_date(prod_id, kws)


def _sign_by_name(name):
    """按姓名从「人员签名管理(person_sign)」取签名图（sign_img，data URL）。"""
    name = (name or "").strip()
    if not name:
        return ""
    row = db.session.execute(
        select(PersonSign).where(PersonSign.name == name)
    ).scalars().first()
    return (getattr(row, "sign_img", "") or "") if row else ""


# 个别模块如需覆盖部门默认规则，可在此登记 key -> {label:(kind,arg)}；留空则一律按部门规则。
COVER_SIGNERS = {}


def _signer_config(key):
    """返回某模块的签署人配置（优先 COVER_SIGNERS 覆盖，否则按部门 DEPT_SIGNERS）。"""
    if key in COVER_SIGNERS:
        return COVER_SIGNERS[key]
    return DEPT_SIGNERS.get(DOC_DEPT.get(key, DEFAULT_DEPT), {})


def _resolve_signer_name(spec, members, rev_date=""):
    """按签署人规则解析姓名。测试人员在 2025.09 之前统一取宋月。"""
    kind, arg = spec
    if kind == "name":
        return arg
    # member_role：测试人员在 2025.09 之前统一为宋月
    if ("测试" in str(arg)) and _before_202509(rev_date):
        return "宋月"
    return next((m.name for m in members if arg in str(m.role or "")), "")


def cover_signers(prod_id, key="pdp", rev_date=""):
    """按模块 key 返回封面「编制人/审核人/批准人」应填的签名图 data URL 字典（无图则回退姓名）。
    rev_date 缺省时自动按模块取评审/最后日期（用于测试人员宋月规则）。"""
    cfg = _signer_config(key)
    signers = {}
    if not prod_id or not cfg:
        return signers
    if not rev_date:
        rev_date = cover_date(prod_id, key)
    members = db.session.execute(
        select(ProjectMember).where(ProjectMember.prod_id == prod_id)
    ).scalars().all()
    for label, spec in cfg.items():
        name = (_resolve_signer_name(spec, members, rev_date) or "").strip()
        if not name:
            continue
        # 有签名图就放图；没有签名图则回退显示姓名文字（保证签署人不为空）
        signers[label] = _sign_by_name(name) or name
    return signers


def review_approver(key, prod_id=None, rev_date=""):
    """评审记录「批准人」姓名：按部门规则解析（产品=夏晨；开发/测试=研发负责人）。"""
    spec = _signer_config(key).get("批准人")
    if not spec:
        return ""
    if spec[0] == "name":
        return spec[1]
    if not prod_id:
        return ""
    members = db.session.execute(
        select(ProjectMember).where(ProjectMember.prod_id == prod_id)
    ).scalars().all()
    return _resolve_signer_name(spec, members, rev_date) or ""


def fill_cover_signers(content, signers):
    """把封面「编制人/审核人/批准人」行的姓名列(第2列, index 1) 填成签名图 data URL（仅填空，不覆盖已填）。
    通用实现：扫描所有 section 的所有表格，按行首标签匹配，兼容各模块封面结构。"""
    if not signers or not isinstance(content, dict):
        return content
    for section in (content.get("sections") or []):
        if not isinstance(section, dict):
            continue
        for table in (section.get("tables") or []):
            if not isinstance(table, list):
                continue
            for row in table:
                if not isinstance(row, list) or not row:
                    continue
                label = str(row[0] or "").strip()
                # 覆盖空值或旧姓名文本；已是签名图则保留（避免重复覆盖用户已放的图）
                if label in signers and len(row) >= 2 and not str(row[1] or "").startswith("data:image"):
                    row[1] = signers[label]
    return content


# 整行横向合并的行首标记（这些行内容跨满整行）
_BANNERS = ("参评人员签字", "评审时间", "评审结论", "批准人员签字")


def _is_banner(text):
    t = str(text or "")
    return any(t.startswith(b) for b in _BANNERS)


def _is_other_row(text):
    """「其他参会人员/其他参评人员」行：标签后单元格合并为一格并填 /。"""
    t = str(text or "").strip()
    return t.startswith("其他参会人员") or t.startswith("其他参评人员")


def build_review_section(key, rev_date="", prod_id=None):
    d = REVIEW_DEFS.get(key)
    if not d:
        return None
    # 评审内容表：类别仅在每段首行保留，其余留空（合并前的自然形态，编辑页不重复）
    content_tbl = [["评审内容", "评审项", "评审结论"]]
    prev_cat = None
    for cat, q in d["items"]:
        content_tbl.append(["" if cat == prev_cat else cat, q, CHECK])
        prev_cat = cat
    content_tbl.append([d["conclusion"], "", ""])
    # 参评人员表：整行标记行只在首格保留文字
    person_tbl = [
        ["参评人员签字", "", "", "", "", ""],
        [f"评审时间：{rev_date}", "", "", "", "", ""],
        ["人员角色", "姓名", "签字", "人员角色", "姓名", "签字"],
    ] + [list(r) for r in d["persons"]]
    # 「签字」列按「姓名」列自动取签名图（第2列姓名→第3列签字；第5列姓名→第6列签字），仅填空
    old_test = _before_202509(rev_date)
    for row in person_tbl[3:]:
        if not isinstance(row, list) or _is_banner(str(row[0] or "")):
            continue
        # 测试角色：2025.09 之前签名人统一为宋月
        if old_test:
            if "测试" in str(row[0] or "") and len(row) >= 2:
                row[1] = "宋月"
            if "测试" in str(row[3] or "") and len(row) >= 5:
                row[4] = "宋月"
        if len(row) >= 3 and str(row[1] or "").strip() and not str(row[2] or "").strip():
            row[2] = _sign_by_name(str(row[1]).strip())
        if len(row) >= 6 and str(row[4] or "").strip() and not str(row[5] or "").strip():
            row[5] = _sign_by_name(str(row[4]).strip())
    # 「批准人员签字/日期」行：自动填批准人签名图(第2列，无图回退姓名) 与评审日期(第3列)
    approver = review_approver(key, prod_id, rev_date)
    for row in person_tbl:
        if isinstance(row, list) and row and str(row[0] or "").startswith("批准人员签字"):
            if approver and len(row) >= 2 and not str(row[1] or "").strip():
                row[1] = _sign_by_name(approver) or approver
            if len(row) >= 3 and not str(row[2] or "").strip():
                row[2] = rev_date
            break
    # 「其他参会人员/其他参评人员」行：标签后单元格合并为一格并填 /
    for row in person_tbl:
        if isinstance(row, list) and row and _is_other_row(row[0]):
            for i in range(1, len(row)):
                row[i] = ""
            if len(row) >= 2:
                row[1] = "/"
            break
    return {
        "title": "评审记录",
        "ref_type": "review",
        "body": "",
        "tables": [content_tbl, person_tbl],
        "children": [],
    }


def autofill_review_person_table(tbl, key="", rev_date="", prod_id=None):
    """对「已存在的参评人员签字表」就地自动填充（用于评审记录内置于默认内容、不经 build_review_section 的模块，如 rmp）：
      - 「签字」列按「姓名」列取签名图（仅填空）；测试角色 2025.09 前统一取宋月；
      - 「批准人员签字/日期」行填批准人签名(按部门) + 评审日期；
      - 「其他参评人员/其他参会人员」行标签后合并为一格并填 /。
    仅处理含「参评人员签字」标记的人员表，避免误伤评审内容表。"""
    if not isinstance(tbl, list):
        return tbl
    if not any(isinstance(r, list) and r and str(r[0] or "").startswith("参评人员签字") for r in tbl):
        return tbl
    passed_date = bool(rev_date)
    # 评审日期缺省时，取表内「评审时间」行已有的日期
    if not rev_date:
        for row in tbl:
            if isinstance(row, list) and row and str(row[0] or "").startswith("评审时间"):
                parts = str(row[0]).split("：", 1)
                if len(parts) > 1:
                    rev_date = parts[1].strip()
                break
    old_test = _before_202509(rev_date)
    approver = review_approver(key, prod_id, rev_date) if key else ""
    for row in tbl:
        if not isinstance(row, list) or not row:
            continue
        lab = str(row[0] or "").strip()
        if lab.startswith("评审时间"):
            if passed_date and rev_date:
                row[0] = f"评审时间：{rev_date}"
            continue
        if lab.startswith("批准人员签字"):
            if approver and len(row) >= 2 and not str(row[1] or "").strip():
                row[1] = _sign_by_name(approver) or approver
            if len(row) >= 3 and not str(row[2] or "").strip():
                row[2] = rev_date
            continue
        if _is_banner(lab) or lab == "人员角色":
            continue
        if _is_other_row(lab):
            for i in range(1, len(row)):
                row[i] = ""
            if len(row) >= 2:
                row[1] = "/"
            continue
        # 参评人员数据行：测试角色宋月 + 签字列取签名图
        if old_test:
            if "测试" in lab and len(row) >= 2:
                row[1] = "宋月"
            if len(row) >= 4 and "测试" in str(row[3] or ""):
                row[4] = "宋月"
        if len(row) >= 3 and str(row[1] or "").strip() and not str(row[2] or "").strip():
            row[2] = _sign_by_name(str(row[1]).strip())
        if len(row) >= 6 and str(row[4] or "").strip() and not str(row[5] or "").strip():
            row[5] = _sign_by_name(str(row[4]).strip())
    return tbl


def ensure_review(content, key, rev_date="", prod_id=None):
    """在 content.sections 末尾放置「评审记录」章节。内容为模板化，每次按最新格式重建，
    保证样式一致并带最新评审时间（同时清理历史遗留的旧格式）。"""
    sections = (content or {}).get("sections")
    if not isinstance(sections, list):
        return content
    sec = build_review_section(key, rev_date, prod_id)
    if not sec:
        return content
    sections[:] = [s for s in sections if s.get("ref_type") != "review"]
    sections.append(sec)
    return content


def render_review_grid(document, grid, set_cell, header_rows=1, **_ignore):
    """评审表渲染：整行标记行横向合并；首列非空单元格纵向合并其后的空单元格。
    set_cell 由各模块传入以保持字体一致，签名 set_cell(cell, text, bold=False, align=...)。"""
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
            val = row[c_idx] if c_idx < len(row) else ""
            s = str(val or "")
            if s.startswith("data:image"):
                # 签字列签名图：等比缩放渲染，不变形
                try:
                    b64 = s.split(",", 1)[1] if "," in s else ""
                    pic = base64.b64decode(b64)
                    cell = cells[c_idx]
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    para.add_run().add_picture(BytesIO(pic), height=Pt(28))
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    continue
                except Exception:
                    pass
            set_cell(cells[c_idx], val, bold=(r_idx < header_rows))
    rows = table.rows
    n = len(rows)
    # 整行标记行横向合并
    for r in range(n):
        first = rows[r].cells[0].text
        if _is_banner(first) and len(rows[r].cells) > 1:
            merged = rows[r].cells[0].merge(rows[r].cells[-1])
            if first.startswith("批准人员签字"):
                # 批准人签字行：左对齐，渲染「标签 + 批准人签名图/姓名 + 日期」
                gr = grid[r] if r < len(grid) else []
                sign = str(gr[1] or "") if len(gr) > 1 else ""
                date = str(gr[2] or "") if len(gr) > 2 else ""
                label = first if first.rstrip().endswith("：") else first + "："
                set_cell(merged, label, bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
                para = merged.paragraphs[0]
                if sign.startswith("data:image"):
                    try:
                        b64 = sign.split(",", 1)[1] if "," in sign else ""
                        para.add_run("  ")
                        para.add_run().add_picture(BytesIO(base64.b64decode(b64)), height=Pt(28))
                    except Exception:
                        pass
                elif sign.strip():
                    rn = para.add_run("  " + sign)
                    rn.font.size = Pt(10.5)
                if date.strip():
                    rd = para.add_run("      " + date)
                    rd.font.size = Pt(10.5)
                merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            else:
                set_cell(merged, first, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    # 「其他参会人员/其他参评人员」行：标签后单元格合并为一格，居中显示「/」
    for r in range(n):
        first = rows[r].cells[0].text
        if _is_other_row(first) and len(rows[r].cells) > 2:
            merged = rows[r].cells[1].merge(rows[r].cells[-1])
            set_cell(merged, "/", align=WD_ALIGN_PARAGRAPH.CENTER)
            merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    # 首列纵向合并：非空且非标记的单元格向下合并其后的空单元格
    r = 0
    while r < n:
        text = rows[r].cells[0].text
        if text.strip() and not _is_banner(text):
            r2 = r
            while r2 + 1 < n and not rows[r2 + 1].cells[0].text.strip():
                r2 += 1
            if r2 > r:
                merged = rows[r].cells[0].merge(rows[r2].cells[0])
                set_cell(merged, text, align=WD_ALIGN_PARAGRAPH.CENTER)
                merged.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            r = r2 + 1
        else:
            r += 1
    document.add_paragraph()
