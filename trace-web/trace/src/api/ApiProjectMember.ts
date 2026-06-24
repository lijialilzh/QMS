import { httpPost, httpGet, httpDelete, params2form, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_project_member = async (params: any) => {
    return await httpPost("/trace-api/project_member/add_project_member", params);
};

export const update_project_member = async (params: any) => {
    return await httpPost("/trace-api/project_member/update_project_member", params);
};

export const delete_project_members = async (params: any) => {
    return await httpDelete("/trace-api/project_member/delete_project_members", params);
};

export const list_project_member = async (params: any) => {
    return await httpGet("/trace-api/project_member/list_project_member", params);
};

export const import_project_members = async (params: any) => {
    return await httpPost("/trace-api/project_member/import_project_members", params2form(params));
};
