import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_ftr_record_doc = async (params: any) => {
    return await httpPost("/trace-api/ftr_record_doc/add_ftr_record_doc", params);
};

export const duplicate_ftr_record_doc = async (params: any) => {
    return await httpGet("/trace-api/ftr_record_doc/duplicate_ftr_record_doc", params);
};

export const update_ftr_record_doc = async (params: any) => {
    return await httpPost("/trace-api/ftr_record_doc/update_ftr_record_doc", params);
};

export const rebind_product = async (params: any) => {
    return await httpGet("/trace-api/ftr_record_doc/rebind_product", params);
};

export const delete_ftr_record_doc = async (params: any) => {
    return await httpDelete("/trace-api/ftr_record_doc/delete_ftr_record_doc", params);
};

export const list_ftr_record_doc = async (params: any) => {
    return await httpGet("/trace-api/ftr_record_doc/list_ftr_record_doc", params);
};

export const get_ftr_record_doc = async (params: any) => {
    return await httpGet("/trace-api/ftr_record_doc/get_ftr_record_doc", params);
};

export const export_ftr_record_doc = async (params: any) => {
    return await httpGet("/trace-api/ftr_record_doc/export_ftr_record_doc", params);
};