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

    role = PermForm(code="role", name="系统配置/角色管理")
    role_view = PermForm(code="role_view", name="查看", p_code=role.code)
    role_edit = PermForm(code="role_edit", name="编辑", p_code=role.code)

    user = PermForm(code="user", name="系统配置/用户管理")
    user_view = PermForm(code="user_view", name="查看", p_code=user.code)
    user_edit = PermForm(code="user_edit", name="编辑", p_code=user.code)

    project = PermForm(code="project", name="系统配置/产品线管理")
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

    cst = PermForm(code="cst", name="基础数据/THREAT管理")
    cst_view = PermForm(code="cst_view", name="查看", p_code=cst.code)
    cst_edit = PermForm(code="cst_edit", name="编辑", p_code=cst.code)

    version_rule = PermForm(code="version_rule", name="基础配置/版本命名规则")
    version_rule_edit = PermForm(code="version_rule_edit", name="编辑", p_code=version_rule.code)

    company_info = PermForm(code="company_info", name="基础配置/公司基本信息")
    company_info_view = PermForm(code="company_info_view", name="查看", p_code=company_info.code)
    company_info_edit = PermForm(code="company_info_edit", name="编辑", p_code=company_info.code)

    person_sign = PermForm(code="person_sign", name="基础配置/人员签名管理")
    person_sign_view = PermForm(code="person_sign_view", name="查看", p_code=person_sign.code)
    person_sign_edit = PermForm(code="person_sign_edit", name="编辑", p_code=person_sign.code)

    print_cfg = PermForm(code="print_cfg", name="基础配置/打印服务配置")
    print_cfg_view = PermForm(code="print_cfg_view", name="查看", p_code=print_cfg.code)
    print_cfg_edit = PermForm(code="print_cfg_edit", name="编辑", p_code=print_cfg.code)

    product = PermForm(code="product", name="产品管理/产品版本管理")
    product_view = PermForm(code="product_view", name="查看", p_code=product.code)
    product_edit = PermForm(code="product_edit", name="编辑", p_code=product.code)

    srs_doc = PermForm(code="srs_doc", name="产品文件管理/需求规格说明")
    srs_doc_view = PermForm(code="srs_doc_view", name="查看", p_code=srs_doc.code)
    srs_doc_edit = PermForm(code="srs_doc_edit", name="编辑", p_code=srs_doc.code)

    sds_doc = PermForm(code="sds_doc", name="开发测试文件管理/开发文件/软件详细设计")
    sds_doc_view = PermForm(code="sds_doc_view", name="查看", p_code=sds_doc.code)
    sds_doc_edit = PermForm(code="sds_doc_edit", name="编辑", p_code=sds_doc.code)

    hld_doc = PermForm(code="hld_doc", name="开发测试文件管理/开发文件/软件概要设计")
    hld_doc_view = PermForm(code="hld_doc_view", name="查看", p_code=hld_doc.code)
    hld_doc_edit = PermForm(code="hld_doc_edit", name="编辑", p_code=hld_doc.code)

    test_set = PermForm(code="test_set", name="开发测试文件管理/测试文件/测试用例合集")
    test_set_view = PermForm(code="test_set_view", name="查看", p_code=test_set.code)
    test_set_edit = PermForm(code="test_set_edit", name="编辑", p_code=test_set.code)

    test_case = PermForm(code="test_case", name="开发测试文件管理/测试文件/测试用例管理")
    test_case_view = PermForm(code="test_case_view", name="查看", p_code=test_case.code)
    test_case_edit = PermForm(code="test_case_edit", name="编辑", p_code=test_case.code)

    doc_file_flow = PermForm(code="doc_file_flow", name="产品图示/网络安全流程图")
    doc_file_flow_view = PermForm(code="doc_file_flow_view", name="查看", p_code=doc_file_flow.code)
    doc_file_flow_edit = PermForm(code="doc_file_flow_edit", name="编辑", p_code=doc_file_flow.code)

    doc_file_topo = PermForm(code="doc_file_topo", name="产品图示/物理拓扑图")
    doc_file_topo_view = PermForm(code="doc_file_topo_view", name="查看", p_code=doc_file_topo.code)
    doc_file_topo_edit = PermForm(code="doc_file_topo_edit", name="编辑", p_code=doc_file_topo.code)

    doc_file_struct = PermForm(code="doc_file_struct", name="产品图示/体系结构图")
    doc_file_struct_view = PermForm(code="doc_file_struct_view", name="查看", p_code=doc_file_struct.code)
    doc_file_struct_edit = PermForm(code="doc_file_struct_edit", name="编辑", p_code=doc_file_struct.code)

    doc_file_ui = PermForm(code="doc_file_ui", name="产品图示/用户界面关系图")
    doc_file_ui_view = PermForm(code="doc_file_ui_view", name="查看", p_code=doc_file_ui.code)
    doc_file_ui_edit = PermForm(code="doc_file_ui_edit", name="编辑", p_code=doc_file_ui.code)

    doc_file_home = PermForm(code="doc_file_home", name="产品图示/主页面图示管理")
    doc_file_home_view = PermForm(code="doc_file_home_view", name="查看", p_code=doc_file_home.code)
    doc_file_home_edit = PermForm(code="doc_file_home_edit", name="编辑", p_code=doc_file_home.code)

    prod_haz = PermForm(code="prod_haz", name="产品管理/风险管理/产品HAZ管理")
    prod_haz_view = PermForm(code="prod_haz_view", name="查看", p_code=prod_haz.code)
    prod_haz_edit = PermForm(code="prod_haz_edit", name="编辑", p_code=prod_haz.code)

    prod_rcm = PermForm(code="prod_rcm", name="产品管理/风险管理/产品RCM管理")
    prod_rcm_view = PermForm(code="prod_rcm_view", name="查看", p_code=prod_rcm.code)
    prod_rcm_edit = PermForm(code="prod_rcm_edit", name="编辑", p_code=prod_rcm.code)

    prod_cst = PermForm(code="prod_cst", name="产品管理/风险管理/产品THREAT管理")
    prod_cst_view = PermForm(code="prod_cst_view", name="查看", p_code=prod_cst.code)
    prod_cst_edit = PermForm(code="prod_cst_edit", name="编辑", p_code=prod_cst.code)

    prod_dhf = PermForm(code="prod_dhf", name="产品文件管理/产品DHF管理")
    prod_dhf_view = PermForm(code="prod_dhf_view", name="查看", p_code=prod_dhf.code)
    prod_dhf_edit = PermForm(code="prod_dhf_edit", name="编辑", p_code=prod_dhf.code)

    risk_mgmt_doc = PermForm(code="risk_mgmt_doc", name="产品文件管理/风险管理报告")
    risk_mgmt_doc_view = PermForm(code="risk_mgmt_doc_view", name="查看", p_code=risk_mgmt_doc.code)
    risk_mgmt_doc_edit = PermForm(code="risk_mgmt_doc_edit", name="编辑", p_code=risk_mgmt_doc.code)

    cybersec_doc = PermForm(code="cybersec_doc", name="开发测试文件管理/网络安全管理/网络安全风险管理报告")
    cybersec_doc_view = PermForm(code="cybersec_doc_view", name="查看", p_code=cybersec_doc.code)
    cybersec_doc_edit = PermForm(code="cybersec_doc_edit", name="编辑", p_code=cybersec_doc.code)

    cybersec_plan_doc = PermForm(code="cybersec_plan_doc", name="开发测试文件管理/网络安全管理/网络安全风险管理计划")
    cybersec_plan_doc_view = PermForm(code="cybersec_plan_doc_view", name="查看", p_code=cybersec_plan_doc.code)
    cybersec_plan_doc_edit = PermForm(code="cybersec_plan_doc_edit", name="编辑", p_code=cybersec_plan_doc.code)

    pdp_doc = PermForm(code="pdp_doc", name="产品文件管理/产品开发计划")
    pdp_doc_view = PermForm(code="pdp_doc_view", name="查看", p_code=pdp_doc.code)
    pdp_doc_edit = PermForm(code="pdp_doc_edit", name="编辑", p_code=pdp_doc.code)

    sd_doc = PermForm(code="sd_doc", name="开发测试文件管理/软件开发计划")
    sd_doc_view = PermForm(code="sd_doc_view", name="查看", p_code=sd_doc.code)
    sd_doc_edit = PermForm(code="sd_doc_edit", name="编辑", p_code=sd_doc.code)

    crr_doc = PermForm(code="crr_doc", name="开发测试文件管理/代码审查记录")
    crr_doc_view = PermForm(code="crr_doc_view", name="查看", p_code=crr_doc.code)
    crr_doc_edit = PermForm(code="crr_doc_edit", name="编辑", p_code=crr_doc.code)

    dem_doc = PermForm(code="dem_doc", name="开发测试文件管理/开发环境维护说明")
    dem_doc_view = PermForm(code="dem_doc_view", name="查看", p_code=dem_doc.code)
    dem_doc_edit = PermForm(code="dem_doc_edit", name="编辑", p_code=dem_doc.code)

    deq_doc = PermForm(code="deq_doc", name="开发测试文件管理/开发设备清单")
    deq_doc_view = PermForm(code="deq_doc_view", name="查看", p_code=deq_doc.code)
    deq_doc_edit = PermForm(code="deq_doc_edit", name="编辑", p_code=deq_doc.code)

    scm_doc = PermForm(code="scm_doc", name="开发测试文件管理/软件配置管理计划")
    scm_doc_view = PermForm(code="scm_doc_view", name="查看", p_code=scm_doc.code)
    scm_doc_edit = PermForm(code="scm_doc_edit", name="编辑", p_code=scm_doc.code)

    scs_doc = PermForm(code="scs_doc", name="开发测试文件管理/软件配置状态报告")
    scs_doc_view = PermForm(code="scs_doc_view", name="查看", p_code=scs_doc.code)
    scs_doc_edit = PermForm(code="scs_doc_edit", name="编辑", p_code=scs_doc.code)

    dat_doc = PermForm(code="dat_doc", name="开发测试文件管理/数据申请单")
    dat_doc_view = PermForm(code="dat_doc_view", name="查看", p_code=dat_doc.code)
    dat_doc_edit = PermForm(code="dat_doc_edit", name="编辑", p_code=dat_doc.code)

    stp_doc = PermForm(code="stp_doc", name="开发测试文件管理/软件测试计划")
    stp_doc_view = PermForm(code="stp_doc_view", name="查看", p_code=stp_doc.code)
    stp_doc_edit = PermForm(code="stp_doc_edit", name="编辑", p_code=stp_doc.code)

    utp_doc = PermForm(code="utp_doc", name="开发测试文件管理/用户测试计划")
    utp_doc_view = PermForm(code="utp_doc_view", name="查看", p_code=utp_doc.code)
    utp_doc_edit = PermForm(code="utp_doc_edit", name="编辑", p_code=utp_doc.code)

    utr_doc = PermForm(code="utr_doc", name="开发测试文件管理/用户测试报告")
    utr_doc_view = PermForm(code="utr_doc_view", name="查看", p_code=utr_doc.code)
    utr_doc_edit = PermForm(code="utr_doc_edit", name="编辑", p_code=utr_doc.code)

    str_doc = PermForm(code="str_doc", name="开发测试文件管理/软件测试报告")
    str_doc_view = PermForm(code="str_doc_view", name="查看", p_code=str_doc.code)
    str_doc_edit = PermForm(code="str_doc_edit", name="编辑", p_code=str_doc.code)

    bug_doc = PermForm(code="bug_doc", name="开发测试文件管理/Bug管理及回归测试")
    bug_doc_view = PermForm(code="bug_doc_view", name="查看", p_code=bug_doc.code)
    bug_doc_edit = PermForm(code="bug_doc_edit", name="编辑", p_code=bug_doc.code)

    teq_doc = PermForm(code="teq_doc", name="开发测试文件管理/测试设备清单")
    teq_doc_view = PermForm(code="teq_doc_view", name="查看", p_code=teq_doc.code)
    teq_doc_edit = PermForm(code="teq_doc_edit", name="编辑", p_code=teq_doc.code)

    tem_doc = PermForm(code="tem_doc", name="开发测试文件管理/测试环境维护说明")
    tem_doc_view = PermForm(code="tem_doc_view", name="查看", p_code=tem_doc.code)
    tem_doc_edit = PermForm(code="tem_doc_edit", name="编辑", p_code=tem_doc.code)

    imm_doc = PermForm(code="imm_doc", name="开发测试文件管理/安装维护手册")
    imm_doc_view = PermForm(code="imm_doc_view", name="查看", p_code=imm_doc.code)
    imm_doc_edit = PermForm(code="imm_doc_edit", name="编辑", p_code=imm_doc.code)

    ftr_doc = PermForm(code="ftr_doc", name="开发测试文件管理/现场测试规程")
    ftr_doc_view = PermForm(code="ftr_doc_view", name="查看", p_code=ftr_doc.code)
    ftr_doc_edit = PermForm(code="ftr_doc_edit", name="编辑", p_code=ftr_doc.code)

    ftr_record_doc = PermForm(code="ftr_record_doc", name="开发测试文件管理/现场测试记录")
    ftr_record_doc_view = PermForm(code="ftr_record_doc_view", name="查看", p_code=ftr_record_doc.code)
    ftr_record_doc_edit = PermForm(code="ftr_record_doc_edit", name="编辑", p_code=ftr_record_doc.code)

    pir_doc = PermForm(code="pir_doc", name="产品文件管理/产品立项报告")
    pir_doc_view = PermForm(code="pir_doc_view", name="查看", p_code=pir_doc.code)
    pir_doc_edit = PermForm(code="pir_doc_edit", name="编辑", p_code=pir_doc.code)

    model_doc = PermForm(code="model_doc", name="模型文件")
    model_doc_view = PermForm(code="model_doc_view", name="查看", p_code=model_doc.code)
    model_doc_edit = PermForm(code="model_doc_edit", name="编辑", p_code=model_doc.code)

    data_doc = PermForm(code="data_doc", name="数据文件")
    data_doc_view = PermForm(code="data_doc_view", name="查看", p_code=data_doc.code)
    data_doc_edit = PermForm(code="data_doc_edit", name="编辑", p_code=data_doc.code)

    vuh_doc = PermForm(code="vuh_doc", name="产品文件管理/版本更新历史")
    vuh_doc_view = PermForm(code="vuh_doc_view", name="查看", p_code=vuh_doc.code)
    vuh_doc_edit = PermForm(code="vuh_doc_edit", name="编辑", p_code=vuh_doc.code)

    ptr_doc = PermForm(code="ptr_doc", name="产品文件管理/产品技术要求")
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

    # 产品文件管理权限
    product_file_perms = {
        "srs_doc", "srs_doc_view", "srs_doc_edit",
        "pdp_doc", "pdp_doc_view", "pdp_doc_edit",
        "pir_doc", "pir_doc_view", "pir_doc_edit",
        "acc_doc", "acc_doc_view", "acc_doc_edit",
        "release_note", "release_note_view", "release_note_edit",
        "vuh_doc", "vuh_doc_view", "vuh_doc_edit",
        "ptr_doc", "ptr_doc_view", "ptr_doc_edit",
        "research_doc", "research_doc_view", "research_doc_edit",
        "rmp_doc", "rmp_doc_view", "rmp_doc_edit",
        "pha_doc", "pha_doc_view", "pha_doc_edit",
        "nsr_doc", "nsr_doc_view", "nsr_doc_edit",
        "cyber_cap_doc", "cyber_cap_doc_view", "cyber_cap_doc_edit",
        "label_doc", "label_doc_view", "label_doc_edit",
        "nsmp_doc", "nsmp_doc_view", "nsmp_doc_edit",
        "risk_mgmt_doc", "risk_mgmt_doc_view", "risk_mgmt_doc_edit",
        "prod_dhf", "prod_dhf_view", "prod_dhf_edit",
        "model_doc", "model_doc_view", "model_doc_edit",
        "data_doc", "data_doc_view", "data_doc_edit",
    }

    # 开发测试文件管理权限
    dev_test_file_perms = {
        "sds_doc", "sds_doc_view", "sds_doc_edit",
        "hld_doc", "hld_doc_view", "hld_doc_edit",
        "sd_doc", "sd_doc_view", "sd_doc_edit",
        "crr_doc", "crr_doc_view", "crr_doc_edit",
        "dem_doc", "dem_doc_view", "dem_doc_edit",
        "deq_doc", "deq_doc_view", "deq_doc_edit",
        "scm_doc", "scm_doc_view", "scm_doc_edit",
        "scs_doc", "scs_doc_view", "scs_doc_edit",
        "dat_doc", "dat_doc_view", "dat_doc_edit",
        "stp_doc", "stp_doc_view", "stp_doc_edit",
        "utp_doc", "utp_doc_view", "utp_doc_edit",
        "utr_doc", "utr_doc_view", "utr_doc_edit",
        "str_doc", "str_doc_view", "str_doc_edit",
        "bug_doc", "bug_doc_view", "bug_doc_edit",
        "teq_doc", "teq_doc_view", "teq_doc_edit",
        "tem_doc", "tem_doc_view", "tem_doc_edit",
        "imm_doc", "imm_doc_view", "imm_doc_edit",
        "ftr_doc", "ftr_doc_view", "ftr_doc_edit",
        "ftr_record_doc", "ftr_record_doc_view", "ftr_record_doc_edit",
        "test_set", "test_set_view", "test_set_edit",
        "test_case", "test_case_view", "test_case_edit",
    }

    # 产品管理权限（产品经理可编辑）
    product_mgmt_perms_edit = {
        "product", "product_view", "product_edit",
        "project_member", "project_member_view", "project_member_edit",
        "project_timeline", "project_timeline_view", "project_timeline_edit",
        "prod_runtime", "prod_runtime_view", "prod_runtime_edit",
        "prod_device", "prod_device_view", "prod_device_edit",
    }

    # 产品管理权限（开发/测试/RA仅查看）
    product_mgmt_perms_view = {
        "product", "product_view",
        "project_member", "project_member_view",
        "project_timeline", "project_timeline_view",
        "prod_runtime", "prod_runtime_view",
        "prod_device", "prod_device_view",
    }

    # 风险追溯管理权限
    risk_trace_perms = {
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
    }

    # 图表文件管理权限
    doc_file_perms = {
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "doc_file_ui", "doc_file_ui_view", "doc_file_ui_edit",
        "doc_file_home", "doc_file_home_view", "doc_file_home_edit",
    }

    # 网络安全管理权限
    cybersec_perms = {
        "cybersec_doc", "cybersec_doc_view", "cybersec_doc_edit",
        "cybersec_plan_doc", "cybersec_plan_doc_view", "cybersec_plan_doc_edit",
    }

    # 产品经理：产品管理可编辑 + 产品文件管理 + 图表文件管理 + 风险追溯管理
    product_manager_perms = product_mgmt_perms_edit | product_file_perms | doc_file_perms | risk_trace_perms

    # 开发人员/测试人员/RA：可以看到产品（仅查看）、开发、测试文件（+ 图表文件 + 网络安全 + 风险追溯）
    dev_tester_ra_perms = product_mgmt_perms_view | product_file_perms | dev_test_file_perms | doc_file_perms | cybersec_perms | risk_trace_perms

    return {
        Roles.root.value.code: sorted(all_perms),
        Roles.dqa.value.code: sorted(all_perms),
        Roles.qa.value.code: sorted(all_perms),
        Roles.ra.value.code: sorted(dev_tester_ra_perms),
        Roles.product_manager.value.code: sorted(product_manager_perms),
        Roles.developer.value.code: sorted(dev_tester_ra_perms),
        Roles.tester.value.code: sorted(dev_tester_ra_perms),
    }


def get_fixed_role_codes():
    return [role.value.code for role in Roles]