import type { ComponentType } from "react";
import { Redirect, Route, type RouteProps } from "react-router-dom";
import { hasSettingsAccess } from "../config/settingsAuth";

type SettingsProtectedRouteProps = RouteProps & {
  component: ComponentType<any>;
};

export function SettingsProtectedRoute({
  component: Component,
  ...routeProps
}: SettingsProtectedRouteProps) {
  return (
    <Route
      {...routeProps}
      render={(props) => {
        if (hasSettingsAccess()) {
          return <Component {...props} />;
        }

        const next = `${props.location.pathname}${props.location.search || ""}`;
        return <Redirect to={`/settings-unlock?next=${encodeURIComponent(next)}`} />;
      }}
    />
  );
}
