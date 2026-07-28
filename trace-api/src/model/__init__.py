#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from datetime import datetime
from sqlalchemy import orm, Column, DateTime, Integer, String, TEXT

Base = orm.declarative_base()


class Model(Base):
    __abstract__ = True
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    create_time = Column(DateTime, default=datetime.now)
    update_time = Column(DateTime, default=datetime.now)

    def dict(self, include_keys: set= None, exclude_null=True):
        result = dict()
        for col in self.__table__.columns:
            if include_keys and col.name not in include_keys:
                continue
            value = getattr(self, col.name)
            if value is None and exclude_null:
                continue
            result[col.name] = value
        return result


class SessionData(Base):
    __tablename__ = "session"
    key = Column(String(64), unique=True, primary_key=True)
    value = Column(TEXT)
    exp = Column(Integer)
    create_time = Column(DateTime, default=datetime.now)

    uid = Column(Integer, index=True)


# 2.0 独立模块：风险管理。显式导入让 Alembic autogenerate 能发现新表。
from .risk_mgmt_doc import RiskAnalysis, RiskControl, RiskMgmtDoc, RiskParticipant  # noqa: E402,F401

# 2.1 独立模块：网络安全管理。详见 docs/function_docs/47_网络安全管理.md。
from .cybersec_doc import (  # noqa: E402,F401
    CybersecDoc,
    CybersecThreat,
    CybersecControlInternal,
    CybersecControlSbom,
    CybersecControlScan,
)

# CST(总表) 与 RCM(总表) 多对多关联。详见 docs/function_docs/41_网络安全威胁CST管理.md。
from .cst_rcm import CstRcm  # noqa: E402,F401

# 项目人员管理。详见 docs/function_docs/48_项目人员管理.md。
from .project_member import ProjectMember  # noqa: E402,F401

# 项目时间逻辑线。详见 docs/function_docs/49_项目时间逻辑线.md。
from .project_timeline import ProjectTimelineRow, ProjectTimelineCell  # noqa: E402,F401

# 运行环境（按产品）。详见 docs/function_docs/50_运行环境.md。
from .prod_runtime_env import ProdRuntimeEnv  # noqa: E402,F401

# 设备资源（按产品）。详见 docs/function_docs/51_设备资源.md。
from .prod_device_res import ProdDeviceRes  # noqa: E402,F401

# 产品开发计划（独立文档模块）。详见 docs/function_docs/52_产品开发计划.md。
from .pdp_doc import PdpDoc  # noqa: E402,F401

# 产品立项报告（独立文档模块）。详见 docs/function_docs/53_产品立项报告.md。
from .pir_doc import PirDoc  # noqa: E402,F401

# 版本更新历史（独立文档模块）。详见 docs/function_docs/54_版本更新历史.md。
from .vuh_doc import VuhDoc  # noqa: E402,F401

# 版本命名规则（基础数据，全局单条配置）。详见 docs/function_docs/55_版本命名规则.md。
from .version_rule import VersionRule  # noqa: E402,F401

# 产品技术要求（独立文档模块）。详见 docs/function_docs/56_产品技术要求.md。
from .ptr_doc import PtrDoc  # noqa: E402,F401

# 公司基本信息（基础数据）。详见 docs/function_docs/57_公司基本信息.md。
from .company_info import CompanyInfo  # noqa: E402,F401

# 产品标签样稿（独立文档模块）。详见 docs/function_docs/58_产品标签样稿.md。
from .label_doc import LabelDoc  # noqa: E402,F401

# 产品发布说明（独立文档模块）。
from .release_note import ReleaseNote  # noqa: E402,F401

# 初步危害分析清单（独立文档模块）。
from .pha_doc import PhaDoc  # noqa: E402,F401

# 网络安全能力分析（MDS2，独立文档模块）。
from .cyber_cap_doc import CyberCapDoc  # noqa: E402,F401

# 自研软件研究报告（独立文档模块）。
from .research_doc import ResearchDoc  # noqa: E402,F401

# 自研软件网络安全研究报告（独立文档模块）。
from .nsr_doc import NsrDoc  # noqa: E402,F401

# 产品验收记录（独立文档模块）。
from .acc_doc import AccDoc  # noqa: E402,F401

# 网络安全维护计划（独立文档模块）。
from .nsmp_doc import NsmpDoc  # noqa: E402,F401

# 风险管理计划（独立文档模块）。
from .rmp_doc import RmpDoc  # noqa: E402,F401

# 软件开发计划（独立文档模块，模板参考产品开发计划）。
from .sd_doc import SdDoc  # noqa: E402,F401

# 代码审查记录（独立文档模块，开发文件）。
from .crr_doc import CrrDoc  # noqa: E402,F401

# 开发环境维护说明（独立文档模块，开发文件）。
from .dem_doc import DemDoc  # noqa: E402,F401

# 现场测试规程（独立文档模块，测试文件 VV-006）。
from .ftr_doc import FtrDoc  # noqa: E402,F401

# 现场测试记录（独立文档模块，测试文件 VV-006）。
from .ftr_record_doc import FtrRecordDoc  # noqa: E402,F401

# 开发设备清单（独立文档模块，开发文件）。
from .deq_doc import DeqDoc  # noqa: E402,F401

# 软件配置管理计划 / 软件配置状态报告（独立文档模块，开发文件）。
from .scm_doc import ScmDoc  # noqa: E402,F401
from .scs_doc import ScsDoc  # noqa: E402,F401

# 数据申请单（独立文档模块，开发文件）。
from .dat_doc import DatDoc  # noqa: E402,F401

# 软件测试计划 / 用户测试计划 / 用户测试报告 / 软件测试报告（测试文件，PDP 风格章节树）。
from .stp_doc import StpDoc  # noqa: E402,F401
from .utp_doc import UtpDoc  # noqa: E402,F401
from .utr_doc import UtrDoc  # noqa: E402,F401
from .str_doc import StrDoc  # noqa: E402,F401
from .bug_doc import BugDoc  # noqa: E402,F401
from .teq_doc import TeqDoc  # noqa: E402,F401
from .tem_doc import TemDoc  # noqa: E402,F401
from .imm_doc import ImmDoc  # noqa: E402,F401

# 人员签名管理（基础数据）：人名章记录。
from .person_sign import PersonSign  # noqa: E402,F401

# 打印服务配置（基础配置）：IPP打印机连接配置。
from .print_service_cfg import PrintServiceCfg  # noqa: E402,F401

# 文档导出/打印记录。
from .doc_record import DocExportRecord, DocPrintRecord  # noqa: E402,F401
