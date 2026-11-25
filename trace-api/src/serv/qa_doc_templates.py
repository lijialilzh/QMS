#!/usr/bin/env python
# encoding: utf-8

# 质量文件四类模板。详见 docs/function_docs/105_质量文件管理.md。

import copy
import re

KINDS = {
    "output_review": "设计开发输出评审",
    "inspect_spec": "成品检验规程",
    "inspect_record": "成品检验记录",
    "change_close": "变更评估及关闭表",
}


def split_models(type_code):
    out = []
    for part in re.split(r"[、,，;；\n]+", str(type_code or "")):
        name = part.strip()
        if name and name not in out:
            out.append(name)
    return out


def _sec(title, body="", tables=None):
    return {"title": title, "body": body or "", "tables": tables or [], "children": []}


def _mark_rows(items):
    return [[item, "□"] for item in items]


_OUTPUT_KEYWORDS = ["设计开发输出评审", "设计开发输出"]


def _output_review_date(product, version=""):
    """时间线输出含「设计开发输出」的评审日，格式 yyyy.MM.dd。当前版本没有时用同名产品其它版本。"""
    from .serv_review_util import review_date, timeline_rows_with_sibling

    prod_id = getattr(product, "id", None) if product is not None else None
    if not prod_id:
        return ""
    return review_date(
        prod_id, _OUTPUT_KEYWORDS, timeline_rows_with_sibling(prod_id), version=version,
    ) or ""


def _pass_unchecked(text):
    """还是默认空框「□通过 □存在问题」。已经勾了通过或存在问题的不改。"""
    value = str(text or "").strip()
    if "通过" not in value or "存在问题" not in value:
        return False
    before_pass, after_pass = value.split("通过", 1)
    marks = ("☑", "✓", "✔", "■", "\u2611", "\u00fe")
    if any(mark in before_pass for mark in marks):
        return False
    before_issue = after_pass.split("存在问题", 1)[0] if "存在问题" in after_pass else ""
    return not any(mark in before_issue for mark in marks)


def _apply_output_review_defaults(content, product, version=""):
    """通过默认勾选。评审时间取到就写入，没取到不改已有日期。"""
    from .serv_review_util import CHECK

    date = _output_review_date(product, version)
    for section in content.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for table in section.get("tables") or []:
            if not isinstance(table, list):
                continue
            for row in table:
                if not isinstance(row, list) or not row:
                    continue
                label = str(row[0] or "").strip()
                if date and label.startswith("评审时间"):
                    row[0] = f"评审时间：{date}"
                    for index in range(1, len(row)):
                        row[index] = ""
                elif len(row) >= 3 and _pass_unchecked(row[2]) and not label.startswith("评审结论"):
                    row[2] = CHECK
    return content


def output_review_content(product=None, version=""):
    """《评审记录（设计开发输出）》：评审内容表 + 参评人员签字表。通过默认勾选，评审时间按时间线获取。"""
    from .serv_review_util import build_review_section

    prod_id = getattr(product, "id", None) if product is not None else None
    built = build_review_section("qa_output", _output_review_date(product, version), prod_id) or {}
    tables = built.get("tables") or []
    for table in tables:
        if not table or not isinstance(table[0], list):
            continue
        if str(table[0][0] or "").strip() != "评审内容":
            continue
        # 表头后两列同文，导出和页面合并成「评审结论」
        table[0] = ["评审内容", "评审结论", "评审结论"]
    return {"sections": [_sec("设计开发输出评审", tables=tables)]}


def ensure_output_review(content, product, version=""):
    """旧的两列表还不是评审记录结构时，打开和导出换成模板。已经是评审记录的保留手改，只补勾选和评审时间。"""
    content = content if isinstance(content, dict) else {"sections": []}
    tables = []
    for section in content.get("sections") or []:
        if isinstance(section, dict):
            tables.extend(section.get("tables") or [])
    shaped = any(
        isinstance(table, list) and table and isinstance(table[0], list)
        and str(table[0][0] or "").startswith("参评人员签字")
        for table in tables
    )
    if not shaped:
        content = output_review_content(product, version)
    return _apply_output_review_defaults(content, product, version)


def _output_review():
    return output_review_content(None)


