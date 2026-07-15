import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_imm_doc = async (params: any) => {
    return await httpPost("/trace-api/imm_doc/add_imm_doc", params);
};

export const duplicate_imm_doc = async (params: any) => {
    return await httpGet("/trace-api/imm_doc/duplicate_imm_doc", params);
};

export const update_imm_doc = async (params: any) => {
    return await httpPost("/trace-api/imm_doc/update_imm_doc", params);
};

export const delete_imm_doc = async (params: any) => {
    return await httpDelete("/trace-api/imm_doc/delete_imm_doc", params);
};

export const list_imm_doc = async (params: any) => {
    return await httpGet("/trace-api/imm_doc/list_imm_doc", params);
};

export const get_imm_doc = async (params: any) => {
    return await httpGet("/trace-api/imm_doc/get_imm_doc", params);
};

export const export_imm_doc = async (params: any) => {
    return await httpGet("/trace-api/imm_doc/export_imm_doc", params);
};

export const export_imm_md5_attachment = async (params: any) => {
    return await httpGet("/trace-api/imm_doc/export_imm_md5_attachment", params);
};

export const export_imm_md5_review = async (params: any) => {
    return await httpGet("/trace-api/imm_doc/export_imm_md5_review", params);
};
