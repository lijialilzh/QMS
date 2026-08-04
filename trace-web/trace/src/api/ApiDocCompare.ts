import { httpGet, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

// 查询可比对的文档类型列表
export const list_compare_doc_types = async (params?: any) => {
    return await httpGet("/trace-api/doc_compare/list_compare_doc_types", params);
};

// 查询文档版本列表
export const list_compare_doc_versions = async (params: any) => {
    return await httpGet("/trace-api/doc_compare/list_compare_doc_versions", params);
};

// 通用文档内容比对
export const compare_doc = async (params: any) => {
    return await httpGet("/trace-api/doc_compare/compare_doc", params);
};