def _inspect_spec():
    clauses = [
        "2.1.1.1登录", "2.1.1.2平台管理", "2.1.1.3图像工作站-阅片",
        "2.1.1.4图像工作站-三维重建", "2.1.1.5图像工作站-冠脉列表",
        "2.1.1.6图像工作站-血管分析", "2.1.1.7图像工作站-斑块分析",
        "2.1.1.8图像工作站-血管编辑", "2.1.1.9图像工作站-报告",
        "2.1.1.10图像工作站-推送打印", "2.1.2使用限制", "2.1.3输入输出",
        "2.1.4接口", "2.1.5必备软硬件", "2.1.6运行环境", "2.1.7性能效率",
        "2.1.8最大并发数", "2.1.9用户界面", "2.1.10消息", "2.1.11用户差错防御",
        "2.1.12用户访问控制", "2.1.13版权保护", "2.1.14可靠性", "2.1.15维护性",
    ]
    return {"sections": [
        _sec("成品检验规程", tables=[[
            ["使用部门", "质量部", "版本号", "A0"],
            ["编制人", "", "日期", ""],
            ["审核人", "", "日期", ""],
            ["批准人", "", "日期", ""],
            ["生效日期", "", "", ""],
        ]]),
        _sec("文件修订记录", tables=[[
            ["修改日期", "版本号", "修订说明", "修订人", "批准人"],
            ["", "", "初始版本", "", ""],
        ]]),
        _sec("目的", "规范产品检验项目及要求，确保出厂的产品质量合格。"),
        _sec("适用范围", "规格型号划分说明按版本管理中的产品型号填写。交付形式：物理交付。存储媒介：U盘。", tables=[
            [
                ["产品名称", ""],
                ["完整版本", ""],
                ["发布版本", ""],
            ],
            [["型号", "描述"], ["", ""]],
        ]),
        _sec("依据文件", _BASIS_BODY),
        _sec("检验条件", "成品检验需要1台服务器、1台用户端电脑、1个条码检测仪。", tables=[
            [
                ["配置", "要求"],
                ["CPU", "英特尔酷睿i9处理器及以上"],
                ["内存", "容量至少64GB。"],
                ["GPU", "英伟达RTX 4000及以上"],
                ["硬盘", "具有SATA口的系统盘以及存储盘。系统盘选择容量至少为250GB的固态硬盘。存储盘容量至少为3T。"],
                ["网卡", "千兆PCI-E网卡（支持Linux系统）"],
            ],
            [["服务器软件环境", "Ubuntu 18.04 LTS（64位）"]],
            [
                ["配置", "要求"],
                ["CPU", "英特尔酷睿 i5 及以上"],
                ["内存", "至少16GB"],
                ["显示器分辨率", "1920*1080"],
                ["操作系统", "Windows10 专业版（64位）及兼容版本"],
                ["浏览器", "Chrome 73.0及兼容版本"],
            ],
            [["网络类型", "局域网"], ["带宽", "100Mbps及以上"]],
        ]),
        _sec("外观", "外包装：目测，完整无损。\n外部标记：目测，清晰完整。"),
        _sec("标签", "检验方法：目测。标签内容打印清晰容易识别，粘贴方正、牢固。", tables=[
            [
                ["内容", "要求"],
                ["产品名称", ""],
                ["产品型号", ""],
                ["完整版本", ""],
                ["发布版本", ""],
                ["条形码打印质量", "≥0.5"],
                ["成品序列号", "序列号要与请验单一致"],
                ["产品注册证号", ""],
                ["生产日期", "生产日期要与请验单一致"],
                ["使用期限", ""],
                ["注册人", ""],
                ["住所", ""],
                ["生产企业", ""],
                ["生产地址", ""],
                ["联系电话", ""],
            ],
            [["规格、型号", "UDI"], ["", ""]],
        ]),
        _sec("说明书", tables=[[
            ["内容", "要求"],
            ["文件名称", ""],
            ["产品名称", ""],
            ["型号规格", ""],
            ["发布版本", ""],
            ["说明书发布日期", ""],
            ["说明书内容", "完整、无缺页"],
        ]]),
        _sec("软件技术要求", "将产品载体交付物插在服务器上，将安装包拷贝至服务器本地硬盘后检验。完成后删除本地安装包并退出载体。", tables=[
            [
                ["测试目的（条款及要求）", "是否检验", "判定标准", "检验方法"],
                ["验证软件是否能正常安装", "是", "正常安装", "需要输入分配的安装包密钥，才可解压安装包并可按照《安装维护手册》安装。"],
                ["验证软件版本信息是否正确", "是", "", "在软件界面的“关于”可识别软件的发布版本和完整版本"],
                ["验证软件是否能正常卸载", "是", "正常卸载", "按照《安装维护手册》可卸载。"],
            ],
            [["测试目的（条款及要求）", "是否检验", "判定标准", "检验方法"]] + [[name, "是", "", ""] for name in clauses],
        ]),
        _sec("记录", "检验记录见《成品检验记录》。"),
    ]}


_JUDGE = "□合格\n□不合格"


def _inspect_record():
    return {"sections": [_sec("成品检验记录", tables=[[
        ["产品名称", "", "型号规格", ""],
        ["完整版本号", "", "序列号", ""],
        ["生产日期", "", "请验日期", ""],
        ["检验设备信息：", "<", "<", "<"],
        ["检验依据：", "<", "<", "<"],
        ["检验项目", "检验标准", "检验结果", "判定"],
        ["外观", "外包装完整无损，外部标记清晰完整", "", _JUDGE],
        ["标签内容", "产品和公司信息正确，注册或认证信息正确，标签内容打印清晰容易识别，粘贴方正、牢固", "", _JUDGE],
        ["^", "□条形码打印质量≥0.5（如适用）", "", _JUDGE],
        ["电子说明书内容", "与备案说明书文件编号、版本、内容一致，完整无缺页", "", _JUDGE],
        ["软件技术要求", "安装包MD5码：", "", _JUDGE],
        ["安装卸载", "可正常安装和卸载", "", _JUDGE],
        ["版本号识别", "完整版本：\n发布版本：", "", _JUDGE],
        ["检验结论", _JUDGE, "<", "<"],
        ["不良状况记录", "", "<", "<"],
        ["备注", "", "<", "<"],
        ["检验人员/日期：", "", "审核人员/日期：", ""],
    ]])]}


def _pair_rows(left_title, left_items, right_title, right_items):
    rows = []
    count = max(len(left_items), len(right_items))
    for index in range(count):
        left = left_items[index] if index < len(left_items) else ""
        right = right_items[index] if index < len(right_items) else ""
        rows.append([
            left_title if index == 0 else "^",
            "□" if left else "",
            left,
            right_title if index == 0 else "^",
            "□" if right else "",
            right,
        ])
    return rows


