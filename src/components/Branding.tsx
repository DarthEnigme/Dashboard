"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The few settings the error page shows. It is a client component, so the root layout hands them down. */
export interface Branding {
  logo?: string;
  errorHeading?: string;
  errorMessage?: string;
}

const Context = createContext<Branding>({});

export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useBranding = () => useContext(Context);
