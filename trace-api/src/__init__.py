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
    api_srs_doc, api_sds_doc, api_test_set, api_test_case, api_doc_file_flow, api_doc_file_topo, api_doc_file_struct, \
    api_prod_haz, api_prod_rcm, api_prod_cst, api_srs_req, api_srs_reqd, api_prod_dhf, api_sds_reqd, api_sds_trace, \
    api_srs_type, api_doc_file
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
    main_router.include_router(api_sds_reqd.router, prefix="/sds_reqd", tags=["SDS需求细节"])
    main_router.include_router(api_sds_trace.router, prefix="/sds_trace", tags=["SDS追溯"])

    main_router.include_router(api_test_set.router, prefix="/test_set", tags=["测试集"])
    main_router.include_router(api_test_case.router, prefix="/test_case", tags=["测试用例"])

    main_router.include_router(api_doc_file.router, prefix="/doc_file", tags=["文档文件"])
    main_router.include_router(api_doc_file_flow.router, prefix="/doc_file/img_flow", tags=["文档文件-流程"])
    main_router.include_router(api_doc_file_topo.router, prefix="/doc_file/img_topo", tags=["文档文件-拓扑"])
    main_router.include_router(api_doc_file_struct.router, prefix="/doc_file/img_struct", tags=["文档文件-结构"])
    
    main_router.include_router(api_prod_haz.router, prefix="/prod_haz", tags=["产品HAZ"])
    main_router.include_router(api_prod_rcm.router, prefix="/prod_rcm", tags=["产品RCM"])
    main_router.include_router(api_prod_cst.router, prefix="/prod_cst", tags=["产品CST"])

    app.include_router(main_router, prefix=context_path)
    app.mount(f"{context_path}/src-res", StaticFiles(directory="src-res", check_dir=False))
    app.mount(f"/data.trace", StaticFiles(directory="data.trace", check_dir=False))
    return app