def _change_close():
    law = ["涉及重新送检的变更", "涉及重新临床评价的变更", "目标市场", "产品名变更", "涉及注册资料变更", "其它："]
    pack = ["包装材料的结构/材质/尺寸/供方", "包装方式", "包装功能/性能", "包装外观图案颜色", "说明书/标签内容（包括内容变更与纠错）", "其它："]
    design = ["增加规格或型号", "产品的预期用途、适应证、禁忌症", "产品的功能/性能", "产品结构", "核心算法", "网络环境"]
    qc = ["增减检验文件", "变更或增减测试项目、方法、接受标准、样本要求等", "增减文件适用范围", "检验项目增减", "抽样方案或样本要求的变更", "检验/测试方法变更（参数类）"]
    impact = [
        "申请是否为安全问题",
        "申请是否为强制性法规标准问题",
        "技术是否可行：产品开发",
        "技术是否可行：模型、数据",
        "变更是否会影响产品其他组成部分和已交付产品的正常使用",
        "变更是否影响已交付手册的正常使用",
        "变更是否影响产品的预期用途",
        "变更是否符合医疗器械产品注册的有关规定",
        "变更是否会引起注册变更",
        "变更是否影响产品已经做过的临床试验、临床评价等工作",
        "变更是否需要告知用户",
        "升级或更换已交付产品/手册是否可行",
    ]
    actions = [
        ("风险分析评估", "变更是否对产品风险产生影响"),
        ("需求分析与设计", "产品需求"),
        ("需求分析与设计", "数据采集需求"),
        ("数据采集及处理", "数据脱敏检查、数据清洗"),
        ("数据采集及处理", "数据标注、数据上传"),
        ("数据采集及处理", "数据库统计与维护"),
        ("数据采集及处理", "人员培训与考核"),
        ("模型设计", "算法和模型网络结构设计"),
        ("模型开发和测试", "数据集构建"),
        ("模型开发和测试", "标记需求制定"),
        ("模型开发和测试", "模型开发"),
        ("模型开发和测试", "模型训练"),
        ("模型开发和测试", "模型测试"),
        ("产品开发", "产品设计"),
        ("产品开发", "产品开发"),
        ("验证与确认", "软件测试"),
        ("验证与确认", "产品验收"),
        ("验证与确认", "用户测试"),
        ("验证与确认", "可用性测试"),
        ("验证与确认", "临床试验/临床评价"),
        ("可追溯性分析", "可追溯性分析活动"),
        ("配置管理活动", "配置管理活动"),
        ("配置管理活动", "配置管理工具"),
        ("工具确认", "开发/测试/标注/工具确认"),
        ("工具确认", "其他工具确认"),
        ("用户说明书", "用户说明书"),
        ("DHF", "DHF文件"),
        ("产品发布", "产品发布"),
        ("其他", "其他活动"),
    ]
    dmr = [
        "产品技术要求", "用户说明书", "采购要求及产品BOM", "安装维护手册",
        "现场测试记录", "现场测试规程", "生产作业指导书", "产品包装标签样稿", "生产工艺流程图",
        "进货检验作业指导书", "成品检验规程", "成品检验作业指导书", "产品发布说明", "其它DMR文件或记录单",
    ]
    action_rows = [["设计开发阶段", "设计开发活动", "变更描述（将变更后的行动/文件在此进行记录）"]]
    prev_stage = None
    for stage, activity in actions:
        action_rows.append([stage if stage != prev_stage else "^", activity, "文件号："])
        prev_stage = stage
    yn = "□是　□否"
    ynn = "□是　□否　□不适用"
    yes_no = {"申请是否为安全问题": yn, "申请是否为强制性法规标准问题": yn, "变更是否会引起注册变更": yn}
    return {"sections": [_sec("变更评估及关闭表", tables=[
        [
            ["ECR号", "", "产品名称", ""],
            ["产品型号", "", "产品版本", ""],
        ],
        [
            ["评审人", "<", "<", "<", "<"],
            ["申请人", "申请部门负责人", "研发部负责人", "质量部负责人", "生产部负责人"],
            ["", "", "", "", ""],
            ["变更负责人", "QA", "研发工程师", "研发工程师", "其他"],
            ["", "", "", "", ""],
            ["评审时间", "", "<", "<", "<"],
            ["批准人", "", "<", "批准时间", ""],
        ],
        [["变更内容描述", "<", "<", "<", "<", "<"]]
        + _pair_rows("法规标准", law, "包装标识", pack)
        + _pair_rows("产品设计", design, "质量控制", qc),
        [
            ["风险评估", "<", "<"],
            ["是否为重大变更", "□否　原因：", "<"],
            ["^", "□是，对产品注册有影响　行动：", "<"],
            ["变更是否产生新的风险（是否需要更新风险计划及报告）", "□否　原因：", "<"],
            ["^", "□是　行动：", "<"],
        ],
        [["网络安全", "<", "<"], ["是否依据《医疗器械网络安全注册审查指导原则》进行评估，是否需要采取进一步行动？", "□是，行动：\n□否，原因：", "<"]],
        [["变更影响评估（可多选）", "<"]] + [[item, yes_no.get(item, ynn)] for item in impact],
        [["变更影响检查及行动表（可多选）", "<", "<"]] + action_rows,
        [["对DMR文件是否有影响", "□无影响，原因：\n□有影响，详见下面需要变更的DMR文件列表。"]]
        + [["DMR文件检查表", "<"]]
        + [["□ " + name, "文件号："] for name in dmr],
        [
            ["变更对产线物料/在制品的影响", "<", "<", "<", "<"],
            ["□无影响，原因：", "<", "<", "<", "<"],
            ["名称", "物料编号", "批号", "数量", "处理方法"],
            ["", "", "", "", ""],
        ],
        [
            ["变更对库存物料/半成品/成品的影响", "<", "<", "<", "<"],
            ["□无影响，原因：", "<", "<", "<", "<"],
            ["名称", "产品规格", "批号", "数量", "处理方法"],
            ["", "", "", "", ""],
        ],
        [
            ["变更对已上市产品的影响", "<", "<", "<", "<"],
            ["□无影响，原因：", "<", "<", "<", "<"],
            ["产品名称", "产品规格", "批号", "数量", "处理方法"],
            ["", "", "", "", ""],
        ],
        [
            ["注册判别", "<"],
            ["□非重大变更，不需要提交主管当局批准或无注册判别。", "<"],
            ["□重大变更，需要提交主管当局批准，批准文号：", "<"],
            ["备注：", "<"],
        ],
        [
            ["变更关闭", "<"],
            ["结论", "识别的行动计划全部完成，并完成行动项记录，同意关闭。"],
            ["变更负责人/完成日期", ""],
            ["质量部复核/日期", ""],
            ["产品部负责人确认/日期", ""],
            ["管理者代表批准/日期", ""],
        ],
    ])]}


