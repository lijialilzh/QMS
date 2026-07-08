import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_bug_doc = async (params: any) => {
    return await httpPost("/trace-api/bug_doc/add_bug_doc", params2form(params));
};

export const update_bug_doc = async (params: any) => {
    return await httpPost("/trace-api/bug_doc/update_bug_doc", params2form(params));
};

export const delete_bug_doc = async (params: any) => {
    return await httpDelete("/trace-api/bug_doc/delete_bug_doc", params);
};

export const list_bug_doc = async (params: any) => {
    return await httpGet("/trace-api/bug_doc/list_bug_doc", params);
};

export const get_bug_doc = async (params: any) => {
    return await httpGet("/trace-api/bug_doc/get_bug_doc", params);
};

export const download_bug_doc = async (params: any) => {
    return await httpGet("/trace-api/bug_doc/download_bug_doc", params);
};

export const download_bug_template = async () => {
    return await httpGet("/trace-api/bug_doc/download_bug_template");
};

export const preview_bug_doc = async (params: any) => {
    return await httpGet("/trace-api/bug_doc/preview_bug_doc", params);
};
