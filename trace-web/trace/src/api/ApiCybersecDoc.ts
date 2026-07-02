import { httpDelete, httpGet, httpPost, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

// ---------------- 文档 ----------------
export const add_cybersec_doc = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/add_cybersec_doc", params);
};

export const import_cybersec_doc_word = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/import_cybersec_doc_word", params2form(params));
};

export const duplicate_cybersec_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/duplicate_cybersec_doc", params);
};

export const update_cybersec_doc = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/update_cybersec_doc", params);
};

export const delete_cybersec_doc = async (params: any) => {
    return await httpDelete("/trace-api/cybersec_doc/delete_cybersec_doc", params);
};

export const list_cybersec_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/list_cybersec_doc", params);
};

export const get_cybersec_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/get_cybersec_doc", params);
};

export const preview_cybersec_content = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/preview_cybersec_content", params);
};

export const export_cybersec_doc = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/export_cybersec_doc", params);
};

// ---------------- 威胁 ----------------
export const add_cybersec_threat = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/add_cybersec_threat", params);
};

export const update_cybersec_threat = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/update_cybersec_threat", params);
};

export const delete_cybersec_threat = async (params: any) => {
    return await httpDelete("/trace-api/cybersec_doc/delete_cybersec_threat", params);
};

export const list_cybersec_threat = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/list_cybersec_threat", params);
};

// ---------------- 内部 RCM ----------------
export const add_cybersec_control_internal = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/add_cybersec_control_internal", params);
};

export const update_cybersec_control_internal = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/update_cybersec_control_internal", params);
};

export const delete_cybersec_control_internal = async (params: any) => {
    return await httpDelete("/trace-api/cybersec_doc/delete_cybersec_control_internal", params);
};

export const list_cybersec_control_internal = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/list_cybersec_control_internal", params);
};

// ---------------- SBOM RCM ----------------
export const add_cybersec_control_sbom = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/add_cybersec_control_sbom", params);
};

export const update_cybersec_control_sbom = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/update_cybersec_control_sbom", params);
};

export const delete_cybersec_control_sbom = async (params: any) => {
    return await httpDelete("/trace-api/cybersec_doc/delete_cybersec_control_sbom", params);
};

export const list_cybersec_control_sbom = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/list_cybersec_control_sbom", params);
};

// ---------------- 网络安全扫描 RCM ----------------
export const add_cybersec_control_scan = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/add_cybersec_control_scan", params);
};

export const update_cybersec_control_scan = async (params: any) => {
    return await httpPost("/trace-api/cybersec_doc/update_cybersec_control_scan", params);
};

export const delete_cybersec_control_scan = async (params: any) => {
    return await httpDelete("/trace-api/cybersec_doc/delete_cybersec_control_scan", params);
};

export const list_cybersec_control_scan = async (params: any) => {
    return await httpGet("/trace-api/cybersec_doc/list_cybersec_control_scan", params);
};