_BUILDERS = {
    "output_review": _output_review,
    "inspect_spec": _inspect_spec,
    "inspect_record": _inspect_record,
    "change_close": _change_close,
}


def _apply_product(content, product):
    if product is None:
        return content
    name = getattr(product, "name", None) or ""
    full = getattr(product, "full_version", None) or ""
    ver = getattr(product, "release_version", None) or ""
    models = split_models(getattr(product, "type_code", None))
    model_text = "、".join(models)

    def walk(node):
        for table in node.get("tables") or []:
            if not table:
                continue
            head = [str(cell or "").strip() for cell in table[0]]
            if head[:2] == ["型号", "描述"] and models:
                table[:] = [["型号", "描述"]] + [[item, ""] for item in models]
            elif head[:2] == ["规格、型号", "UDI"] and models:
                table[:] = [["规格、型号", "UDI"]] + [[item, ""] for item in models]
            for row in table:
                if len(row) < 2:
                    continue
                key = str(row[0] or "").strip()
                if key == "产品名称" and name:
                    row[1] = name
                elif key == "完整版本" and full:
                    row[1] = full
                elif key in ("发布版本", "产品版本") and ver:
                    row[1] = ver
                elif key == "产品型号" and model_text:
                    row[1] = model_text
                elif key == "规格型号" and models:
                    row[1] = "\n".join("□ " + item for item in models)
                elif key == "型号规格" and model_text:
                    row[1] = model_text
        for child in node.get("children") or []:
            walk(child)

    for section in content.get("sections") or []:
        walk(section)
    return content


def _runtime_cells(table):
    out = []
    for row in (table or {}).get("cells") or []:
        if isinstance(row, list):
            out.append(["" if cell is None else str(cell) for cell in row])
    return out


def _apply_runtime(content, prod_id):
    from .serv_prod_runtime_env import get_runtime_payload

    payload = get_runtime_payload(prod_id)
    tables = []
    for item in payload.get("tables") or []:
        cells = _runtime_cells(item)
        if cells:
            tables.append(cells)
    if not tables:
        return content
    for section in content.get("sections") or []:
        title = str(section.get("title") or "")
        if "检验条件" not in title:
            continue
        current = section.get("tables") if isinstance(section.get("tables"), list) else []
        merged = list(current)
        for index, cells in enumerate(tables[:4]):
            if index < len(merged):
                merged[index] = cells
            else:
                merged.append(cells)
        section["tables"] = merged
    return content


def _plain_title(title):
    return re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(title or "")).strip()


_MD5_METHOD = (
    "参照《网络传输工具和MD5工具使用操作规范》校验MD5码，确认产品完整性。"
    "该MD5码与产品母盘安装包保持一致，以校验经过生产拷贝后，"
    "交付给最终用户的安装包与产品发布母盘里的安装包是完整的、一致的、正确的。"
)


def _imm_md5_one(prod_id, version=""):
    """一份产品的安装包 MD5：同文档版本优先，否则取该产品最新一份。"""
    from sqlalchemy import select

    from ..model.imm_doc import ImmDoc
    from ..utils.sql_ctx import db

    if not prod_id:
        return ""
    docs = db.session.execute(
        select(ImmDoc).where(ImmDoc.product_id == prod_id).order_by(ImmDoc.id.desc())
    ).scalars().all()
    if not docs:
        return ""
    picked = None
    if version:
        picked = next((item for item in docs if str(item.version or "") == str(version)), None)
    content = (picked or docs[0]).content
    if not isinstance(content, dict):
        return ""

    def from_table(table):
        if not table or not isinstance(table[0], list) or len(table) < 2 or not isinstance(table[1], list):
            return ""
        header = [str(cell).strip() for cell in table[0][:2]]
        if header != ["安装包名称", "MD5值"]:
            return ""
        return str(table[1][1] or "").strip() if len(table[1]) > 1 else ""

    for section in content.get("sections") or []:
        if not isinstance(section, dict) or section.get("ref_type") != "md5_attachment":
            continue
        for table in section.get("tables") or []:
            found = from_table(table)
            if found:
                return found
        for child in section.get("children") or []:
            if not isinstance(child, dict):
                continue
            title = re.sub(r"^\s*\d+(?:\.\d+)*[\.、\s]*", "", str(child.get("title") or "")).strip()
            if title != "确认安装包信息":
                continue
            for table in child.get("tables") or []:
                found = from_table(table)
                if found:
                    return found
        break
    return str(content.get("md5_value") or "").strip()


def _imm_md5(prod_id, version=""):
    """当前完整版本没有手册时，用同一产品名称下其它版本里最新一份。"""
    found = _imm_md5_one(prod_id, version)
    if found or not prod_id:
        return found
    from sqlalchemy import select

    from ..model.product import Product
    from ..utils.sql_ctx import db

    product = db.session.get(Product, prod_id)
    name = (getattr(product, "name", None) or "").strip() if product else ""
    if not name:
        return ""
    sibling_ids = db.session.execute(
        select(Product.id).where(Product.name == name, Product.id != prod_id).order_by(Product.id.desc())
    ).scalars().all()
    for sibling_id in sibling_ids:
        found = _imm_md5_one(sibling_id, version)
        if found:
            return found
    return ""


