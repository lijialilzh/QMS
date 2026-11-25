import logging
from sqlalchemy import select, delete, func, or_, update
from sqlalchemy.sql import asc
from ..model.ecr import Ecr
from ..obj.tobj_ecr import EcrForm
from ..obj.vobj_ecr import EcrObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)

# 台账初始数据，与登记表一致。仅在表为空时写入一次。
SEED = [
    ("ECR-2022-001", "心血管图像处理软件", "V1.1.0.0", "2022/10/17", "韩亭", "变更相关文档，增加注册信息", "获批后"),
    ("ECR-2022-002", "脑血管图像处理软件", "V1.0.0.0", "2022/12/19", "韩亭", "变更相关文档，增加注册信息", "获批后"),
    ("ECR-2022-003", "腹部三维图像处理软件", "V1.0.0.0", "2022/12/19", "韩亭", "变更相关文档，增加注册信息", "获批后"),
    ("ECR-2022-004", "三维可视化医学图像处理软件", "V1.0.0.0", "2022/12/19", "韩亭", "变更相关文档，增加注册信息", "获批后"),
    ("ECR-2023-001", "肺结节CT影像辅助检测软件", "4.0.1.3", "2023/2/6", "韩亭", "变更产品名称及版本号", "修改版本号"),
    ("ECR-2023-002", "Computer Aided Diagnostic Software InferRead® DR Chest", "V1.0.1.1", "2023/3/13", "韩亭", "发补变更", ""),
    ("ECR-2023-003", "冠脉CT造影图像血管狭窄辅助评估软件", "V1.0.0.0", "2023/04/19", "韩亭", "发补变更", "发补阶段"),
    ("ECR-2023-004", "Computer Aided Diagnostic Software InferRead® DR Chest", "V1.0.1.1", "2023/7/14", "林金贵",
     "网站（https://global.infervision.com/）发布的产品信息调整一下“view more”的方式，如需查看更多信息，向欧洲推想邮件索取。", ""),
    ("ECR-2023-005", "冠脉CT造影图像血管狭窄辅助评估软件", "1.0.1.0", "2023/08/07", "张敬", "获批变更", "获批后"),
    ("ECR-2023-006", "冠脉CT血管造影图像辅助评估软件", "2.0.0.1", "2023/11/15", "韩亭", "冠脉二代", "启动新的注册"),
    ("ECR-2023-007", "颅脑CT图像辅助评估软件", "2.0.0.2", "2023/11/15", "韩亭", "颅脑二代", "启动新的注册"),
    ("ECR-2023-008", "胸部CT图像处理与分析软件", "2.0.1.0", "2023/11/16", "韩亭",
     "胸外变更产品名称、适用范围和结构组成\n获批前启动产品变更，连同获批的注册证号信息一起变更",
     "发补阶段\n电话补阶段\n连同上市获批信息一起变更"),
    ("ECR-2023-009", "颅内动脉瘤CT造影图像辅助分诊与评估软件", "1.0.1.0", "2023/12/07", "韩亭",
     "删除动脉瘤最大径和血管位置的功能，修改产品名称", "发补阶段"),
    ("ECR-2023-010", "腹部CT图像全自动手术计划软件", "1.0.4.0", "2023/12/08", "韩亭", "删除自动识别肿瘤的功能", "发补阶段-预审查反馈后"),
    ("ECR-2023-011", "胸部CT全自动手术计划软件", "3.0.0.1", "2023/12/25", "韩亭", "增加手术计划相关功能，进行变更注册", "变更注册"),
    ("ECR-2023-012", "FDA肺结节", "3.0.0.4", "2023/12/25", "", "", ""),
    ("ECR-2024-001", "涉及所有U盘交付方式的产品，关于U盘的规格变更", "/", "2024/3/12", "金贵",
     "USB3.0变更为3.2\nTX-TF-RD-001-A0 采购要求\nTX-TF-RD-002-A0 U盘交付产品BOM\nTX-TF-QC-001-A2 进货检验规程", "文件变更"),
    ("ECR-2024-002", "肝肾外科手术计划软件", "1.0.5.0", "2024/3/12", "韩亭", "修改产品名称", "获批"),
    ("ECR-2024-003", "头颈CT血管造影图像辅助评估软件", "1.0.1.0", "2024/3/13", "韩亭", "修改产品名称", "确认上证信息"),
    ("ECR-2024-004", "BSI飞检整改：CE MDD产品说明书、标签更改公司名称", "", "2024/3/22", "林金贵", "修改标签样稿、说明书", ""),
    ("ECR-2024-005", "FDA肺结节5.0.0.5", "5.0.1.5", "2024/6/28", "林金贵", "修复渗透测试发现的BUG", ""),
    ("ECR-2024-006", "主动脉夹层CT造影图像辅助评估软件", "1.1.3.0", "2024/04/25", "李佳励", "修改产品名称/完整版本", "获批"),
    ("ECR-2024-007", "颅内出血CT图像辅助分诊软件", "2.0.0.3", "2024/09/23", "李佳励", "修改产品名称/完整版本", "获批"),
    ("ECR-2024-008", "肺栓塞", "", "2024/11/11", "", "修改产品名称/完整版本 肺栓塞CT图像辅助分诊软件", "发补"),
    ("ECR-2024-009", "脑MRA", "", "2024/11/11", "", "修改产品名称/完整版本 头颈部MR血管图像处理及分析软件", "发补"),
    ("ECR-2024-010", "胸外二代", "", "2024/11/28", "", "修改产品名称/完整版本 肺外科手术计划软件", "发补"),
    ("ECR-2024-011", "CE认证和UKCA认证上市后变更 公司生产地址变更", "", "2024/11/28", "林金贵",
     "修改标签样稿、说明书、TD文件，以及向NB机构申请变更", ""),
    ("ECR-2024-012", "FDA肺结节", "5.0.2.5", "2024/12/23", "李佳励",
     "NUSV5025，回退模型版本，重新进行渗透测试及网络安全扫描", "产品及文件变更"),
    ("ECR-2025-001", "CE OP", "1.0.1.0", "2025/02/20", "李佳励",
     "修改产品名称、版本号、持证人主题变更及相关产品功能变更", "启动新的注册"),
    ("ECR-2025-002", "肺栓塞 上市后", "1.0.4.1", "2025/3/4", "", "修改产品名称、版本号、结构组成、适用范围等", ""),
    ("ECR-2025-003", "胸外二代 上市后", "3.0.1.2", "2025/4/3", "", "", ""),
    ("ECR-2025-004", "肿瘤CT图像随访与评估软件", "2.0.0.0", "", "林金贵", "RCN3V2000", "启动新项目（康想委托）"),
    ("ECR-2025-005", "FDA OP", "1.1.0.1", "2025/05/07", "李佳励", "XUSV1101，增加导出STL及其他功能", "产品及文件变更"),
    ("ECR-2026-001", "FDA Recist", "1.0.1.0", "2026/01/27", "李佳励",
     "根据发补要求图文报告功能优化，更新版本号、适用范围", "产品及文件变更"),
]


