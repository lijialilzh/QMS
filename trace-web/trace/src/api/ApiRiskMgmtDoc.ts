import { httpDelete, httpGet, httpPost, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_risk_mgmt_doc = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/add_risk_mgmt_doc", params);
};

export const import_risk_mgmt_doc_word = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/import_risk_mgmt_doc_word", params2form(params));
};

export const duplicate_risk_mgmt_doc = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/duplicate_risk_mgmt_doc", params);
};

export const update_risk_mgmt_doc = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/update_risk_mgmt_doc", params);
};

export const delete_risk_mgmt_doc = async (params: any) => {
    return await httpDelete("/trace-api/risk_mgmt_doc/delete_risk_mgmt_doc", params);
};

export const list_risk_mgmt_doc = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/list_risk_mgmt_doc", params);
};

export const get_risk_mgmt_doc = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/get_risk_mgmt_doc", params);
};

export const preview_risk_mgmt_content = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/preview_risk_mgmt_content", params);
};

export const export_risk_mgmt_doc = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/export_risk_mgmt_doc", params);
};

export const add_risk_participant = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/add_risk_participant", params);
};

export const update_risk_participant = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/update_risk_participant", params);
};

export const delete_risk_participant = async (params: any) => {
    return await httpDelete("/trace-api/risk_mgmt_doc/delete_risk_participant", params);
};

export const list_risk_participant = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/list_risk_participant", params);
};

export const add_risk_analysis = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/add_risk_analysis", params);
};

export const update_risk_analysis = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/update_risk_analysis", params);
};

export const delete_risk_analysis = async (params: any) => {
    return await httpDelete("/trace-api/risk_mgmt_doc/delete_risk_analysis", params);
};

export const list_risk_analysis = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/list_risk_analysis", params);
};

export const add_risk_control = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/add_risk_control", params);
};

export const update_risk_control = async (params: any) => {
    return await httpPost("/trace-api/risk_mgmt_doc/update_risk_control", params);
};

export const delete_risk_control = async (params: any) => {
    return await httpDelete("/trace-api/risk_mgmt_doc/delete_risk_control", params);
};

export const list_risk_control = async (params: any) => {
    return await httpGet("/trace-api/risk_mgmt_doc/list_risk_control", params);
};