def _ptr_chapter2_clauses(prod_id):
    """产品技术要求第 2 章下没有下级的小节。"""
    from sqlalchemy import select

    from ..model.ptr_doc import PtrDoc
    from ..utils.sql_ctx import db

    if not prod_id:
        return []
    doc = db.session.execute(
        select(PtrDoc).where(PtrDoc.product_id == prod_id).order_by(PtrDoc.id.desc())
    ).scalars().first()
    if not doc or not isinstance(doc.content, dict):
        return []
    numbered = [
        section for section in (doc.content.get("sections") or [])
        if isinstance(section, dict) and section.get("ref_type") not in ("cover", "appendix")
    ]
    if len(numbered) < 2:
        return []
    clauses = []

    def walk(node, number):
        children = [child for child in (node.get("children") or []) if isinstance(child, dict)]
        for index, child in enumerate(children, 1):
            num = f"{number}.{index}"
            nested = [item for item in (child.get("children") or []) if isinstance(item, dict)]
            if nested:
                walk(child, num)
                continue
            title = _plain_title(child.get("title"))
            label = f"{num} {title}".strip()
            body = str(child.get("body") or "").strip()
            if label:
                clauses.append((label, body))

    walk(numbered[1], "2")
    return clauses


def _apply_ptr_clauses(content, prod_id, version=""):
    clauses = _ptr_chapter2_clauses(prod_id)
    if not clauses:
        return content
    md5 = _imm_md5(prod_id, version)
    standard = f"安装包MD5码：\n{md5}" if md5 else "安装包MD5码："
    for section in content.get("sections") or []:
        if "软件技术要求" not in str(section.get("title") or ""):
            continue
        tables = section.get("tables") if isinstance(section.get("tables"), list) else []
        if len(tables) < 2 or not isinstance(tables[1], list) or not tables[1] or not isinstance(tables[1][0], list):
            continue
        if "测试目的" not in str(tables[1][0][0] or ""):
            continue
        for index, table in ((1, tables[1]),):
            header = [str(cell or "") for cell in table[0]]
            names = [item.strip() for item in header]
            kept = {}
            for row in table[1:]:
                if isinstance(row, list) and row:
                    kept[str(row[0] or "").split("\n")[0].strip()] = row
            rows = [header]
            for label, body in clauses:
                prev = kept.get(label) or []
                row = [""] * len(header)
                for col, name in enumerate(names):
                    if col == 0 or "测试目的" in name or "条款" in name:
                        row[col] = label
                    elif "是否检验" in name:
                        row[col] = str(prev[col]).strip() if col < len(prev) and str(prev[col] or "").strip() else "是"
                    elif "判定标准" in name:
                        row[col] = standard
                    elif "检验方法" in name:
                        row[col] = _MD5_METHOD
                    elif col < len(prev):
                        row[col] = str(prev[col] or "")
                rows.append(row)
            tables[index] = rows
    return content


def _manual_name(prod_id):
    from .serv_review_util import dhf_file_no

    code = dhf_file_no(prod_id, ["用户说明书"], ("模型设计说明书",))
    if not code:
        return ""
    return f"{code} 用户说明书.pdf"


def _manual_date(prod_id, version):
    from .serv_review_util import review_date

    raw = review_date(prod_id, ["用户说明书"], version=version) or ""
    return raw.replace(".", "-")


_BASIS_BODY = "、".join([
    "《医疗器械生产质量管理规范》",
    "《医疗器械生产质量管理规范附录：独立软件》",
    "产品技术要求",
    "用户说明书",
    "采购要求及产品BOM",
    "安装维护手册",
])


def _apply_basis(content):
    """依据文件写在正文里。还是空正文时带出默认清单，并去掉序号/文件名称表。"""
    for section in content.get("sections") or []:
        if str(section.get("title") or "").strip() != "依据文件":
            continue
        if not str(section.get("body") or "").strip():
            section["body"] = _BASIS_BODY
        tables = section.get("tables") if isinstance(section.get("tables"), list) else []
        kept = []
        for table in tables:
            if not isinstance(table, list) or not table:
                continue
            head = table[0]
            cells = head if isinstance(head, list) else []
            if cells and not isinstance(cells[0], (list, dict)) and str(cells[0]).strip() == "序号":
                continue
            if isinstance(head, list) and head and isinstance(head[0], list) and str(head[0][0]).strip() == "序号":
                continue
            kept.append(table)
        section["tables"] = kept
    return content


def _role_name(prod_id, keywords):
    from .serv_review_util import _cover_members

    for member in _cover_members(prod_id):
        role = str(getattr(member, "role", "") or "")
        name = str(getattr(member, "name", "") or "").strip()
        if not name:
            continue
        for kw in keywords:
            if kw == "QA":
                if "QA" in role.replace("DQA", ""):
                    return name
            elif kw and kw in role:
                return name
    return ""


def _inspect_sign_date(prod_id, version):
    from .serv_review_util import review_date, timeline_rows_with_sibling

    if not prod_id:
        return ""
    return review_date(
        prod_id, ["成品检验规程"], timeline_rows_with_sibling(prod_id), version=version,
    ) or ""


def _apply_signoff(content, prod_id, version):
    """封面编审批、生效日期和修订记录：日期取时间线，编制人取 QA，审核人和批准人取管代。"""
    qa_name = _role_name(prod_id, ["QA"])
    deputy = _role_name(prod_id, ["管理者代表", "管代"])
    sign_date = _inspect_sign_date(prod_id, version)
    for section in content.get("sections") or []:
        title = str(section.get("title") or "").strip()
        tables = section.get("tables") if isinstance(section.get("tables"), list) else []
        if title == "成品检验规程":
            for table in tables:
                for row in table or []:
                    if not isinstance(row, list) or not row:
                        continue
                    label = str(row[0] or "").strip()
                    if label == "编制人" and qa_name and len(row) > 1:
                        row[1] = qa_name
                    elif label in ("审核人", "批准人") and deputy and len(row) > 1:
                        row[1] = deputy
                    if label in ("编制人", "审核人", "批准人") and sign_date and len(row) > 3:
                        row[3] = sign_date
                    elif label == "生效日期" and sign_date and len(row) > 1:
                        row[1] = sign_date
        elif title == "文件修订记录":
            for table in tables:
                if not isinstance(table, list) or len(table) < 2 or not isinstance(table[1], list):
                    continue
                row = table[1]
                while len(row) < 5:
                    row.append("")
                if sign_date:
                    row[0] = sign_date
                if version and not str(row[1] or "").strip():
                    row[1] = str(version)
                if qa_name:
                    row[3] = qa_name
                if deputy:
                    row[4] = deputy
    return content


