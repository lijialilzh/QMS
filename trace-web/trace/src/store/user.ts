import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface User {
    id?: number | any;
    name?: string | any;
    nick_name?: string | any;
    role_code?: string | any;
    role_perms?: Array<string | any> | any;
}

const initialState = { role_perms: [] } as any;

const slice = createSlice({
    name: "User",
    initialState,
    reducers: {
        update(state, action: PayloadAction<User>) {
            return { ...state, ...action.payload };
        },
        clear() {
            return initialState;
        },
    },
});

export const actionUser = slice.actions;
export default slice.reducer;
