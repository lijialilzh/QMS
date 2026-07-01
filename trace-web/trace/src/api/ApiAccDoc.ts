import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_acc_doc = async (params: any) => {
    return await httpPost("/trace-api/acc_doc/add_acc_doc", params);
};

export const duplicate_acc_doc = async (params: any) => {
    return await httpGet("/trace-api/acc_doc/duplicate_acc_doc", params);
};

export const update_acc_doc = async (params: any) => {
    return await httpPost("/trace-api/acc_doc/update_acc_doc", params);
};

export const delete_acc_doc = async (params: any) => {
    return await httpDelete("/trace-api/acc_doc/delete_acc_doc", params);
};

export const list_acc_doc = async (params: any) => {
    return await httpGet("/trace-api/acc_doc/list_acc_doc", params);
};

export const get_acc_doc = async (params: any) => {
    return await httpGet("/trace-api/acc_doc/get_acc_doc", params);
};

export const acc_autofill = async (params: any) => {
    return await httpGet("/trace-api/acc_doc/acc_autofill", params);
};

export const export_acc_doc = async (params: any) => {
    return await httpGet("/trace-api/acc_doc/export_acc_doc", params);
};