def _set_label(content, label, value):
    if not value:
        return
    for section in content.get("sections") or []:
        for table in section.get("tables") or []:
            for row in table:
                if isinstance(row, list) and len(row) >= 2 and str(row[0] or "").strip() == label:
                    row[1] = value


def apply_inspect_autofill(content, product, version="", kind=""):
    if not isinstance(content, dict) or product is None:
        return content
    if kind not in ("inspect_spec", "inspect_record"):
        return content
    content = _apply_product(content, product)
    if kind == "inspect_spec":
        _apply_basis(content)
        _apply_signoff(content, getattr(product, "id", None), version)
        _apply_runtime(content, getattr(product, "id", None))
        _apply_ptr_clauses(content, getattr(product, "id", None), version)
        _set_label(content, "文件名称", _manual_name(getattr(product, "id", None)))
        _set_label(content, "说明书发布日期", _manual_date(getattr(product, "id", None), version))
    return content


def _has_merge_mark(content):
    for section in (content or {}).get("sections") or []:
        if not isinstance(section, dict):
            continue
        for table in section.get("tables") or []:
            for row in table or []:
                if isinstance(row, list) and any(cell in ("<", "^") for cell in row):
                    return True
    return False


def _set_by_label(table, label, value, col=1):
    if not value:
        return
    for row in table or []:
        if isinstance(row, list) and row and str(row[0] or "").strip() == label and len(row) > col:
            row[col] = value
            return


def _model_checks(current, models):
    """按当前产品型号重写勾选行，已经勾过的型号保留。"""
    checked = set()
    for line in str(current or "").splitlines():
        text = line.strip()
        if text.startswith("☑") or text.startswith("■"):
            checked.add(text.lstrip("☑■").strip())
    return "\n".join(("☑ " if name in checked else "□ ") + name for name in models)


def _fill_inspect_record(content, product, version=""):
    if product is None:
        return content
    name = getattr(product, "name", None) or ""
    full = getattr(product, "full_version", None) or ""
    release = getattr(product, "release_version", None) or ""
    models = split_models(getattr(product, "type_code", None))
    prod_id = getattr(product, "id", None)
    from .serv_review_util import dhf_file_no
    basis_no = dhf_file_no(prod_id, ["成品检验规程"]) if prod_id else ""
    md5 = _imm_md5(prod_id, version) if prod_id else ""
    note = str(getattr(product, "note", None) or "").strip()
    inspector = _inspect_person(prod_id, version) if prod_id else ""
    for section in content.get("sections") or []:
        for table in section.get("tables") or []:
            if not table or not isinstance(table[0], list):
                continue
            if str(table[0][0] or "") != "产品名称":
                continue
            _set_by_label(table, "产品名称", name)
            _set_by_label(table, "完整版本号", full)
            _set_by_label(table, "生产日期", _design_transfer_date(prod_id, version))
            for row in table:
                if not isinstance(row, list) or len(row) < 4:
                    continue
                if str(row[2] or "") == "型号规格" and models:
                    row[3] = _model_checks(row[3], models)
                if str(row[0] or "").startswith("检验依据") and basis_no:
                    row[0] = f"检验依据：{basis_no} 成品检验规程"
                if str(row[0] or "") == "软件技术要求" and md5:
                    row[1] = f"安装包MD5码：\n{md5}"
                if str(row[0] or "") == "版本号识别" and (full or release):
                    row[1] = f"完整版本：{full}\n发布版本：{release}"
                if str(row[0] or "").strip() == "备注" and note and len(row) > 1:
                    row[1] = note
                if str(row[0] or "").startswith("检验人员") and inspector and len(row) > 1:
                    row[1] = inspector
    return content


def _design_transfer_date(prod_id, version=""):
    """生产日期取时间线「设计转换」。当前版本没有时间线时用同一产品名称下其它版本。"""
    if not prod_id:
        return ""
    from .serv_review_util import review_date, timeline_rows_with_sibling

    return review_date(prod_id, ["设计转换"], timeline_rows_with_sibling(prod_id), version=version) or ""


def _inspect_person(prod_id, version=""):
    """检验人员取 QA（DQA 不算），日期优先成品检验记录，否则成品检验规程。"""
    from .serv_review_util import review_date, timeline_rows_with_sibling

    name = _role_name(prod_id, ["QA"])
    rows = timeline_rows_with_sibling(prod_id)
    sign_date = (
        review_date(prod_id, ["成品检验记录"], rows, version=version)
        or review_date(prod_id, ["成品检验规程"], rows, version=version)
        or ""
    )
    return "  ".join(part for part in (name, sign_date) if part)


