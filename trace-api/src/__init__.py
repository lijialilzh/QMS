#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import logging
from fastapi import applications, FastAPI, APIRouter, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_swagger_ui_html
from sqlalchemy import create_engine
from starlette import status
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from starlette_session import SessionMiddleware
from starlette.middleware.cors import CORSMiddleware
from .obj import Resp
from . import env
from .api import web_auth, web_session, api_user, api_role, api_project, api_haz, api_rcm, api_cst, api_product, \
    api_srs_doc, api_sds_doc, api_test_set, api_test_case, api_doc_file_flow, api_doc_file_topo, api_doc_file_struct, api_doc_file_ui, api_doc_file_home, \
    api_prod_haz, api_prod_rcm, api_prod_cst, api_srs_req, api_srs_reqd, api_prod_dhf, api_sds_reqd, api_sds_trace, \
    api_srs_type, api_doc_file, api_risk_mgmt_doc, api_cybersec_doc, api_ai_support, \
    api_project_member, api_project_timeline, api_prod_runtime_env, api_prod_device_res, api_pdp_doc, api_pir_doc, \
    api_model_doc, api_data_doc, \
    api_vuh_doc, api_version_rule, api_ptr_doc, api_company_info, api_label_doc, api_release_note, api_pha_doc, \
    api_cyber_cap_doc, api_research_doc, api_nsr_doc, api_acc_doc, api_nsmp_doc, api_rmp_doc, api_sd_doc, \
    api_crr_doc, api_dem_doc, api_deq_doc, api_scm_doc, api_scs_doc, api_dat_doc, api_stp_doc, api_utp_doc, \
    api_utr_doc, api_str_doc, api_bug_doc, api_teq_doc, api_tem_doc, api_imm_doc, api_hld_doc, api_ftr_doc, api_ftr_record_doc, api_train_record_doc, api_person_sign, \
    api_doc_integrate, api_print_cfg, api_doc_compare, \
    api_cybersec_plan_doc
from .utils import read_line
from .utils.i18n import ts
from .utils.sql_middleware import SQLAlchemyMiddleware

logger = logging.getLogger(__name__)

context_path = "/trace-api"

WITE_LIST = [
    "/.well-known/appspecific",
    f"{context_path}/src-res",
    f"{context_path}/user/login",
    f"{context_path}/user/logout"]


def __exception_handler(request: Request, exc: Exception):
    logger.exception("", exc_info=exc)
    if isinstance(exc, RequestValidationError):
        error = exc.errors()[0].get("loc") or []
        error = error[-1] if error else ""
        return JSONResponse(status_code=status.HTTP_200_OK, content=Resp.resp_err(msg=f"{ts('msg_err_param')}:{error}").dict())
    return JSONResponse(status_code=status.HTTP_200_OK, content=Resp.resp_err().dict())


def __get_swagger_ui_html(*args, **kwargs):
    return get_swagger_ui_html(
        *args,
        **kwargs,
        swagger_js_url=f"{context_path}/src-res/swagger-ui-bundle.js",
        swagger_css_url=f"{context_path}/src-res/swagger-ui.css",
    )

