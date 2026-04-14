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

    haz = PermForm(code="haz", name="基础数据/HAZ管理")
    haz_view = PermForm(code="haz_view", name="查看", p_code=haz.code)
    haz_edit = PermForm(code="haz_edit", name="编辑", p_code=haz.code)

    rcm = PermForm(code="rcm", name="基础数据/RCM管理")
    rcm_view = PermForm(code="rcm_view", name="查看", p_code=rcm.code)
    rcm_edit = PermForm(code="rcm_edit", name="编辑", p_code=rcm.code)

    cst = PermForm(code="cst", name="基础数据/CST管理")
    cst_view = PermForm(code="cst_view", name="查看", p_code=cst.code)
    cst_edit = PermForm(code="cst_edit", name="编辑", p_code=cst.code)

    product = PermForm(code="product", name="产品版本/产品管理")
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
    product_manager_perms = {
        "product", "product_view", "product_edit",
        "srs_doc", "srs_doc_view", "srs_doc_edit",
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
    }
    developer_perms = {
        "sds_doc", "sds_doc_view", "sds_doc_edit",
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
        "product", "product_view",
    }
    tester_perms = {
        "prod_dhf", "prod_dhf_view", "prod_dhf_edit",
        "sds_doc", "sds_doc_view", "sds_doc_edit",
        "doc_file_flow", "doc_file_flow_view", "doc_file_flow_edit",
        "doc_file_topo", "doc_file_topo_view", "doc_file_topo_edit",
        "doc_file_struct", "doc_file_struct_view", "doc_file_struct_edit",
        "prod_haz", "prod_haz_view", "prod_haz_edit",
        "prod_rcm", "prod_rcm_view", "prod_rcm_edit",
        "prod_cst", "prod_cst_view", "prod_cst_edit",
        "product", "product_view",
    }
    return {
        Roles.root.value.code: sorted(all_perms),
        Roles.dqa.value.code: sorted(all_perms),
        Roles.qa.value.code: sorted(all_perms),
        Roles.ra.value.code: sorted(all_perms),
        Roles.product_manager.value.code: sorted(product_manager_perms),
        Roles.developer.value.code: sorted(developer_perms),
        Roles.tester.value.code: sorted(tester_perms),
    }


def get_fixed_role_codes():
    return [role.value.code for role in Roles]