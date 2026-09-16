import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_prod_algo_chapter = async (params: any) => {
    return await httpPost("/trace-api/prod_algo_chapter/add_prod_algo_chapter", params);
};

export const update_prod_algo_chapter = async (params: any) => {
    return await httpPost("/trace-api/prod_algo_chapter/update_prod_algo_chapter", params);
};

export const delete_prod_algo_chapters = async (params: any) => {
    return await httpDelete("/trace-api/prod_algo_chapter/delete_prod_algo_chapters", params);
};

export const list_prod_algo_chapter = async (params: any) => {
    return await httpGet("/trace-api/prod_algo_chapter/list_prod_algo_chapter", params);
};