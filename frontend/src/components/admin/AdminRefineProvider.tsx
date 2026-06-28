import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import type { ReactNode } from "react";
import { adminAuthProvider, adminDataProvider, adminResources } from "@/lib/adminRefine";

export function AdminRefineProvider({ children }: { children: ReactNode }) {
  return (
    <Refine
      authProvider={adminAuthProvider}
      dataProvider={adminDataProvider}
      routerProvider={routerProvider}
      resources={adminResources}
      options={{
        disableTelemetry: true,
        syncWithLocation: false,
        warnWhenUnsavedChanges: true,
      }}
    >
      {children}
    </Refine>
  );
}
