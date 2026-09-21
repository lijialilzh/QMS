import * as Api from "@/api/ApiProdHaz";
import ProdRiskProductList from "../ProdRiskProductList";
import EditDlg from "./EditDlg";
import ProdHazDetail from "./ProdHazDetail";

export default () => (
    <ProdRiskProductList
        listApi={Api.list_prod_haz}
        deleteApi={Api.delete_prod_hazs}
        addItemsApi={Api.add_prod_hazs}
        idsParam="haz_ids"
        selectEmptyMsg="请选择HAZ!"
        MasterPicker={EditDlg}
        Detail={ProdHazDetail}
        basePath="/prod_hazs"
        addTitle="新增产品HAZ"
        hint="选择产品及完整版本后，在下方主数据中全选或勾选 HAZ，确定即添加到该产品。"
        countLabel="HAZ条数"
        itemLabel="HAZ"
    />
);