# 变更影响检查表的活动 → DHF 文件名关键字。按这个顺序匹配，排除词用来避开反馈、模型需求这类旁支。
_ACTION_FILES = {
    "变更是否对产品风险产生影响": (["风险管理计划", "风险管理报告"], ()),
    "产品需求": (["需求规格说明"], ("模型需求",)),
    "数据采集需求": (["数据采集需求"], ("反馈",)),
    "数据脱敏检查、数据清洗": (["数据整理记录"], ()),
    "数据标注、数据上传": (["数据标注记录", "数据库上传记录"], ()),
    "数据库统计与维护": (["数据库统计", "数据库维护记录"], ()),
    "人员培训与考核": (["人员培训记录", "考核评价记录"], ()),
    "算法和模型网络结构设计": (["算法方案概要设计", "算法方案详细设计"], ()),
    "数据集构建": (["构建记录"], ()),
    "标记需求制定": (["数据标注规则", "数据标注需求"], ("反馈",)),
    "模型开发": (["模型开发计划"], ()),
    "模型训练": (["模型训练记录"], ()),
    "模型测试": (["模型测试方案", "模型测试记录", "模型测试报告"], ()),
    "产品设计": (["软件概要设计", "软件详细设计"], ()),
    "产品开发": (["软件开发计划"], ()),
    "软件测试": (["软件测试计划", "单元测试", "集成测试", "系统测试", "软件测试报告"], ()),
    "产品验收": (["产品验收记录"], ()),
    "用户测试": (["用户测试计划", "用户测试用例", "用户测试记录", "用户测试报告"], ()),
    "可用性测试": (["可用性测试"], ()),
    "临床试验/临床评价": (["临床评价", "临床试验"], ()),
    "可追溯性分析活动": (["可追溯性分析报告"], ()),
    "配置管理活动": (["软件配置管理计划", "软件配置状态报告"], ()),
    "配置管理工具": (["配置管理工具"], ()),
    "开发/测试/标注/工具确认": (["工具确认计划"], ()),
    "用户说明书": (["用户说明书"], ()),
    "产品发布": (["产品发布说明"], ()),
}
_DMR_FILES = {
    "产品包装标签样稿": (["标签样稿"], ()),
}


def _change_dhf_rows(prod_id):
    """当前产品的 DHF。这一版没有清单时，用同一产品名称下最新一份有清单的版本。"""
    if not prod_id:
        return []
    from sqlalchemy import select

    from ..model.prod_dhf import ProdDhf
    from ..model.product import Product
    from ..utils.sql_ctx import db

    def load(pid):
        return db.session.execute(
            select(ProdDhf).where(ProdDhf.prod_id == pid).order_by(ProdDhf.id.asc())
        ).scalars().all()

    rows = load(prod_id)
    if rows:
        return rows
    product = db.session.get(Product, prod_id)
    name = (getattr(product, "name", None) or "").strip() if product else ""
    if not name:
        return []
    sibling_ids = db.session.execute(
        select(Product.id).where(Product.name == name, Product.id != prod_id).order_by(Product.id.desc())
    ).scalars().all()
    for sibling_id in sibling_ids:
        rows = load(sibling_id)
        if rows:
            return rows
    return []


def _match_change_files(rows, keywords, excludes=()):
    from .serv_review_util import _normalize_dhf_code

    hits = []
    seen = set()
    for keyword in keywords:
        for item in rows:
            name = str(getattr(item, "name", "") or "")
            if keyword not in name or any(piece and piece in name for piece in excludes):
                continue
            code = _normalize_dhf_code(getattr(item, "code", ""))
            if not code or code in seen:
                continue
            if name in seen:
                continue
            seen.add(code)
            seen.add(name)
            hits.append(name)
    return hits


def _file_no_text(items):
    return "文件号：" + "、".join(items) if items else ""


def _is_auto_file_cell(text):
    body = str(text or "").strip()
    if body in ("", "文件号："):
        return True
    return body.startswith("文件号：") and "TX-TF-" in body and "\n" not in body


def _fill_change_files(content, product):
    prod_id = getattr(product, "id", None) if product is not None else None
    rows = _change_dhf_rows(prod_id)
    if not rows:
        return content
    for section in content.get("sections") or []:
        for table in section.get("tables") or []:
            for row in table or []:
                if not isinstance(row, list):
                    continue
                activity = str(row[1] or "").strip() if len(row) > 1 else ""
                spec = _ACTION_FILES.get(activity)
                if spec and len(row) > 2 and _is_auto_file_cell(row[2]):
                    text = _file_no_text(_match_change_files(rows, spec[0], spec[1]))
                    if text:
                        row[2] = text
                label = str(row[0] or "").lstrip("□☑■ ").strip()
                dmr = _DMR_FILES.get(label, ([label], ()))
                if len(row) > 1 and str(row[1] or "").strip().startswith("文件号") and _is_auto_file_cell(row[1]):
                    if label in ("其它DMR文件或记录单", "其它DMR文件或记录单："):
                        continue
                    text = _file_no_text(_match_change_files(rows, dmr[0], dmr[1]))
                    if text:
                        row[1] = text
    return content


def _member_names(prod_id, keywords, limit=1):
    """按角色取参与人员。当前版本优先，没有再看同一产品名称的其它版本。QA 不含 DQA。"""
    if not prod_id or not keywords:
        return []
    from .serv_review_util import _cover_members

    names = []
    members = list(_cover_members(prod_id))
    members.sort(key=lambda item: (getattr(item, "prod_id", None) != prod_id, getattr(item, "sort_order", 0) or 0, getattr(item, "id", 0) or 0))
    for member in members:
        role = str(getattr(member, "role", "") or "")
        name = str(getattr(member, "name", "") or "").strip()
        if not name or name in names:
            continue
        matched = False
        for keyword in keywords:
            if keyword == "QA":
                matched = "QA" in role.replace("DQA", "")
            else:
                matched = keyword in role
            if matched:
                break
        if not matched:
            continue
        names.append(name)
        if len(names) >= limit:
            break
    return names


def _change_review_date(prod_id, version=""):
    if not prod_id:
        return ""
    from .serv_review_util import review_date, timeline_rows_with_sibling

    return review_date(prod_id, ["变更评估"], timeline_rows_with_sibling(prod_id), version=version) or ""


def _change_sign_date(prod_id, version=""):
    """变更关闭的签字日期只取时间线「变更评估关闭」。"""
    if not prod_id:
        return ""
    from .serv_review_util import review_date, timeline_rows_with_sibling

    return review_date(prod_id, ["变更评估关闭"], timeline_rows_with_sibling(prod_id), version=version) or ""


def _set_empty(row, col, value):
    if value and len(row) > col and not str(row[col] or "").strip():
        row[col] = value