def seed_ecr_if_empty():
    total = db.session.execute(select(func.count()).select_from(Ecr)).scalar() or 0
    if total:
        return 0
    for i, item in enumerate(SEED, 1):
        db.session.add(Ecr(
            ecr_no=item[0],
            product_name=item[1],
            version=item[2],
            apply_date=item[3],
            applicant=item[4],
            content=item[5],
            note=item[6],
            sort_order=i,
        ))
    db.session.commit()
    return len(SEED)


def _dup_ecr_no(ecr_no: str, exclude_id: int = None):
    code = (ecr_no or "").strip()
    if not code:
        return False
    sql = select(Ecr.id).where(Ecr.ecr_no == code)
    if exclude_id:
        sql = sql.where(Ecr.id != exclude_id)
    return db.session.execute(sql).scalars().first() is not None


class Server(object):

    async def add_ecr(self, form: EcrForm):
        try:
            if _dup_ecr_no(form.ecr_no):
                return Resp.resp_err(msg="ECR编号已存在")
            if form.sort_order is None:
                current = db.session.execute(select(func.max(Ecr.sort_order))).scalar() or 0
                sort_order = int(current) + 1
            else:
                sort_order = int(form.sort_order)
                db.session.execute(
                    update(Ecr).where(Ecr.sort_order >= sort_order).values(sort_order=Ecr.sort_order + 1),
                    execution_options={"synchronize_session": False},
                )
            row = Ecr(
                ecr_no=(form.ecr_no or "").strip(),
                product_name=form.product_name or "",
                version=form.version or "",
                apply_date=form.apply_date or "",
                applicant=form.applicant or "",
                content=form.content or "",
                note=form.note or "",
                sort_order=sort_order,
            )
            db.session.add(row)
            db.session.commit()
            return Resp.resp_ok(data=EcrObj(**row.dict()))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def update_ecr(self, form: EcrForm):
        try:
            row: Ecr = db.session.execute(select(Ecr).where(Ecr.id == form.id)).scalars().first()
            if not row:
                return Resp.resp_err(msg=ts("msg_obj_null"))
            if _dup_ecr_no(form.ecr_no, form.id):
                return Resp.resp_err(msg="ECR编号已存在")
            for key in ("ecr_no", "product_name", "version", "apply_date", "applicant", "content", "note", "sort_order"):
                value = getattr(form, key)
                if value is None:
                    continue
                if key == "ecr_no":
                    value = str(value).strip()
                setattr(row, key, value)
            db.session.commit()
            return Resp.resp_ok(data=EcrObj(**row.dict()))
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))

    async def delete_ecr(self, ids: list):
        ids = [int(i) for i in (ids or []) if str(i).strip().isdigit()]
        if not ids:
            return Resp.resp_err(msg=ts("msg_err_param"))
        db.session.execute(delete(Ecr).where(Ecr.id.in_(ids)))
        db.session.commit()
        return Resp.resp_ok()

    async def list_ecr(self, keyword: str = None, page_index: int = 0, page_size: int = 20):
        seed_ecr_if_empty()
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 20
        sql = select(Ecr)
        text = (keyword or "").strip()
        if text:
            like = f"%{text}%"
            sql = sql.where(or_(
                Ecr.ecr_no.ilike(like),
                Ecr.product_name.ilike(like),
                Ecr.version.ilike(like),
                Ecr.applicant.ilike(like),
                Ecr.content.ilike(like),
                Ecr.note.ilike(like),
            ))
        total = db.session.execute(select(func.count()).select_from(sql.subquery())).scalar() or 0
        sql = sql.order_by(asc(Ecr.sort_order), asc(Ecr.id)).offset(page_size * page_index).limit(page_size)
        rows = db.session.execute(sql).scalars().all()
        objs = [EcrObj(**row.dict()) for row in rows]
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))
