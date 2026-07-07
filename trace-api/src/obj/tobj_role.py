#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei

from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class PermForm(BaseModel):
    id: Optional[int] = Field(title="权限ID")
    p_code: Optional[str] = Field(title="父权限编码")
    code: Optional[str] = Field(title="权限编码")
    name: Optional[str] = Field(title="权限名称")


class Perms(Enum):
    dashboard = PermForm(code="dashboard", name="仪表盘")
    dashboard_view = PermForm(code="dashboard_view", name="查看", p_code=dashboard.code)
    dashboard_edit = PermForm(code="dashboard_edit", name="编辑", p_code=dashboard.code)

    role = PermForm(code="role", name="系统管理/角色配置")
    role_view = PermForm(code="role_view", name="查看", p_code=role.code)
    role_edit = PermForm(code="role_edit", name="编辑", p_code=role.code)

    user = PermForm(code="user", name="系统管理/用户管理")
    user_view = PermForm(code="user_view", name="查看", p_code=user.code)
    user_edit = PermForm(code="user_edit", name="编辑", p_code=user.code)

    project = PermForm(code="project", name="系统管理/项目管理")
    project_view = PermForm(code="project_view", name="查看", p_code=project.code)
    project_edit = PermForm(code="project_edit", name="编辑", p_code=project.code)

    project_member = PermForm(code="project_member", name="产品管理/产品参与人员")
    project_member_view = PermForm(code="project_member_view", name="查看", p_code=project_member.code)
    project_member_edit = PermForm(code="project_member_edit", name="编辑", p_code=project_member.code)

    project_timeline = PermForm(code="project_timeline", name="产品管理/产品时间逻辑线")
    project_timeline_view = PermForm(code="project_timeline_view", name="查看", p_code=project_timeline.code)
    project_timeline_edit = PermForm(code="project_timeline_edit", name="编辑", p_code=project_timeline.code)

    prod_runtime = PermForm(code="prod_runtime", name="产品管理/运行环境")
    prod_runtime_view = PermForm(code="prod_runtime_view", name="查看", p_code=prod_runtime.code)
    prod_runtime_edit = PermForm(code="prod_runtime_edit", name="编辑", p_code=prod_runtime.code)

    prod_device = PermForm(code="prod_device", name="产品管理/设备资源")
    prod_device_view = PermForm(code="prod_device_view", name="查看", p_code=prod_device.code)
    prod_device_edit = PermForm(code="prod_device_edit", name="编辑", p_code=prod_device.code)

    haz = PermForm(code="haz", name="基础数据/HAZ管理")
    haz_view = PermForm(code="haz_view", name="查看", p_code=haz.code)
    haz_edit = PermForm(code="haz_edit", name="编辑", p_code=haz.code)

    rcm = PermForm(code="rcm", name="基础数据/RCM管理")
    rcm_view = PermForm(code="rcm_view", name="查看", p_code=rcm.code)
    rcm_edit = PermForm(code="rcm_edit", name="编辑", p_code=rcm.code)

    cst = PermForm(code="cst", name="基础数据/CST管理")
    cst_view = PermForm(code="cst_view", name="查看", p_code=cst.code)
    cst_edit = PermForm(code="cst_edit", name="编辑", p_code=cst.code)

    version_rule = PermForm(code="version_rule", name="基础数据/版本命名规则")
    version_rule_edit = PermForm(code="version_rule_edit", name="编辑", p_code=version_rule.code)

    company_info = PermForm(code="company_info", name="基础数据/公司基本信息")
    company_info_view = PermForm(code="company_info_view", name="查看", p_code=company_info.code)
    company_info_edit = PermForm(code="company_info_edit", name="编辑", p_code=company_info.code)

    person_sign = PermForm(code="person_sign", name="基础数据/人员签名管理")
    person_sign_view = PermForm(code="person_sign_view", name="查看", p_code=person_sign.code)
    person_sign_edit = PermForm(code="person_sign_edit", name="编辑", p_code=person_sign.code)

    product = PermForm(code="product", name="产品管理/产品版本管理")
    product_view = PermForm(code="product_view", name="查看", p_code=product.code)
    product_edit = PermForm(code="product_edit", name="编辑", p_code=product.code)

    srs_doc = PermForm(code="srs_doc", name="设计文档/需求规格说明")
    srs_doc_view = PermForm(code="srs_doc_view", name="查看", p_code=srs_doc.code)
    srs_doc_edit = PermForm(code="srs_doc_edit", name="编辑", p_code=srs_doc.code)

    sds_doc = PermForm(code="sds_doc", name="设计文档/软件详细设计")
    sds_doc_view = PermForm(code="sds_doc_view", name="查看", p_code=sds_doc.code)
    sds_doc_edit = PermForm(code="sds_doc_edit", name="编辑", p_code=sds_doc.code)

    test_set = PermForm(code="test_set", name="测试管理/测试集管理")
    test_set_view = PermForm(code="test_set_view", name="查看", p_code=test_set.code)
    test_set_edit = PermForm(code="test_set_edit", name="编辑", p_code=test_set.code)

    test_case = PermForm(code="test_case", name="测试管理/测试用例管理")
    test_case_view = PermForm(code="test_case_view", name="查看", p_code=test_case.code)
    test_case_edit = PermForm(code="test_case_edit", name="编辑", p_code=test_case.code)

    doc_file_flow = PermForm(code="doc_file_flow", name="图表文件/流程管理")
    doc_file_flow_view = PermForm(code="doc_file_flow_view", name="查看", p_code=doc_file_flow.code)
    doc_file_flow_edit = PermForm(code="doc_file_flow_edit", name="编辑", p_code=doc_file_flow.code)

    doc_file_topo = PermForm(code="doc_file_topo", name="图表文件/拓扑管理")
    doc_file_topo_view = PermForm(code="doc_file_topo_view", name="查看", p_code=doc_file_topo.code)
    doc_file_topo_edit = PermForm(code="doc_file_topo_edit", name="编辑", p_code=doc_file_topo.code)

    doc_file_struct = PermForm(code="doc_file_struct", name="图表文件/结构管理")
    doc_file_struct_view = PermForm(code="doc_file_struct_view", name="查看", p_code=doc_file_struct.code)
    doc_file_struct_edit = PermForm(code="doc_file_struct_edit", name="编辑", p_code=doc_file_struct.code)

    doc_file_ui = PermForm(code="doc_file_ui", name="图表文件/用户界面关系图管理")
    doc_file_ui_view = PermForm(code="doc_file_ui_view", name="查看", p_code=doc_file_ui.code)
    doc_file_ui_edit = PermForm(code="doc_file_ui_edit", name="编辑", p_code=doc_file_ui.code)

    doc_file_home = PermForm(code="doc_file_home", name="图表文件/主页面图示管理")
    doc_file_home_view = PermForm(code="doc_file_home_view", name="查看", p_code=doc_file_home.code)
    doc_file_home_edit = PermForm(code="doc_file_home_edit", name="编辑", p_code=doc_file_home.code)

    prod_haz = PermForm(code="prod_haz", name="产品版本/产品HAZ管理")
    prod_haz_view = PermForm(code="prod_haz_view", name="查看", p_code=prod_haz.code)
    prod_haz_edit = PermForm(code="prod_haz_edit", name="编辑", p_code=prod_haz.code)

    prod_rcm = PermForm(code="prod_rcm", name="产品版本/产品RCM管理")
    prod_rcm_view = PermForm(code="prod_rcm_view", name="查看", p_code=prod_rcm.code)
    prod_rcm_edit = PermForm(code="prod_rcm_edit", name="编辑", p_code=prod_rcm.code)

    prod_cst = PermForm(code="prod_cst", name="产品版本/产品CST管理")
    prod_cst_view = PermForm(code="prod_cst_view", name="查看", p_code=prod_cst.code)
    prod_cst_edit = PermForm(code="prod_cst_edit", name="编辑", p_code=prod_cst.code)

    prod_dhf = PermForm(code="prod_dhf", name="产品版本/产品DHF管理")
    prod_dhf_view = PermForm(code="prod_dhf_view", name="查看", p_code=prod_dhf.code)
    prod_dhf_edit = PermForm(code="prod_dhf_edit", name="编辑", p_code=prod_dhf.code)

    risk_mgmt_doc = PermForm(code="risk_mgmt_doc", name="风险管理/风险管理报告")
    risk_mgmt_doc_view = PermForm(code="risk_mgmt_doc_view", name="查看", p_code=risk_mgmt_doc.code)
    risk_mgmt_doc_edit = PermForm(code="risk_mgmt_doc_edit", name="编辑", p_code=risk_mgmt_doc.code)

    cybersec_doc = PermForm(code="cybersec_doc", name="网络安全管理/网络安全风险管理报告")
    cybersec_doc_view = PermForm(code="cybersec_doc_view", name="查看", p_code=cybersec_doc.code)
    cybersec_doc_edit = PermForm(code="cybersec_doc_edit", name="编辑", p_code=cybersec_doc.code)

    pdp_doc = PermForm(code="pdp_doc", name="产品文件管理/产品开发计划")
    pdp_doc_view = PermForm(code="pdp_doc_view", name="查看", p_code=pdp_doc.code)
    pdp_doc_edit = PermForm(code="pdp_doc_edit", name="编辑", p_code=pdp_doc.code)

    sd_doc = PermForm(code="sd_doc", name="开发测试文件管理/软件开发计划")
    sd_doc_view = PermForm(code="sd_doc_view", name="查看", p_code=sd_doc.code)
    sd_doc_edit = PermForm(code="sd_doc_edit", name="编辑", p_code=sd_doc.code)

    crr_doc = PermForm(code="crr_doc", name="开发测试文件管理/代码审查记录")
    crr_doc_view = PermForm(code="crr_doc_view", name="查看", p_code=crr_doc.code)
    crr_doc_edit = PermForm(code="crr_doc_edit", name="编辑", p_code=crr_doc.code)

    pir_doc = PermForm(code="pir_doc", name="产品文件管理/产品立项报告")
    pir_doc_view = PermForm(code="pir_doc_view", name="查看", p_code=pir_doc.code)
    pir_doc_edit = PermForm(code="pir_doc_edit", name="编辑", p_code=pir_doc.code)

    vuh_doc = PermForm(code="vuh_doc", name="产品管理/版本更新历史")
    vuh_doc_view = PermForm(code="vuh_doc_view", name="查看", p_code=vuh_doc.code)
    vuh_doc_edit = PermForm(code="vuh_doc_edit", name="编辑", p_code=vuh_doc.code)

    ptr_doc = PermForm(code="ptr_doc", name="产品管理/产品技术要求")
    ptr_doc_view = PermForm(code="ptr_doc_view", name="查看", p_code=ptr_doc.code)
    ptr_doc_edit = PermForm(code="ptr_doc_edit", name="编辑", p_code=ptr_doc.code)

    label_doc = PermForm(code="label_doc", name="产品文件管理/产品标签样稿")
    label_doc_view = PermForm(code="label_doc_view", name="查看", p_code=label_doc.code)
    label_doc_edit = PermForm(code="label_doc_edit", name="编辑", p_code=label_doc.code)

    release_note = PermForm(code="release_note", name="产品文件管理/产品发布说明")
    release_note_view = PermForm(code="release_note_view", name="查看", p_code=release_note.code)
    release_note_edit = PermForm(code="release_note_edit", name="编辑", p_code=release_note.code)

    pha_doc = PermForm(code="pha_doc", name="产品文件管理/初步危害分析清单")
    pha_doc_view = PermForm(code="pha_doc_view", name="查看", p_code=pha_doc.code)
    pha_doc_edit = PermForm(code="pha_doc_edit", name="编辑", p_code=pha_doc.code)

    cyber_cap_doc = PermForm(code="cyber_cap_doc", name="产品文件管理/网络安全能力分析")
    cyber_cap_doc_view = PermForm(code="cyber_cap_doc_view", name="查看", p_code=cyber_cap_doc.code)
    cyber_cap_doc_edit = PermForm(code="cyber_cap_doc_edit", name="编辑", p_code=cyber_cap_doc.code)

    research_doc = PermForm(code="research_doc", name="产品文件管理/自研软件研究报告")
    research_doc_view = PermForm(code="research_doc_view", name="查看", p_code=research_doc.code)
    research_doc_edit = PermForm(code="research_doc_edit", name="编辑", p_code=research_doc.code)

    nsr_doc = PermForm(code="nsr_doc", name="产品文件管理/自研软件网络安全研究报告")
    nsr_doc_view = PermForm(code="nsr_doc_view", name="查看", p_code=nsr_doc.code)
    nsr_doc_edit = PermForm(code="nsr_doc_edit", name="编辑", p_code=nsr_doc.code)

    acc_doc = PermForm(code="acc_doc", name="产品文件管理/产品验收记录")
    acc_doc_view = PermForm(code="acc_doc_view", name="查看", p_code=acc_doc.code)
    acc_doc_edit = PermForm(code="acc_doc_edit", name="编辑", p_code=acc_doc.code)

    nsmp_doc = PermForm(code="nsmp_doc", name="产品文件管理/网络安全维护计划")
    nsmp_doc_view = PermForm(code="nsmp_doc_view", name="查看", p_code=nsmp_doc.code)
    nsmp_doc_edit = PermForm(code="nsmp_doc_edit", name="编辑", p_code=nsmp_doc.code)

    rmp_doc = PermForm(code="rmp_doc", name="产品文件管理/风险管理计划")
    rmp_doc_view = PermForm(code="rmp_doc_view", name="查看", p_code=rmp_doc.code)
    rmp_doc_edit = PermForm(code="rmp_doc_edit", name="编辑", p_code=rmp_doc.code)


