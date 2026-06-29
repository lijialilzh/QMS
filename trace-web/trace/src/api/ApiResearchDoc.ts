import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const research_autofill = async (params: any) => {
    return await httpGet("/trace-api/research_doc/research_autofill", { ...params, _t: Date.now() });
};

export const add_research_doc = async (params: any) => {
    return await httpPost("/trace-api/research_doc/add_research_doc", params);
};

export const duplicate_research_doc = async (params: any) => {
    return await httpGet("/trace-api/research_doc/duplicate_research_doc", params);
};

export const update_research_doc = async (params: any) => {
    return await httpPost("/trace-api/research_doc/update_research_doc", params);
};

export const delete_research_doc = async (params: any) => {
    return await httpDelete("/trace-api/research_doc/delete_research_doc", params);
};

export const list_research_doc = async (params: any) => {
    return await httpGet("/trace-api/research_doc/list_research_doc", params);
};

export const get_research_doc = async (params: any) => {
    return await httpGet("/trace-api/research_doc/get_research_doc", { ...params, _t: Date.now() });
};

export const export_research_doc = async (params: any) => {
    return await httpGet("/trace-api/research_doc/export_research_doc", { ...params, _t: Date.now() });
};