def create_app():
    applications.get_swagger_ui_html = __get_swagger_ui_html
    app = FastAPI(
        version=read_line(".version", "0.0.1"),
        title="接口文档",
        description=Resp.__doc__,
        docs_url=f"{context_path}/docs",
        redoc_url=f"{context_path}/redoc",
        openapi_url=f"{context_path}/openapi"
    )

    app.add_middleware(web_auth.AuthMiddleware, whitelist={app.docs_url, app.redoc_url, app.openapi_url, *WITE_LIST})
    app.add_middleware(SessionMiddleware, custom_session_backend=web_session.DbBackend(), 
                       backend_type="db", secret_key="tx", cookie_name="tx-session", max_age=24 * 60 * 60)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)
    app.add_middleware(SQLAlchemyMiddleware, custom_engine=create_engine(env.DB_URL, echo=False, pool_recycle=3600))

    app.add_exception_handler(RequestValidationError, __exception_handler)
    app.add_exception_handler(Exception, __exception_handler)

    main_router = APIRouter()
    main_router.include_router(api_user.router, prefix="/user", tags=["用户"])
    main_router.include_router(api_role.router, prefix="/role", tags=["角色"])
    main_router.include_router(api_project.router, prefix="/project", tags=["项目"])
    main_router.include_router(api_project_member.router, prefix="/project_member", tags=["项目人员"])
    main_router.include_router(api_project_timeline.router, prefix="/project_timeline", tags=["项目时间逻辑线"])
    main_router.include_router(api_prod_runtime_env.router, prefix="/prod_runtime_env", tags=["运行环境"])
    main_router.include_router(api_prod_device_res.router, prefix="/prod_device_res", tags=["设备资源"])
    main_router.include_router(api_pdp_doc.router, prefix="/pdp_doc", tags=["产品开发计划"])
    main_router.include_router(api_pir_doc.router, prefix="/pir_doc", tags=["产品立项报告"])
    main_router.include_router(api_model_doc.router, prefix="/model_doc", tags=["模型文件"])
    main_router.include_router(api_data_doc.router, prefix="/data_doc", tags=["数据文件"])
    main_router.include_router(api_vuh_doc.router, prefix="/vuh_doc", tags=["版本更新历史"])
    main_router.include_router(api_version_rule.router, prefix="/version_rule", tags=["版本命名规则"])
    main_router.include_router(api_ptr_doc.router, prefix="/ptr_doc", tags=["产品技术要求"])
    main_router.include_router(api_company_info.router, prefix="/company_info", tags=["公司基本信息"])
    main_router.include_router(api_label_doc.router, prefix="/label_doc", tags=["产品标签样稿"])
    main_router.include_router(api_release_note.router, prefix="/release_note", tags=["产品发布说明"])
    main_router.include_router(api_pha_doc.router, prefix="/pha_doc", tags=["初步危害分析清单"])
    main_router.include_router(api_cyber_cap_doc.router, prefix="/cyber_cap_doc", tags=["网络安全能力分析"])
    main_router.include_router(api_research_doc.router, prefix="/research_doc", tags=["自研软件研究报告"])
    main_router.include_router(api_nsr_doc.router, prefix="/nsr_doc", tags=["自研软件网络安全研究报告"])
    main_router.include_router(api_acc_doc.router, prefix="/acc_doc", tags=["产品验收记录"])
    main_router.include_router(api_nsmp_doc.router, prefix="/nsmp_doc", tags=["网络安全维护计划"])
    main_router.include_router(api_rmp_doc.router, prefix="/rmp_doc", tags=["风险管理计划"])
    main_router.include_router(api_sd_doc.router, prefix="/sd_doc", tags=["软件开发计划"])
    main_router.include_router(api_crr_doc.router, prefix="/crr_doc", tags=["代码审查记录"])
    main_router.include_router(api_dem_doc.router, prefix="/dem_doc", tags=["开发环境维护说明"])
    main_router.include_router(api_deq_doc.router, prefix="/deq_doc", tags=["开发设备清单"])
    main_router.include_router(api_scm_doc.router, prefix="/scm_doc", tags=["软件配置管理计划"])
    main_router.include_router(api_scs_doc.router, prefix="/scs_doc", tags=["软件配置状态报告"])
    main_router.include_router(api_dat_doc.router, prefix="/dat_doc", tags=["数据申请单"])
    main_router.include_router(api_stp_doc.router, prefix="/stp_doc", tags=["软件测试计划"])
    main_router.include_router(api_utp_doc.router, prefix="/utp_doc", tags=["用户测试计划"])
    main_router.include_router(api_utr_doc.router, prefix="/utr_doc", tags=["用户测试报告"])
    main_router.include_router(api_str_doc.router, prefix="/str_doc", tags=["软件测试报告"])
    main_router.include_router(api_bug_doc.router, prefix="/bug_doc", tags=["Bug管理及回归测试"])
    main_router.include_router(api_teq_doc.router, prefix="/teq_doc", tags=["测试设备清单"])
    main_router.include_router(api_tem_doc.router, prefix="/tem_doc", tags=["测试环境维护说明"])
    main_router.include_router(api_imm_doc.router, prefix="/imm_doc", tags=["安装维护手册"])
    main_router.include_router(api_ftr_doc.router, prefix="/ftr_doc", tags=["现场测试规程"])
    main_router.include_router(api_ftr_record_doc.router, prefix="/ftr_record_doc", tags=["现场测试记录"])
    main_router.include_router(api_train_record_doc.router, prefix="/train_record_doc", tags=["培训记录表"])
    main_router.include_router(api_person_sign.router, prefix="/person_sign", tags=["人员签名管理"])
    main_router.include_router(api_doc_integrate.router, prefix="/doc_integrate", tags=["文档整合导出"])
    main_router.include_router(api_print_cfg.router, prefix="/print_cfg", tags=["打印服务配置"])
    main_router.include_router(api_doc_compare.router, prefix="/doc_compare", tags=["文档内容比对"])
    main_router.include_router(api_haz.router, prefix="/haz", tags=["HAZ"])
    main_router.include_router(api_rcm.router, prefix="/rcm", tags=["RCM"])
    main_router.include_router(api_cst.router, prefix="/cst", tags=["CST"])
    main_router.include_router(api_product.router, prefix="/product", tags=["产品"])

    main_router.include_router(api_prod_dhf.router, prefix="/prod_dhf", tags=["产品DHF"])
    
    main_router.include_router(api_srs_doc.router, prefix="/srs_doc", tags=["SRS_DOC需求规格说明"])
    main_router.include_router(api_srs_req.router, prefix="/srs_req", tags=["SRS需求"])
    main_router.include_router(api_srs_reqd.router, prefix="/srs_reqd", tags=["SRS需求细节"])
    main_router.include_router(api_srs_type.router, prefix="/srs_type", tags=["SRS类型"])

    main_router.include_router(api_sds_doc.router, prefix="/sds_doc", tags=["SDS_DOC软件详细设计"])
    main_router.include_router(api_hld_doc.router, prefix="/hld_doc", tags=["HLD_DOC软件概要设计"])
    main_router.include_router(api_sds_reqd.router, prefix="/sds_reqd", tags=["SDS需求细节"])
    main_router.include_router(api_sds_trace.router, prefix="/sds_trace", tags=["SDS追溯"])

    main_router.include_router(api_test_set.router, prefix="/test_set", tags=["测试集"])
    main_router.include_router(api_test_case.router, prefix="/test_case", tags=["测试用例"])

    main_router.include_router(api_doc_file.router, prefix="/doc_file", tags=["文档文件"])
    main_router.include_router(api_doc_file_flow.router, prefix="/doc_file/img_flow", tags=["文档文件-流程"])
    main_router.include_router(api_doc_file_topo.router, prefix="/doc_file/img_topo", tags=["文档文件-拓扑"])
    main_router.include_router(api_doc_file_struct.router, prefix="/doc_file/img_struct", tags=["文档文件-结构"])
    main_router.include_router(api_doc_file_ui.router, prefix="/doc_file/img_ui", tags=["文档文件-用户界面关系图"])
    main_router.include_router(api_doc_file_home.router, prefix="/doc_file/img_home", tags=["文档文件-主页面图示"])
    
    main_router.include_router(api_prod_haz.router, prefix="/prod_haz", tags=["产品HAZ"])
    main_router.include_router(api_prod_rcm.router, prefix="/prod_rcm", tags=["产品RCM"])
    main_router.include_router(api_prod_cst.router, prefix="/prod_cst", tags=["产品CST"])
    main_router.include_router(api_risk_mgmt_doc.router, prefix="/risk_mgmt_doc", tags=["风险管理"])
    main_router.include_router(api_cybersec_doc.router, prefix="/cybersec_doc", tags=["网络安全管理"])
    main_router.include_router(api_cybersec_plan_doc.router, prefix="/cybersec_plan_doc", tags=["网络安全管理"])
    main_router.include_router(api_ai_support.router, prefix="/ai_support", tags=["AI客服"])

    app.include_router(main_router, prefix=context_path)
    app.mount(f"{context_path}/src-res", StaticFiles(directory="src-res", check_dir=False))
    app.mount(f"/data.trace", StaticFiles(directory="data.trace", check_dir=False))
    return app
