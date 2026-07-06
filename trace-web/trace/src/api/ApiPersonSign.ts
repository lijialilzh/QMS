import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_person_sign = async (params: any) => {
    return await httpPost("/trace-api/person_sign/add_person_sign", params);
};

export const delete_person_sign = async (params: any) => {
    return await httpDelete("/trace-api/person_sign/delete_person_sign", params);
};

export const update_person_sign = async (params: any) => {
    return await httpPost("/trace-api/person_sign/update_person_sign", params);
};

export const list_person_sign = async (params: any) => {
    return await httpGet("/trace-api/person_sign/list_person_sign", params);
};

export const get_person_sign = async (params: any) => {
    return await httpGet("/trace-api/person_sign/get_person_sign", params);
};
