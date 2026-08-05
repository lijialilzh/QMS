import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

// ---------------- 文档 ----------------
export const add_cybersec_plan_doc = async (params: any) => {
    return await httpPost("/trace-api/cybersec_plan_doc/add_cybersec_plan_doc", params);
};

export const duplicate_cybersec_plan_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_plan_doc/duplicate_cybersec_plan_doc", params);
};

export const update_cybersec_plan_doc = async (params: any) => {
    return await httpPost("/trace-api/cybersec_plan_doc/update_cybersec_plan_doc", params);
};

export const delete_cybersec_plan_doc = async (params: any) => {
    return await httpDelete("/trace-api/cybersec_plan_doc/delete_cybersec_plan_doc", params);
};

export const list_cybersec_plan_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_plan_doc/list_cybersec_plan_doc", params);
};

export const get_cybersec_plan_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_plan_doc/get_cybersec_plan_doc", params);
};

export const cybersec_plan_autofill = async (params: any) => {
    return await httpGet("/trace-api/cybersec_plan_doc/cybersec_plan_autofill", params);
};

export const export_cybersec_plan_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_plan_doc/export_cybersec_plan_doc", params);
};