class RoleForm(BaseModel):
    id: Optional[int] = Field(title="角色ID")
    code: Optional[str] = Field(title="角色编码")
    name: Optional[str] = Field(title="角色名称")
    role_perms: Optional[list[str]] = Field(title="权限列表")


class Roles(Enum):
    root = RoleForm(code="root", name="超级管理员")
    dqa = RoleForm(code="dqa", name="DQA")
    qa = RoleForm(code="qa", name="QA")
    ra = RoleForm(code="ra", name="RA")
    product_manager = RoleForm(code="product_manager", name="产品经理")
    developer = RoleForm(code="developer", name="开发人员")
    tester = RoleForm(code="tester", name="测试人员")


def get_all_perm_codes():
    return [perm.value.code for perm in Perms]


def get_default_role_perm_codes():
    all_perms = set(get_all_perm_codes())
    ra_perms = {
        "srs_doc", "srs_doc_view", "srs_doc_edit",
        "sds_doc", "sds_doc_view", "sds_doc_edit",
        "risk_mgmt_doc", "risk_mgmt_doc_view", "risk_mgmt_doc_edit",
        "cybersec_doc", "cybersec_doc_view", "cybersec_doc_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
    }
    product_manager_perms = {
        "project_member", "project_member_view", "project_member_edit",
        "project_timeline", "project_timeline_view", "project_timeline_edit",
        "prod_runtime", "prod_runtime_view", "prod_runtime_edit",
        "prod_device", "prod_device_view", "prod_device_edit",
        "product", "product_view", "product_edit",
        "srs_doc", "srs_doc_view", "srs_doc_edit",
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "doc_file_ui", "doc_file_ui_view", "doc_file_ui_edit",
        "doc_file_home", "doc_file_home_view", "doc_file_home_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
        "risk_mgmt_doc", "risk_mgmt_doc_view", "risk_mgmt_doc_edit",
        "cybersec_doc", "cybersec_doc_view", "cybersec_doc_edit",
        "pdp_doc", "pdp_doc_view", "pdp_doc_edit",
        "sd_doc", "sd_doc_view", "sd_doc_edit",
        "crr_doc", "crr_doc_view", "crr_doc_edit",
        "pir_doc", "pir_doc_view", "pir_doc_edit",
        "vuh_doc", "vuh_doc_view", "vuh_doc_edit",
        "ptr_doc", "ptr_doc_view", "ptr_doc_edit",
        "label_doc", "label_doc_view", "label_doc_edit",
        "release_note", "release_note_view", "release_note_edit",
        "pha_doc", "pha_doc_view", "pha_doc_edit",
        "cyber_cap_doc", "cyber_cap_doc_view", "cyber_cap_doc_edit",
        "research_doc", "research_doc_view", "research_doc_edit",
        "nsr_doc", "nsr_doc_view", "nsr_doc_edit",
        "acc_doc", "acc_doc_view", "acc_doc_edit",
        "nsmp_doc", "nsmp_doc_view", "nsmp_doc_edit",
        "rmp_doc", "rmp_doc_view", "rmp_doc_edit",
    }
    developer_perms = {
        "sds_doc", "sds_doc_view", "sds_doc_edit",
        "sd_doc", "sd_doc_view", "sd_doc_edit",
        "crr_doc", "crr_doc_view", "crr_doc_edit",
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "doc_file_ui", "doc_file_ui_view", "doc_file_ui_edit",
        "doc_file_home", "doc_file_home_view", "doc_file_home_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
        "product", "product_view",
        "risk_mgmt_doc", "risk_mgmt_doc_view", "risk_mgmt_doc_edit",
        "cybersec_doc", "cybersec_doc_view", "cybersec_doc_edit",
    }
    tester_perms = {
        "prod_dhf", "prod_dhf_view", "prod_dhf_edit",
        "sds_doc", "sds_doc_view", "sds_doc_edit",
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "doc_file_ui", "doc_file_ui_view", "doc_file_ui_edit",
        "doc_file_home", "doc_file_home_view", "doc_file_home_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
        "product", "product_view",
        "risk_mgmt_doc", "risk_mgmt_doc_view", "risk_mgmt_doc_edit",
        "cybersec_doc", "cybersec_doc_view", "cybersec_doc_edit",
    }
    return {
        Roles.root.value.code: sorted(all_perms),
        Roles.dqa.value.code: sorted(all_perms),
        Roles.qa.value.code: sorted(all_perms),
        Roles.ra.value.code: sorted(ra_perms),
        Roles.product_manager.value.code: sorted(product_manager_perms),
        Roles.developer.value.code: sorted(developer_perms),
        Roles.tester.value.code: sorted(tester_perms),
    }


def get_fixed_role_codes():
    return [role.value.code for role in Roles]