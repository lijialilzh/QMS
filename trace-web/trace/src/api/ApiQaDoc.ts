import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_qa_doc = async (params: any) => {
    return await httpPost("/trace-api/qa_doc/add_qa_doc", params);
};

export const update_qa_doc = async (params: any) => {
    return await httpPost("/trace-api/qa_doc/update_qa_doc", params);
};

export const rebind_qa_doc = async (params: any) => {
    return await httpGet("/trace-api/qa_doc/rebind_product", params);
};

export const delete_qa_doc = async (params: any) => {
    return await httpDelete("/trace-api/qa_doc/delete_qa_doc", params);
};

export const list_qa_doc = async (params: any) => {
    return await httpGet("/trace-api/qa_doc/list_qa_doc", params);
};

export const get_qa_doc = async (params: any) => {
    return await httpGet("/trace-api/qa_doc/get_qa_doc", params);
};

export const export_qa_doc = async (params: any) => {
    return await httpGet("/trace-api/qa_doc/export_qa_doc", params);
};