_REVIEW_ROW_1 = ["申请人", "申请部门负责人", "研发部负责人", "质量部负责人", "生产部负责人"]
_REVIEW_ROW_2 = ["变更负责人", "QA", "研发工程师", "研发工程师", "其他"]


def _fill_change_reviewers(content, product, version=""):
    """评审人按参与人员角色带出，评审时间和批准时间取时间线「变更评估」。"""
    if product is None:
        return content
    prod_id = getattr(product, "id", None)
    one = {
        "申请人": (_member_names(prod_id, ["产品经理"]) or [""])[0],
        "申请部门负责人": (_member_names(prod_id, ["产品负责人"]) or [""])[0],
        "研发部负责人": (_member_names(prod_id, ["研发负责人"]) or [""])[0],
        "质量部负责人": (_member_names(prod_id, ["QA"]) or [""])[0],
        "生产部负责人": (_member_names(prod_id, ["生产"]) or [""])[0],
        "QA": (_member_names(prod_id, ["QA"]) or [""])[0],
    }
    engineers = _member_names(prod_id, ["开发人员", "开发工程师", "研发工程师"], 2)
    approver = (_member_names(prod_id, ["管理者代表", "管代"]) or [""])[0]
    when = _change_review_date(prod_id, version)
    sign_when = _change_sign_date(prod_id, version)
    for section in content.get("sections") or []:
        tables = section.get("tables") or []
        for table in tables:
            for index, row in enumerate(table or []):
                if not isinstance(row, list):
                    continue
                labels = [str(cell or "").strip() for cell in row[:5]]
                nxt = table[index + 1] if index + 1 < len(table) and isinstance(table[index + 1], list) else None
                if labels == _REVIEW_ROW_1 and nxt is not None:
                    for col, label in enumerate(_REVIEW_ROW_1):
                        _set_empty(nxt, col, one.get(label, ""))
                elif labels == _REVIEW_ROW_2 and nxt is not None:
                    _set_empty(nxt, 1, one.get("QA", ""))
                    if engineers:
                        _set_empty(nxt, 2, engineers[0])
                    if len(engineers) > 1:
                        _set_empty(nxt, 3, engineers[1])
                elif labels and labels[0] == "评审时间":
                    if len(row) > 1 and row[1] == "<":
                        if when:
                            row[1] = when
                    else:
                        _set_empty(row, 1, when)
                elif labels and labels[0] == "批准人":
                    _set_empty(row, 1, approver)
                    _set_empty(row, 4, when)
                elif labels and labels[0] in ("变更负责人/完成日期", "质量部复核/日期", "产品部负责人确认/日期", "管理者代表批准/日期"):
                    if sign_when and len(row) > 1:
                        row[1] = sign_when
    return content


def _ecr_nos_for_name(name):
    """按产品名称从 ECR 台账取编号。去空格后相同，或互为开头，取最长的名称；多条用顿号。"""
    target = re.sub(r"\s+", "", str(name or ""))
    if len(target) < 2:
        return ""
    from sqlalchemy import select
    from sqlalchemy.sql import asc
    from ..model.ecr import Ecr
    from ..utils.sql_ctx import db

    rows = db.session.execute(select(Ecr).order_by(asc(Ecr.sort_order), asc(Ecr.id))).scalars().all()
    matched = []
    for row in rows:
        other = re.sub(r"\s+", "", str(row.product_name or ""))
        if len(other) < 2:
            continue
        if other == target:
            rank = (2, len(other))
        elif target.startswith(other) or other.startswith(target):
            rank = (1, len(other))
        else:
            continue
        matched.append((rank, (row.ecr_no or "").strip()))
    if not matched:
        return ""
    best = max(item[0] for item in matched)
    nos = []
    for rank, code in matched:
        if rank == best and code and code not in nos:
            nos.append(code)
    return "、".join(nos)


def _fill_change_close(content, product, version=""):
    if product is None:
        return content
    name = getattr(product, "name", None) or ""
    release = getattr(product, "release_version", None) or ""
    models = " / ".join(split_models(getattr(product, "type_code", None)))
    for section in content.get("sections") or []:
        for table in section.get("tables") or []:
            if not table or not isinstance(table[0], list) or str(table[0][0] or "") != "ECR号":
                continue
            ecr_no = _ecr_nos_for_name(name)
            if ecr_no and len(table[0]) > 1 and not str(table[0][1] or "").strip():
                table[0][1] = ecr_no
            if name and len(table[0]) > 3:
                table[0][3] = name
            if len(table) > 1 and isinstance(table[1], list):
                if models and len(table[1]) > 1:
                    table[1][1] = models
                if release and len(table[1]) > 3:
                    table[1][3] = release
    _fill_change_files(content, product)
    return _fill_change_reviewers(content, product, version)


def ensure_word_form(content, product, version="", kind=""):
    """旧的两列表打开和导出时换成 Word 模版。已经是合并表的保留手改，只覆盖自动项。"""
    content = content if isinstance(content, dict) else {"sections": []}
    if kind == "inspect_record":
        if not _has_merge_mark(content):
            content = copy.deepcopy(_inspect_record())
        return _fill_inspect_record(content, product, version)
    if kind == "change_close":
        if not _has_merge_mark(content):
            content = copy.deepcopy(_change_close())
        return _fill_change_close(content, product, version)
    return content


def build_content(kind, product=None, version=""):
    if kind == "output_review":
        return output_review_content(product, version)
    if kind == "inspect_record":
        return ensure_word_form(copy.deepcopy(_inspect_record()), product, version, kind)
    if kind == "change_close":
        return ensure_word_form(copy.deepcopy(_change_close()), product, version, kind)
    builder = _BUILDERS.get(kind)
    if builder is None:
        return {"sections": []}
    content = _apply_product(copy.deepcopy(builder()), product)
    if product is not None and kind in ("inspect_spec", "inspect_record"):
        content = apply_inspect_autofill(content, product, "", kind)
    return content
