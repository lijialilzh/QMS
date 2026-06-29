import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_release_note = async (params: any) => {
    return await httpPost("/trace-api/release_note/add_release_note", params);
};

export const duplicate_release_note = async (params: any) => {
    return await httpGet("/trace-api/release_note/duplicate_release_note", params);
};

export const update_release_note = async (params: any) => {
    return await httpPost("/trace-api/release_note/update_release_note", params);
};

export const delete_release_note = async (params: any) => {
    return await httpDelete("/trace-api/release_note/delete_release_note", params);
};

export const list_release_note = async (params: any) => {
    return await httpGet("/trace-api/release_note/list_release_note", params);
};

export const get_release_note = async (params: any) => {
    return await httpGet("/trace-api/release_note/get_release_note", params);
};

export const export_release_note = async (params: any) => {
    return await httpGet("/trace-api/release_note/export_release_note", { ...params, _t: Date.now() });
};
