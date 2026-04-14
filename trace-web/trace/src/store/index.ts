import { configureStore } from "@reduxjs/toolkit";
import { useDispatch as _useDispatch, useSelector as _useSelector } from "react-redux";
import user, { actionUser } from "./user";

export const store = configureStore({
    reducer: { user },
});

export type Root = ReturnType<typeof store.getState>;

export const actions = {
    user: actionUser,
};

export const useDispatch = _useDispatch;
export const useSelector = _useSelector;
