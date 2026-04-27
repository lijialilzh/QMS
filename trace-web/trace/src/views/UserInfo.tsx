import "./UserInfo.less";
import { Dropdown, message, Modal, Form, Input } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { MenuProps } from "antd";
import * as Api from "@/api/ApiUser";
import { useNavigate } from "react-router-dom";
import { useData } from "@/common";
import { Root, actions, useSelector, useDispatch } from "@/store";

export const PwdDlg = ({ isOpen, onClose }: any) => {
    const { t: ts } = useTranslation();
    const [pwdForm] = Form.useForm();
    const [data, dispatch] = useData({});
    const dispatchStore = useDispatch();
    const user = useSelector((state: Root) => state.user);
    const updatePwd = () => {
        pwdForm.validateFields().then(
            (values) => {
                if (values.pwd_new1 !== values.pwd_new2) {
                    message.error(ts("pwds_not_same"));
                    return;
                }
                dispatch({ loading: true });
                Api.update_pwd(values).then((res:any) => {
                    dispatch({ loading: false });
                    if (res.code !== Api.C_OK) {
                        message.error(res.msg);
                        return;
                    }
                    dispatchStore(actions.user.update({ ...user, pwd_updated: 1 }));
                    onClose();
                    message.success(res.msg);
                    pwdForm.resetFields();
                });
            },
            () => null
        );
    };
    const rules = [
        { required: true, message: ts("input_new_pwd") },
        { min: 6, message: ts("pwd_len_err") },
    ];

    return (
        <Modal
            maskClosable={false}
            loading={data.loading}
            open={isOpen}
            title={ts("update_pwd")}
            closable={false}
            centered
            onOk={updatePwd}
            onCancel={onClose}>
            <Form form={pwdForm} labelCol={{span: 5}}>
                <Form.Item label={ts("label_old_pwd")} name="pwd" rules={[{ required: true, message: ts("input_old_pwd") }]}>
                    <Input.Password allowClear autoComplete="new-password" />
                </Form.Item>
                <Form.Item label={ts("label_pwd_new1")} name="pwd_new1" rules={rules}>
                    <Input.Password allowClear autoComplete="new-password" />
                </Form.Item>
                <Form.Item label={ts("label_pwd_new2")} name="pwd_new2" rules={rules}>
                    <Input.Password allowClear autoComplete="new-password" />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default ({ ...attrs }: any) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        dlgExit: false,
        dlgPwd: false,
    });
    const navigate = useNavigate();
    const user = useSelector((state: Root) => state.user);
    const dispatchStore = useDispatch();
    const items: MenuProps["items"] = [
        { key: "update_pwd", label: ts("update_pwd") },
        { key: "exit", label: ts("exit") },
    ];

    const logout = () => {
        dispatch({ loading: true });
        Api.logout().then((res) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                dispatchStore(actions.user.clear());
                dispatch({ dlgExit: false });
                navigate("/login", { replace: true });
            } else {
                message.error(res.msg);
            }
        });
    };

    return (
        <div className="center-v">
            {user.id && (
                <Dropdown
                    {...attrs}
                    overlayClassName="user-info-dropdown"
                    placement="bottomRight"
                    menu={{
                        items,
                        onClick: (item) => {
                            if (item.key === "exit") {
                                dispatch({ dlgExit: true });
                            } else if (item.key == "update_pwd") {
                                dispatch({ dlgPwd: true });
                            }
                        },
                    }}
                    trigger={["click"]}>
                    <div className="div-h center-v cursor-on">
                        <img src="assets/icon/user.svg" />
                        <div className="seltxt">{user.nick_name || user.name}</div>
                        <DownOutlined />
                    </div>
                </Dropdown>
            )}
            <Modal
                loading={data.loading}
                maskClosable={false}
                open={data.dlgExit}
                title={ts("tips")}
                centered
                onOk={logout}
                onCancel={() => dispatch({ dlgExit: false })}>
                <p>{ts("confirm_exit")}</p>
            </Modal>
            <PwdDlg
                isOpen={data.dlgPwd}
                onClose={() => {
                    dispatch({ dlgPwd: false });
                }}></PwdDlg>
        </div>
    );
};
