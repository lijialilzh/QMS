import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_doc_file = async (fileType: string,params: any) => {
    return await httpPost(`/trace-api/doc_file/${fileType}/add_doc_file`, params2form(params));
};

export const delete_doc_file = async (fileType: string, params: any) => {
    return await httpDelete(`/trace-api/doc_file/${fileType}/delete_doc_file`, params);
};

export const update_doc_file = async (fileType: string, params: any) => {
    return await httpPost(`/trace-api/doc_file/${fileType}/update_doc_file`, params2form(params));
};

export const list_doc_file = async (fileType: string, params: any) => {
    return await httpGet(`/trace-api/doc_file/${fileType}/list_doc_file`, params);
};

export const get_doc_file = async (fileType: string, params: any) => {
    return await httpGet(`/trace-api/doc_file/${fileType}/get_doc_file`, params);
};
