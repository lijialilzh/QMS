#!/usr/bin/env python
# encoding: utf-8

# 「评审记录」章节共享工具：
#   - 各文档模块在正文末尾追加一个「评审记录」章节（内容模板化）。
#   - 评审时间从产品时间线按「文档名关键字 + 评审」自动获取，格式 yyyy.MM.dd。
#   - 提供导出 Word 时评审内容表/参评人员表的合并渲染（类别列纵向合并、整行横向合并）。
# 说明：内容取自各文档对应的《XXX 附：评审记录》模板；勾选统一用「■通过 □存在问题」。
#      选中标记用实心方块 ■(U+25A0)，与空心 □(U+25A1) 同族且非 emoji，避免 Word 渲染成彩色 emoji。

import re

from sqlalchemy import select
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT

from ..model.project_timeline import ProjectTimelineRow, ProjectTimelineCell
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


# 整行横向合并的行首标记（这些行内容跨满整行）
_BANNERS = ("参评人员签字", "评审时间", "评审结论", "批准人员签字")


def _is_banner(text):
    t = str(text or "")
    return any(t.startswith(b) for b in _BANNERS)


def build_review_section(key, rev_date=""):
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
    return {
        "title": "评审记录",
        "ref_type": "review",
        "body": "",
        "tables": [content_tbl, person_tbl],
        "children": [],
    }


def ensure_review(content, key, rev_date=""):
    """在 content.sections 末尾放置「评审记录」章节。内容为模板化，每次按最新格式重建，
    保证样式一致并带最新评审时间（同时清理历史遗留的旧格式）。"""
    sections = (content or {}).get("sections")
    if not isinstance(sections, list):
        return content
    sec = build_review_section(key, rev_date)
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
            set_cell(cells[c_idx], row[c_idx] if c_idx < len(row) else "", bold=(r_idx < header_rows))
    rows = table.rows
    n = len(rows)
    # 整行标记行横向合并
    for r in range(n):
        first = rows[r].cells[0].text
        if _is_banner(first) and len(rows[r].cells) > 1:
            merged = rows[r].cells[0].merge(rows[r].cells[-1])
            set_cell(merged, first, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
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
