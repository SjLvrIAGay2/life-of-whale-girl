"use client";
import { createContext, useContext } from "react";
import { texts } from "../config/texts";

export const SiteCopy = createContext(texts.defaults);
export const useSiteCopy = () => useContext(SiteCopy);
