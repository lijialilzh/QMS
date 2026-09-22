const ALL = "__ALL__";

export function isAllProductId(value: any): boolean {
    if (value === undefined || value === null || value === "" || value === ALL) return true;
    const id = Number(value);
    return !Number.isFinite(id) || id <= 0;
}

/** 列表查询：去掉空值、「全部」、非法 product_id，避免选全部时不请求或把 __ALL__ 传给后端。 */
export function sanitizeListQuery(params: any = {}): Record<string, any> {
    return Object.fromEntries(
        Object.entries(params || {}).flatMap(([key, value]) => {
            if (value === undefined || value === null || value === "" || value === ALL) return [];
            if (key === "product_id" || key === "prod_id") {
                if (isAllProductId(value)) return [];
                return [[key, Number(value)]];
            }
            return [[key, value]];
        }),
    );
}
