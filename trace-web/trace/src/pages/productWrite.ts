export type ProductWriteScope = "baseInfo" | "algo" | "version" | "risk" | "threat";

/** 管理员（root / 用户 1）与 DQA 可写全部下列模块。其余角色按模块限制。 */
export function canWriteProduct(roleCode: string | undefined, userId: number | undefined, scope: ProductWriteScope) {
    const role = String(roleCode || "");
    if (userId === 1 || role === "root" || role === "dqa") return true;
    if (scope === "algo") return role === "model_staff" || role === "data_staff";
    if (scope === "version" || scope === "risk") return role === "product_manager";
    return false;
}
