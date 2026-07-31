import { httpGet, httpPost, httpDelete } from "./http";
import { C_OK } from "./ApiUser";

export { C_OK };

// 培训记录表列表
export const list_train_record_doc = async (params: any) => {
    return await httpGet("/trace-api/train_record_doc/list_train_record_doc", params);
};

// 查询培训记录表详情
export const get_train_record_doc = async (params: any) => {
    return await httpGet("/trace-api/train_record_doc/get_train_record_doc", params);
};

// 添加培训记录表
export const add_train_record_doc = async (params: any) => {
    return await httpPost("/trace-api/train_record_doc/add_train_record_doc", params);
};

// 更新培训记录表
export const update_train_record_doc = async (params: any) => {
    return await httpPost("/trace-api/train_record_doc/update_train_record_doc", params);
};

// 删除培训记录表
export const delete_train_record_doc = async (params: any) => {
    return await httpDelete("/trace-api/train_record_doc/delete_train_record_doc", params);
};

// 复制培训记录表
export const duplicate_train_record_doc = async (params: any) => {
    return await httpGet("/trace-api/train_record_doc/duplicate_train_record_doc", params);
};

// 导出培训记录表
export const export_train_record_doc = async (params: any) => {
    return await httpGet("/trace-api/train_record_doc/export_train_record_doc", params);
};

// 切换产品
export const rebind_product = async (params: any) => {
    return await httpGet("/trace-api/train_record_doc/rebind_product", params);
};